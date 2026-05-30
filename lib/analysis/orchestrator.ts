import type { AnalysisRequest, AnalysisResult } from "../model/types";
import { buildCapacityCurve, simulate, waterfall } from "../sim";
import { compareClouds } from "../pricing/cost";
import { generateIac } from "../iac";
import { profile, type ProfileSource } from "../ai/profiler";
import { narrate } from "../ai/advisor";
import { assessSlo } from "./slo";
import { assessResilience } from "./resilience";
import { planScaling } from "./scaling";
import { findOptimizations } from "./optimize";
import { assessReadiness } from "./readiness";

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export type AnalysisEvent =
  | { type: "profiled" }
  | { type: "analysed"; partial: AnalysisResult };

/**
 * Full analysis pipeline: profile → simulate (baseline, peak, capacity sweep) →
 * cost → SLO/resilience/scaling/optimization/readiness → IaC → narrative.
 *
 * onEvent fires at key checkpoints so callers can stream partial results.
 */
export async function analyze(
  req: AnalysisRequest,
  onEvent?: (event: AnalysisEvent) => void,
): Promise<AnalysisResult> {
  const source: ProfileSource =
    req.source.type === "description"
      ? { type: "description", text: req.source.text }
      : req.source.type === "repo"
        ? { type: "repo", url: req.source.url }
        : { type: "model", model: req.source.model };

  const profiled = await profile(source);
  onEvent?.({ type: "profiled" });

  const model = profiled.model;
  const { traffic, slo } = req;
  const peakRps = Math.max(traffic.baselineRps, traffic.peakRps || traffic.baselineRps);

  // Simulations (CPU-bound, fast).
  const baseline = simulate(model, traffic.baselineRps, { arrivals: 20_000 });
  const peak = simulate(model, peakRps, { arrivals: 20_000 });
  const capacity = buildCapacityCurve(model, slo, traffic.baselineRps);
  const hops = waterfall(model, traffic.baselineRps);

  // Cost & analyses.
  const cost = compareClouds(model, traffic);
  const sloAssessment = assessSlo(model, traffic, slo, baseline, capacity);
  const resilience = assessResilience(model);
  const scaling = planScaling(model, traffic);
  const optimizations = findOptimizations(model, traffic, cost);
  const readiness = assessReadiness(
    model,
    traffic,
    sloAssessment,
    resilience,
    capacity,
    cost,
    optimizations.some((o) => o.category === "rightsizing"),
  );
  const iac = generateIac(model, traffic);

  const partial: AnalysisResult = {
    id: randomId(),
    createdAt: new Date().toISOString(),
    model,
    traffic,
    slo,
    baseline,
    peak,
    capacity,
    waterfall: hops,
    cost,
    sloAssessment,
    resilience,
    scaling,
    optimizations,
    readiness,
    iac,
    llmProfiled: profiled.llmProfiled,
    warnings: profiled.warnings,
    narrative: "",
    llmNarrated: false,
  };

  onEvent?.({ type: "analysed", partial });

  const { narrative, llmNarrated } = await narrate(partial);
  return { ...partial, narrative, llmNarrated };
}
