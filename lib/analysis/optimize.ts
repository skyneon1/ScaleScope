import type {
  CostComparison,
  OptimizationOpportunity,
  SystemModel,
  TrafficProfile,
} from "../model/types";
import { computeVisits } from "../sim/topology";
import { requiredInstances } from "../sim/queueing";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Surface cost-saving opportunities: overprovisioning, commitment discounts,
 * missing caching, expensive code paths and bursty-traffic autoscaling.
 */
export function findOptimizations(
  model: SystemModel,
  traffic: TrafficProfile,
  comparison: CostComparison,
): OptimizationOpportunity[] {
  const visits = computeVisits(model);
  const cheapest = comparison.clouds.find((c) => c.cloud === comparison.cheapest)!;
  const lineFor = (id: string) => cheapest.lineItems.find((l) => l.componentId === id)?.monthlyUsd ?? 0;
  const out: OptimizationOpportunity[] = [];

  // 1. Rightsizing — instances above what baseline traffic needs.
  let overprovisionedSavings = 0;
  const overprovisioned: string[] = [];
  for (const c of model.components) {
    if (c.stateful || c.kind === "external" || c.kind === "load_balancer") continue;
    const v = visits.get(c.id) ?? 0;
    const need = requiredInstances(traffic.baselineRps * v, c.serviceTimeMs, c.workersPerInstance, 0.65);
    if (c.instances > need) {
      const monthly = lineFor(c.id);
      overprovisionedSavings += (monthly * (c.instances - need)) / c.instances;
      overprovisioned.push(c.name);
    }
  }
  if (overprovisionedSavings > 1) {
    out.push({
      title: "Rightsize overprovisioned tiers",
      category: "rightsizing",
      estimatedMonthlySavingsUsd: round2(overprovisionedSavings),
      effort: "low",
      detail: `${overprovisioned.join(", ")} run more instances than baseline traffic requires. Lower the baseline count and let autoscaling handle peaks.`,
    });
  }

  // 2. Commitment discounts on steady-state compute.
  const commitmentRate = comparison.cheapest === "vercel" ? 0.1 : 0.4;
  const computeSavings = cheapest.computeMonthlyUsd * commitmentRate;
  if (computeSavings > 5) {
    out.push({
      title:
        comparison.cheapest === "vercel"
          ? "Move to an annual/committed plan"
          : "Buy reserved / committed-use compute",
      category: "commitment",
      estimatedMonthlySavingsUsd: round2(computeSavings),
      effort: "low",
      detail:
        comparison.cheapest === "vercel"
          ? "Steady baseline load qualifies for committed-use discounts on most platforms."
          : `Baseline load is steady — 1–3 yr reserved instances / committed use typically cut on-demand compute by ~${Math.round(
              commitmentRate * 100,
            )}%.`,
    });
  }

  // 3. Missing cache in front of a busy database.
  const hasCache = model.components.some((c) => c.kind === "cache");
  const db = model.components.find((c) => c.kind === "database");
  if (!hasCache && db) {
    const dbCost = lineFor(db.id);
    if (dbCost > 0) {
      out.push({
        title: "Add a cache in front of the database",
        category: "caching",
        estimatedMonthlySavingsUsd: round2(dbCost * 0.3),
        effort: "medium",
        detail:
          "No cache tier detected. A read-through cache for hot keys typically removes 50–80% of read load, letting you run a smaller primary and improving p99.",
      });
    }
  }

  // 4. Expensive per-request CPU on stateless tiers.
  for (const c of model.components) {
    if ((c.kind === "api" || c.kind === "web" || c.kind === "worker") && c.cpuMsPerReq > 50) {
      const monthly = lineFor(c.id);
      const savings = monthly * 0.2;
      if (savings > 5) {
        out.push({
          title: `Optimize hot path in ${c.name}`,
          category: "architecture",
          estimatedMonthlySavingsUsd: round2(savings),
          effort: "high",
          detail: `${c.name} burns ${c.cpuMsPerReq} ms CPU/request. Profiling and shaving 20% of CPU directly reduces instance count and cost.`,
        });
      }
    }
  }

  // 5. Bursty traffic on fixed capacity.
  const peak = traffic.peakRps || traffic.baselineRps;
  if (peak > traffic.baselineRps * 1.8) {
    const elasticSavings = cheapest.computeMonthlyUsd * (1 - traffic.baselineRps / peak) * 0.5;
    if (elasticSavings > 5) {
      out.push({
        title: "Autoscale instead of provisioning for peak",
        category: "traffic",
        estimatedMonthlySavingsUsd: round2(elasticSavings),
        effort: "medium",
        detail: `Peak (${peak} rps) is ${(peak / traffic.baselineRps).toFixed(
          1,
        )}× baseline. Scaling to demand rather than running peak capacity 24/7 reclaims the idle margin.`,
      });
    }
  }

  return out.sort((a, b) => b.estimatedMonthlySavingsUsd - a.estimatedMonthlySavingsUsd);
}
