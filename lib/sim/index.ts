import type {
  CapacityCurve,
  CapacityPoint,
  LatencyPercentiles,
  SimResult,
  StationLoad,
  SystemModel,
  SloTarget,
  WaterfallHop,
} from "../model/types";
import { DEFAULT_DES_OPTIONS, makeSeed, runDes } from "./des";
import { requiredInstances, stationMetrics } from "./queueing";
import {
  computeVisits,
  reachableFromEntry,
  serversOf,
  systemSaturationRps,
} from "./topology";

export * from "./queueing";
export * from "./topology";
export { runDes } from "./des";

/** Cap used to keep "infinite" (saturated) latencies finite for display/charts. */
const SATURATED_MS = 600_000;

function percentiles(sorted: number[]): LatencyPercentiles {
  const n = sorted.length;
  if (n === 0) {
    return { mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 };
  }
  const at = (q: number) => sorted[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  return {
    mean,
    p50: at(0.5),
    p90: at(0.9),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[n - 1],
  };
}

/** Components reachable from the entrypoint, in DFS pre-order (the latency path). */
function reachableOrder(model: SystemModel): string[] {
  const byId = new Map(model.components.map((c) => [c.id, c]));
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    const c = byId.get(id);
    if (!c) return;
    seen.add(id);
    order.push(id);
    for (const d of c.dependsOn) visit(d);
  };
  visit(model.entrypoint);
  return order;
}

export interface SimulateOptions {
  arrivals?: number;
  timeoutMs?: number;
}

/**
 * Simulate the system at a fixed external request rate.
 * Latency percentiles & throughput come from the discrete-event simulation;
 * per-tier utilization/queueing comes from closed-form M/M/c (so it can exceed
 * 1.0 to signal overload, which the bounded simulation cannot show directly).
 */
export function simulate(
  model: SystemModel,
  externalRps: number,
  options: SimulateOptions = {},
): SimResult {
  const arrivals = options.arrivals ?? 20_000;
  const seed = makeSeed(model, externalRps);
  const des = runDes(model, externalRps, {
    ...DEFAULT_DES_OPTIONS,
    arrivals,
    seed,
    timeoutMs: options.timeoutMs,
  });

  const visits = computeVisits(model);
  const sync = reachableFromEntry(model);
  const stations: StationLoad[] = [];
  let bottleneckId = model.entrypoint;
  let maxUtilization = 0;

  for (const c of model.components) {
    const v = visits.get(c.id) ?? 0;
    const arrivalRps = externalRps * v;
    const servers = serversOf(c);
    const m = stationMetrics(arrivalRps, c.serviceTimeMs, servers);
    const util = m.utilization;
    const station: StationLoad = {
      componentId: c.id,
      name: c.name,
      kind: c.kind,
      visitsPerRequest: v,
      arrivalRps,
      serviceTimeMs: c.serviceTimeMs,
      servers,
      instances: c.instances,
      utilization: util,
      queueWaitMs: Math.min(SATURATED_MS, m.queueWaitMs),
      residenceMs: Math.min(SATURATED_MS, m.residenceMs),
      requiredInstances: requiredInstances(arrivalRps, c.serviceTimeMs, c.workersPerInstance),
    };
    stations.push(station);
    // Only synchronous request-path tiers drive the latency bottleneck/stability.
    // Async tiers (workers draining a queue) still report their utilization in the
    // table, but their backlog is a throughput concern, not request latency.
    if (v > 0 && sync.has(c.id) && util > maxUtilization) {
      maxUtilization = util;
      bottleneckId = c.id;
    }
  }

  // Latency: prefer the simulated distribution; fall back to analytic mean when
  // the simulation produced no completions (fully saturated).
  let latency: LatencyPercentiles;
  if (des.latencies.length > 0) {
    latency = percentiles(des.latencies);
  } else {
    const analyticMean = Math.min(
      SATURATED_MS,
      stations.reduce((sum, s) => sum + s.visitsPerRequest * s.residenceMs, 0),
    );
    latency = { mean: analyticMean, p50: analyticMean, p90: analyticMean, p95: analyticMean, p99: analyticMean, max: analyticMean };
  }

  return {
    rps: externalRps,
    throughput: des.throughput > 0 ? des.throughput : (maxUtilization < 1 ? externalRps : 0),
    latency,
    stations,
    bottleneckId,
    maxUtilization,
    dropRate: des.dropRate,
    stable: maxUtilization < 1,
  };
}

