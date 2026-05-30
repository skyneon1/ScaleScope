import type {
  CapacityCurve,
  ChecklistItem,
  CostComparison,
  ReadinessReport,
  ResilienceReport,
  SloAssessment,
  SystemModel,
  TrafficProfile,
} from "../model/types";

const SCORE: Record<ChecklistItem["status"], number> = {
  pass: 1,
  warn: 0.5,
  manual: 0.5,
  fail: 0,
};

function grade(score: number): ReadinessReport["grade"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

/**
 * Roll the whole analysis into a production-readiness scorecard across six
 * categories. Items the engine can't verify statically are marked `manual` so
 * they appear on the launch checklist without falsely claiming pass/fail.
 */
export function assessReadiness(
  model: SystemModel,
  traffic: TrafficProfile,
  sloAssessment: SloAssessment,
  resilience: ResilienceReport,
  capacity: CapacityCurve,
  comparison: CostComparison,
  hasRightsizing: boolean,
): ReadinessReport {
  const items: ChecklistItem[] = [];
  const hasCriticalSpof = resilience.findings.some((f) => f.severity === "critical");
  const entry = model.components.find((c) => c.id === model.entrypoint);
  const statefulNonHa = model.components.filter(
    (c) => c.stateful && !(c.replicated && c.instances >= 2),
  );

  // --- reliability ---
  items.push({
    id: "no-critical-spof",
    category: "reliability",
    label: "No critical single points of failure",
    status: hasCriticalSpof ? "fail" : resilience.singlePointsOfFailure.length ? "warn" : "pass",
    detail: hasCriticalSpof
      ? `Critical SPOF(s): ${resilience.findings
          .filter((f) => f.severity === "critical")
          .map((f) => f.name)
          .join(", ")}.`
      : resilience.singlePointsOfFailure.length
        ? "Some tiers lack redundancy — see resilience findings."
        : "All tiers have redundancy.",
  });
  items.push({
    id: "entry-redundancy",
    category: "reliability",
    label: "Entry tier is redundant",
    status: entry && entry.replicated && entry.instances >= 2 ? "pass" : "warn",
    detail:
      entry && entry.replicated && entry.instances >= 2
        ? `${entry.name} runs ${entry.instances} replicas.`
        : "Run ≥2 replicas of the entry tier across AZs.",
  });
  items.push({
    id: "backups",
    category: "reliability",
    label: "Backups & point-in-time recovery for stateful tiers",
    status: model.components.some((c) => c.stateful) ? "manual" : "pass",
    detail: model.components.some((c) => c.stateful)
      ? "Verify automated backups, PITR and tested restores for every datastore."
      : "No stateful tiers.",
  });

  // --- scalability ---
  const headroom = sloAssessment.headroomToSloBreakPct;
  items.push({
    id: "headroom",
    category: "scalability",
    label: "Traffic headroom before SLO breach",
    status: headroom >= 100 ? "pass" : headroom >= 0 ? "warn" : "fail",
    detail:
      headroom >= 0
        ? `~${Math.round(headroom)}% headroom (SLO breaks ≈ ${Math.round(capacity.sloBreakRps)} rps).`
        : "Baseline traffic already exceeds the SLO-safe ceiling.",
  });
  const autoscaleSet = model.components
    .filter((c) => !c.stateful && c.kind !== "external" && c.kind !== "load_balancer")
    .every((c) => typeof c.maxInstances === "number");
  items.push({
    id: "autoscale-ceiling",
    category: "scalability",
    label: "Autoscaling ceilings defined",
    status: autoscaleSet ? "pass" : "warn",
    detail: autoscaleSet
      ? "Stateless tiers have max-instance ceilings."
      : "Set max-instance ceilings so a traffic spike can't run away with cost.",
  });
  items.push({
    id: "stateful-scaling",
    category: "scalability",
    label: "Stateful scaling plan",
    status: statefulNonHa.length ? "warn" : "pass",
    detail: statefulNonHa.length
      ? `${statefulNonHa.map((c) => c.name).join(", ")} need replicas/sharding before they saturate.`
      : "Stateful tiers are HA.",
  });

  // --- security (not statically verifiable -> manual) ---
  for (const [id, label, detail] of [
    ["tls", "TLS everywhere", "Terminate TLS at the edge and encrypt internal hops; enforce HSTS."],
    ["secrets", "Secrets management", "Use a managed secret store; no secrets in env files or images."],
    ["rate-limit", "Rate limiting & abuse protection", "Add per-client rate limits and request validation at the edge."],
    ["waf-ddos", "WAF / DDoS protection", "Enable a managed WAF and DDoS mitigation in front of the entry tier."],
  ] as const) {
    items.push({ id, category: "security", label, status: "manual", detail });
  }

  // --- observability (manual) ---
  for (const [id, label, detail] of [
    ["metrics", "Metrics & dashboards", "Export RED/USE metrics per tier with dashboards."],
    ["alerting", "SLO-based alerting", "Alert on burn-rate of the error budget, not just raw thresholds."],
    ["tracing", "Distributed tracing", "Propagate trace context across tiers to locate latency."],
  ] as const) {
    items.push({ id, category: "observability", label, status: "manual", detail });
  }

  // --- cost ---
  const cheapest = comparison.clouds.find((c) => c.cloud === comparison.cheapest)!;
  const cpm = cheapest.costPerMillionRequestsUsd;
  items.push({
    id: "cost-efficiency",
    category: "cost",
    label: "Cost per million requests",
    status: cpm < 50 ? "pass" : cpm < 200 ? "warn" : "fail",
    detail: `≈ $${cpm}/M requests on ${cheapest.cloud.toUpperCase()} (cheapest of the three).`,
  });
  items.push({
    id: "no-overprovision",
    category: "cost",
    label: "No major overprovisioning",
    status: hasRightsizing ? "warn" : "pass",
    detail: hasRightsizing
      ? "Some tiers are larger than baseline needs — see optimizations."
      : "Baseline sizing is efficient.",
  });

  // --- operations ---
  items.push({
    id: "iac",
    category: "operations",
    label: "Infrastructure as Code",
    status: "pass",
    detail: "Terraform / Kubernetes / Compose generated for this topology.",
  });
  items.push({
    id: "rollout",
    category: "operations",
    label: "Safe deploys (canary / blue-green)",
    status: "manual",
    detail: "Use rolling/canary releases with automated rollback on SLO regression.",
  });
  items.push({
    id: "runbooks",
    category: "operations",
    label: "Runbooks & on-call",
    status: "manual",
    detail: "Document failure-mode runbooks and an on-call rotation before launch.",
  });

  // --- scoring ---
  const categories: ChecklistItem["category"][] = [
    "reliability",
    "scalability",
    "security",
    "observability",
    "cost",
    "operations",
  ];
  const byCategory = {} as Record<ChecklistItem["category"], number>;
  for (const cat of categories) {
    const inCat = items.filter((i) => i.category === cat);
    const avg = inCat.length ? inCat.reduce((s, i) => s + SCORE[i.status], 0) / inCat.length : 1;
    byCategory[cat] = Math.round(avg * 100);
  }
  const score = Math.round(
    categories.reduce((s, c) => s + byCategory[c], 0) / categories.length,
  );

  return { score, grade: grade(score), byCategory, checklist: items };
}
