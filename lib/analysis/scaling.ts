import type { Component, ScalingPlan, SystemModel, TierScalingPlan, TrafficProfile } from "../model/types";
import { computeVisits } from "../sim/topology";
import { requiredInstances } from "../sim/queueing";

const TARGET = 0.65;

function strategyFor(c: Component): TierScalingPlan["strategy"] {
  if (c.kind === "external") return "fixed";
  if (c.kind === "load_balancer") return "managed";
  if (c.stateful) return "managed"; // databases/caches scale via managed HA, replicas, sharding
  return "horizontal";
}

/**
 * Produce a per-tier scaling plan: strategy, autoscaling floor/ceiling and the
 * target utilization to scale on, derived from the baseline and peak traffic.
 */
export function planScaling(model: SystemModel, traffic: TrafficProfile): ScalingPlan {
  const visits = computeVisits(model);
  const peakRps = Math.max(traffic.baselineRps, traffic.peakRps || traffic.baselineRps);
  const tiers: TierScalingPlan[] = [];
  const notes: string[] = [];

  for (const c of model.components) {
    const v = visits.get(c.id) ?? 0;
    const strategy = strategyFor(c);
    const baselineInstances = Math.max(
      c.instances,
      requiredInstances(traffic.baselineRps * v, c.serviceTimeMs, c.workersPerInstance, TARGET),
    );
    const peakInstances = Math.max(
      baselineInstances,
      requiredInstances(peakRps * v, c.serviceTimeMs, c.workersPerInstance, TARGET),
    );

    let minInstances: number;
    let rationale: string;
    if (strategy === "horizontal") {
      minInstances = Math.max(2, Math.ceil(baselineInstances * 0.5));
      rationale = `Stateless tier — scale horizontally on CPU/RPS. Keep ≥2 for HA; ${baselineInstances}→${peakInstances} instances across baseline→peak.`;
    } else if (strategy === "managed") {
      minInstances = c.stateful ? Math.max(2, baselineInstances) : baselineInstances;
      rationale = c.stateful
        ? `Stateful — use managed HA. Writes don't scale horizontally: add read replicas / connection pooling, and shard or move to CQRS before the primary saturates.`
        : `Use the platform's managed/auto-scaled offering.`;
    } else if (strategy === "fixed") {
      minInstances = 1;
      rationale = `External dependency — capacity is the provider's. Protect with timeouts, retries and a circuit breaker.`;
    } else {
      minInstances = baselineInstances;
      rationale = "Vertical scaling only — size the node for peak.";
    }

    tiers.push({
      componentId: c.id,
      name: c.name,
      kind: c.kind,
      strategy,
      minInstances,
      baselineInstances,
      peakInstances,
      targetUtilizationPct: Math.round(TARGET * 100),
      rationale,
    });
  }

  if (traffic.shape === "spike" || (traffic.peakRps && traffic.peakRps > traffic.baselineRps * 2)) {
    notes.push(
      "Traffic is spiky: configure fast scale-out (short cooldown, aggressive step) and pre-warm before known events; consider a queue to absorb bursts.",
    );
  }
  const statefulNonHa = model.components.filter((c) => c.stateful && !(c.replicated && c.instances >= 2));
  if (statefulNonHa.length) {
    notes.push(
      `Stateful tiers without HA (${statefulNonHa
        .map((c) => c.name)
        .join(", ")}) are the scaling ceiling — plan replicas/sharding early.`,
    );
  }
  if (traffic.shape === "growth" && traffic.monthlyGrowthPct) {
    notes.push(
      `At ${traffic.monthlyGrowthPct}%/month growth, capacity planning should run quarterly; the bottleneck tier dictates lead time for provisioning.`,
    );
  }
  notes.push("Set autoscaling on a leading signal (RPS or queue depth), not just CPU, for IO-bound tiers.");

  return { tiers, notes };
}
