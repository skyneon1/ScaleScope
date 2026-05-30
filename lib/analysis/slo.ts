import type {
  CapacityCurve,
  Component,
  SimResult,
  SloAssessment,
  SloTarget,
  SystemModel,
  TrafficProfile,
} from "../model/types";
import { reachableFromEntry } from "../sim/topology";

const MINUTES_PER_MONTH = 43_200; // 30 days

/** Availability of a single tier, accounting for redundancy. */
function tierAvailability(c: Component): number {
  // single-node baseline availability by kind
  const base = c.kind === "external" ? 0.999 : c.stateful ? 0.999 : 0.9995;
  if (c.replicated && c.instances >= 2) {
    // parallel redundancy: system up unless all replicas down
    const n = Math.max(2, c.instances);
    return 1 - Math.pow(1 - base, n);
  }
  return base;
}

/**
 * Assess the architecture against latency and availability SLOs.
 * Latency comes from the simulation; availability is modelled from the
 * redundancy of the tiers on the synchronous request path (series reliability).
 */
export function assessSlo(
  model: SystemModel,
  traffic: TrafficProfile,
  slo: SloTarget,
  baseline: SimResult,
  capacity: CapacityCurve,
): SloAssessment {
  const reachable = reachableFromEntry(model);
  const pathComponents = model.components.filter((c) => reachable.has(c.id));

  // Series availability = product of per-tier availabilities on the path.
  let availability = 1;
  for (const c of pathComponents) availability *= tierAvailability(c);
  const estimatedAvailabilityPct = availability * 100;

  const p99 = baseline.latency.p99;
  const meetsLatency = p99 <= slo.p99LatencyMs && baseline.stable;
  const meetsAvailability = estimatedAvailabilityPct >= slo.availabilityPct;
  const errorBudgetMinutesPerMonth = ((100 - slo.availabilityPct) / 100) * MINUTES_PER_MONTH;

  const headroomToSloBreakPct =
    traffic.baselineRps > 0
      ? ((capacity.sloBreakRps - traffic.baselineRps) / traffic.baselineRps) * 100
      : 0;

  const notes: string[] = [];
  notes.push(
    meetsLatency
      ? `p99 ≈ ${Math.round(p99)} ms at ${traffic.baselineRps} rps, within the ${slo.p99LatencyMs} ms target.`
      : `p99 ≈ ${Math.round(p99)} ms exceeds the ${slo.p99LatencyMs} ms target at ${traffic.baselineRps} rps.`,
  );
  notes.push(
    `Modelled availability ≈ ${estimatedAvailabilityPct.toFixed(3)}% vs ${slo.availabilityPct}% target ` +
      `(error budget ${Math.round(errorBudgetMinutesPerMonth)} min/month).`,
  );
  const weakest = pathComponents
    .filter((c) => !(c.replicated && c.instances >= 2))
    .map((c) => c.name);
  if (weakest.length) {
    notes.push(
      `Availability is capped by non-redundant tier${weakest.length > 1 ? "s" : ""}: ${weakest.join(", ")}.`,
    );
  }
  notes.push(
    headroomToSloBreakPct >= 0
      ? `~${Math.round(headroomToSloBreakPct)}% traffic headroom before p99 breaches the SLO (breaks ≈ ${Math.round(
          capacity.sloBreakRps,
        )} rps).`
      : `Already over the SLO-safe traffic ceiling (~${Math.round(capacity.sloBreakRps)} rps).`,
  );

  return {
    target: slo,
    p99AtBaselineMs: p99,
    meetsLatency,
    estimatedAvailabilityPct,
    meetsAvailability,
    errorBudgetMinutesPerMonth,
    headroomToSloBreakPct,
    notes,
  };
}
