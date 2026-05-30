import type { SystemModel } from "../model/types";
import { MinHeap } from "./heap";
import { expSample, lognormalSample, mulberry32, seedFromString } from "./random";
import { sampleRoute, serversOf, serviceCv } from "./topology";

/** One in-flight request as it traverses the architecture. */
interface Req {
  id: number;
  start: number; // external arrival time (ms)
  route: string[]; // ordered station ids to visit
  idx: number; // current hop
  enqueuedAt: number; // when it entered the current station
  measured: boolean; // counted (i.e. arrived after warmup)
}

/** Simulation event: an external arrival (kind 0) or a service completion (kind 1). */
interface Ev {
  t: number;
  kind: 0 | 1;
  req?: Req;
  stationId?: string;
}

/** Mutable per-tier runtime state during a run. */
interface Station {
  servers: number;
  busy: number;
  serviceMeanMs: number;
  cv: number;
  queue: Req[];
}

export interface DesOptions {
  arrivals: number; // number of external requests to simulate
  warmupFraction: number; // leading fraction discarded to reach steady state
  seed: number;
  timeoutMs?: number; // requests slower than this are counted as failures
  queueCapPerServer: number; // load-shedding threshold (also guarantees termination)
}

export const DEFAULT_DES_OPTIONS: Omit<DesOptions, "arrivals" | "seed"> = {
  warmupFraction: 0.15,
  queueCapPerServer: 256,
};

export interface DesOutput {
  latencies: number[]; // ms, successful measured requests (sorted ascending)
  completed: number;
  failed: number;
  windowMs: number;
  throughput: number; // successful req/s during the measurement window
  dropRate: number;
}

/**
 * Run a discrete-event simulation of `arrivals` Poisson-distributed requests at
 * the given external rate. Each request samples a route through the architecture
 * and queues at every tier it visits (M/M/c per tier, log-normal service times).
 * Returns the empirical end-to-end latency distribution and drop rate.
 */
export function runDes(model: SystemModel, externalRps: number, opts: DesOptions): DesOutput {
  const empty: DesOutput = {
    latencies: [],
    completed: 0,
    failed: 0,
    windowMs: 0,
    throughput: 0,
    dropRate: 0,
  };
  if (externalRps <= 0 || opts.arrivals <= 0) return empty;

  const rng = mulberry32(opts.seed >>> 0);
  const stations = new Map<string, Station>();
  for (const c of model.components) {
    stations.set(c.id, {
      servers: serversOf(c),
      busy: 0,
      serviceMeanMs: c.serviceTimeMs,
      cv: serviceCv(c.kind),
      queue: [],
    });
  }

  const heap = new MinHeap<Ev>((e) => e.t);
  const meanInterarrivalMs = 1000 / externalRps;
  const warmupArrivals = Math.floor(opts.arrivals * opts.warmupFraction);

  const latencies: number[] = [];
  let completed = 0;
  let failed = 0;
  let windowStart = Number.POSITIVE_INFINITY;
  let windowEnd = 0;

  const startService = (station: Station, req: Req, now: number) => {
    station.busy++;
    const svc = Math.max(0, lognormalSample(rng, station.serviceMeanMs, station.cv));
    heap.push({ t: now + svc, kind: 1, req, stationId: req.route[req.idx] });
  };

  const sendToStation = (req: Req, now: number) => {
    const id = req.route[req.idx];
    const station = stations.get(id);
    if (!station) {
      // unknown station — skip this hop
      advance(req, now);
      return;
    }
    if (station.busy < station.servers) {
      startService(station, req, now);
    } else if (station.queue.length >= station.servers * opts.queueCapPerServer) {
      // load shed: drop the request
      if (req.measured) failed++;
    } else {
      req.enqueuedAt = now;
      station.queue.push(req);
    }
  };

  const advance = (req: Req, now: number) => {
    req.idx++;
    if (req.idx < req.route.length) {
      sendToStation(req, now);
      return;
    }
    // request finished
    if (req.measured) {
      const latency = now - req.start;
      if (opts.timeoutMs && latency > opts.timeoutMs) {
        failed++;
      } else {
        latencies.push(latency);
        completed++;
        if (now > windowEnd) windowEnd = now;
      }
    }
  };

  // schedule first arrival
  let arrivalIndex = 0;
  const scheduleArrival = (t: number) => {
    heap.push({ t, kind: 0 });
  };
  scheduleArrival(0);

  while (heap.size > 0) {
    const ev = heap.pop()!;
    const now = ev.t;
    if (ev.kind === 0) {
      // external arrival
      const measured = arrivalIndex >= warmupArrivals;
      if (measured && now < windowStart) windowStart = now;
      const route = sampleRoute(model, rng);
      const req: Req = { id: arrivalIndex, start: now, route, idx: 0, enqueuedAt: now, measured };
      arrivalIndex++;
      if (route.length === 0) {
        if (measured) {
          latencies.push(0);
          completed++;
        }
      } else {
        sendToStation(req, now);
      }
      if (arrivalIndex < opts.arrivals) {
        scheduleArrival(now + expSample(rng, meanInterarrivalMs));
      }
    } else {
      // service completion at a station
      const station = stations.get(ev.stationId!)!;
      station.busy--;
      // pull the next waiting request into the freed server
      if (station.queue.length > 0) {
        const next = station.queue.shift()!;
        startService(station, next, now);
      }
      advance(ev.req!, now);
    }
  }

  latencies.sort((a, b) => a - b);
  const windowMs = Number.isFinite(windowStart) ? Math.max(0, windowEnd - windowStart) : 0;
  const throughput = windowMs > 0 ? completed / (windowMs / 1000) : 0;
  const total = completed + failed;
  const dropRate = total > 0 ? failed / total : 0;
  return { latencies, completed, failed, windowMs, throughput, dropRate };
}

export function makeSeed(model: SystemModel, rps: number): number {
  return seedFromString(`${model.name}:${model.components.length}:${Math.round(rps * 100)}`);
}
