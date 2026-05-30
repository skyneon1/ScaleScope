import type { Component, ComponentKind, SystemModel } from "../model/types";
import { stationSaturationRps } from "./queueing";

/** Total parallel servers a tier exposes. */
export function serversOf(c: Component): number {
  return Math.max(1, Math.floor(c.instances * c.workersPerInstance));
}

/** Coefficient of variation of service time per component kind (for log-normal sampling). */
export function serviceCv(kind: ComponentKind): number {
  switch (kind) {
    case "external":
      return 1.0; // third-party APIs are spiky
    case "database":
    case "search":
      return 0.8;
    case "cache":
      return 0.4; // very consistent
    case "storage":
      return 0.7;
    default:
      return 0.5;
  }
}

export interface NormalizedModel {
  model: SystemModel;
  warnings: string[];
  byId: Map<string, Component>;
}

/**
 * Validate and clean a model: deduplicate ids, drop dangling dependencies,
 * ensure the entrypoint exists. Returns warnings describing any repairs.
 */
export function normalizeModel(input: SystemModel): NormalizedModel {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const components: Component[] = [];
  for (const c of input.components) {
    if (seen.has(c.id)) {
      warnings.push(`Duplicate component id "${c.id}" ignored.`);
      continue;
    }
    seen.add(c.id);
    components.push({ ...c });
  }
  const ids = new Set(components.map((c) => c.id));
  for (const c of components) {
    const kept = c.dependsOn.filter((d) => {
      if (!ids.has(d)) {
        warnings.push(`Component "${c.id}" depends on unknown "${d}" — dropped.`);
        return false;
      }
      if (d === c.id) {
        warnings.push(`Component "${c.id}" depends on itself — dropped.`);
        return false;
      }
      return true;
    });
    c.dependsOn = kept;
  }

  let entrypoint = input.entrypoint;
  if (!ids.has(entrypoint)) {
    // pick the most upstream-looking component
    const guess =
      components.find((c) => c.kind === "load_balancer") ??
      components.find((c) => c.kind === "web") ??
      components.find((c) => c.kind === "api") ??
      components[0];
    warnings.push(
      `Entrypoint "${entrypoint}" not found — using "${guess.id}" instead.`,
    );
    entrypoint = guess.id;
  }

  const byId = new Map(components.map((c) => [c.id, c]));
  return {
    model: { ...input, entrypoint, components },
    warnings,
    byId,
  };
}

/** Set of component ids reachable from the entrypoint along the synchronous path. */
export function reachableFromEntry(model: SystemModel): Set<string> {
  const byId = new Map(model.components.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const stack = [model.entrypoint];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    const c = byId.get(id);
    if (!c) continue;
    seen.add(id);
    for (const d of c.dependsOn) stack.push(d);
  }
  return seen;
}

/** number of calls made from `c` to dependency `depId` per inbound call to `c`. */
export function callWeight(c: Component, depId: string): number {
  const w = c.callsPerRequest?.[depId];
  return typeof w === "number" && w >= 0 ? w : 1;
}

/**
 * Expected number of times each component is touched per external request.
 * Propagates flow from the entrypoint through the synchronous dependency graph.
 * Components unreachable from the entrypoint that do async work (workers, queues)
 * default to one unit of work per request.
 */
export function computeVisits(model: SystemModel): Map<string, number> {
  const byId = new Map(model.components.map((c) => [c.id, c]));
  const visits = new Map<string, number>();
  for (const c of model.components) visits.set(c.id, 0);

  let ops = 0;
  const OP_CAP = 200_000;
  const warnedCycle = new Set<string>();

  const flow = (nodeId: string, amount: number, stack: Set<string>) => {
    if (ops++ > OP_CAP || amount < 1e-6) return;
    visits.set(nodeId, (visits.get(nodeId) ?? 0) + amount);
    const node = byId.get(nodeId);
    if (!node) return;
    const nextStack = new Set(stack);
    nextStack.add(nodeId);
    for (const dep of node.dependsOn) {
      if (nextStack.has(dep)) {
        warnedCycle.add(dep);
        continue; // break cycle
      }
      flow(dep, amount * callWeight(node, dep), nextStack);
    }
  };

  flow(model.entrypoint, 1, new Set());

  // async tiers not on the synchronous path still process ~1 unit/request
  for (const c of model.components) {
    if ((visits.get(c.id) ?? 0) === 0 && (c.kind === "worker" || c.kind === "queue")) {
      visits.set(c.id, 1);
    }
  }
  return visits;
}

/**
 * Build the ordered list of station ids a single request traverses, expanding
 * fan-out stochastically (fractional calls become Bernoulli draws so the mean
 * matches `callsPerRequest`). Used to drive the discrete-event simulator.
 */
export function sampleRoute(model: SystemModel, rng: () => number): string[] {
  const byId = new Map(model.components.map((c) => [c.id, c]));
  const route: string[] = [];
  const CAP = 2000;

  const visit = (nodeId: string, stack: Set<string>) => {
    if (route.length >= CAP) return;
    const node = byId.get(nodeId);
    if (!node) return;
    route.push(nodeId);
    const nextStack = new Set(stack);
    nextStack.add(nodeId);
    for (const dep of node.dependsOn) {
      if (nextStack.has(dep)) continue; // skip cycles
      const w = callWeight(node, dep);
      const whole = Math.floor(w);
      const frac = w - whole;
      const count = whole + (rng() < frac ? 1 : 0);
      for (let i = 0; i < count; i++) visit(dep, nextStack);
    }
  };

  visit(model.entrypoint, new Set());
  return route;
}

export interface SystemCapacity {
  saturationRps: number;
  bottleneckId: string;
  perStation: { id: string; visits: number; capacityRps: number; servers: number }[];
}

/**
 * Exact external request rate at which the first tier saturates, and which tier
 * that is. capacityRps for a tier = its raw saturation rate / visits-per-request.
 */
export function systemSaturationRps(model: SystemModel): SystemCapacity {
  const visits = computeVisits(model);
  const sync = reachableFromEntry(model);
  const byId = new Map(model.components.map((c) => [c.id, c]));
  let min = Number.POSITIVE_INFINITY;
  let bottleneckId = model.entrypoint;
  const perStation: SystemCapacity["perStation"] = [];
  for (const [id, v] of visits) {
    if (v <= 0) continue;
    // async tiers (off the request path) cap job throughput, not request latency
    if (!sync.has(id)) continue;
    const c = byId.get(id)!;
    const servers = serversOf(c);
    const raw = stationSaturationRps(c.serviceTimeMs, servers);
    const capacityRps = raw / v;
    perStation.push({ id, visits: v, capacityRps, servers });
    if (capacityRps < min) {
      min = capacityRps;
      bottleneckId = id;
    }
  }
  return { saturationRps: min, bottleneckId, perStation };
}