/** Per-tier contribution to end-to-end latency at the given rate. */
export function waterfall(model: SystemModel, externalRps: number): WaterfallHop[] {
  const visits = computeVisits(model);
  const byId = new Map(model.components.map((c) => [c.id, c]));
  const order = reachableOrder(model);
  const hops: WaterfallHop[] = [];
  let total = 0;
  for (const id of order) {
    const c = byId.get(id)!;
    const v = visits.get(id) ?? 0;
    if (v <= 0) continue;
    const servers = serversOf(c);
    const m = stationMetrics(externalRps * v, c.serviceTimeMs, servers);
    const queueWaitMs = Math.min(SATURATED_MS, m.queueWaitMs) * v;
    const serviceMs = c.serviceTimeMs * v;
    const totalMs = queueWaitMs + serviceMs;
    total += totalMs;
    hops.push({
      componentId: id,
      name: c.name,
      kind: c.kind,
      queueWaitMs,
      serviceMs,
      totalMs,
      pctOfTotal: 0,
    });
  }
  for (const h of hops) h.pctOfTotal = total > 0 ? (h.totalMs / total) * 100 : 0;
  return hops;
}

export interface CapacityOptions {
  arrivalsPerPoint?: number;
  points?: number;
}

/**
 * Sweep external RPS from light load through saturation, running a simulation at
 * each step, to produce the load-vs-latency curve and the key thresholds:
 * saturation (a tier hits 100%), SLO break (p99 exceeds target) and the knee
 * (where queueing starts to bite).
 */
export function buildCapacityCurve(
  model: SystemModel,
  slo: SloTarget,
  baselineRps: number,
  options: CapacityOptions = {},
): CapacityCurve {
  const arrivalsPerPoint = options.arrivalsPerPoint ?? 6_000;
  const cap = systemSaturationRps(model);
  const finiteSat = Number.isFinite(cap.saturationRps)
    ? cap.saturationRps
    : Math.max(baselineRps * 4, 100);

  const fractions = [
    0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1.0, 1.1, 1.25, 1.4,
  ];
  const rpsLadder = Array.from(
    new Set(
      fractions
        .map((f) => Math.max(1, Math.round(finiteSat * f)))
        .concat([Math.max(1, Math.round(baselineRps))]),
    ),
  ).sort((a, b) => a - b);

  const points: CapacityPoint[] = [];
  for (const rps of rpsLadder) {
    const r = simulate(model, rps, { arrivals: arrivalsPerPoint });
    points.push({
      rps,
      p50: r.latency.p50,
      p95: r.latency.p95,
      p99: r.latency.p99,
      throughput: r.throughput,
      maxUtilization: r.maxUtilization,
      bottleneckId: r.bottleneckId,
      stable: r.stable,
    });
  }

  // SLO break: first rps where simulated p99 exceeds the target (linear interp).
  let sloBreakRps = finiteSat;
  for (let i = 0; i < points.length; i++) {
    if (points[i].p99 > slo.p99LatencyMs) {
      if (i === 0) {
        sloBreakRps = points[0].rps;
      } else {
        const a = points[i - 1];
        const b = points[i];
        const t = (slo.p99LatencyMs - a.p99) / Math.max(1e-6, b.p99 - a.p99);
        sloBreakRps = a.rps + t * (b.rps - a.rps);
      }
      break;
    }
  }

  // Knee: first rps where any tier exceeds 75% utilization.
  let kneeRps = finiteSat;
  for (const p of points) {
    if (p.maxUtilization >= 0.75) {
      kneeRps = p.rps;
      break;
    }
  }

  return {
    points,
    saturationRps: finiteSat,
    sloBreakRps: Math.min(sloBreakRps, finiteSat),
    kneeRps,
    bottleneckId: cap.bottleneckId,
  };
}
