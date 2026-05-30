import type { Component, ResilienceFinding, ResilienceReport, Severity, SystemModel } from "../model/types";
import { reachableFromEntry } from "../sim/topology";

const SEVERITY_PENALTY: Record<Severity, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 4,
  info: 0,
};

function blastRadius(c: Component, onPath: boolean): string {
  switch (c.kind) {
    case "database":
      return "Every read/write that touches this datastore fails or stalls — typically a full outage of dependent features.";
    case "cache":
      return "Cache misses fall through to the origin; downstream datastores can saturate and cascade into a wider outage (thundering herd).";
    case "load_balancer":
      return "All ingress traffic is dropped — complete outage until traffic is rerouted.";
    case "queue":
      return "Async work stops being accepted or processed; backlog grows and jobs may be lost.";
    case "api":
    case "web":
      return onPath
        ? "Requests routed to this tier fail until capacity is replaced."
        : "Degraded functionality for features served by this tier.";
    case "external":
      return "Requests depending on this third party fail or hang unless a fallback/timeout exists.";
    case "search":
      return "Search/discovery features fail; may degrade gracefully if the primary store can answer.";
    case "storage":
      return "Object reads/writes fail; uploads and media delivery are affected.";
    default:
      return "Dependent functionality degrades or fails.";
  }
}

/**
 * Static resilience analysis: single points of failure, blast radius and
 * redundancy gaps, scored 0-100.
 */
export function assessResilience(model: SystemModel): ResilienceReport {
  const reachable = reachableFromEntry(model);
  const findings: ResilienceFinding[] = [];
  const spofs: string[] = [];

  for (const c of model.components) {
    const onPath = reachable.has(c.id);
    const single = !c.replicated || c.instances < 2;

    if (single && c.kind !== "external") {
      spofs.push(c.id);
      const critical = c.stateful || c.kind === "load_balancer" || (onPath && c.kind === "database");
      const severity: Severity = critical ? "critical" : onPath ? "high" : "medium";
      findings.push({
        componentId: c.id,
        name: c.name,
        severity,
        title: `${c.name} is a single point of failure`,
        detail: c.stateful
          ? `${c.name} holds state and runs without redundancy. A node loss causes data-plane downtime and possible data loss.`
          : `${c.name} runs as a single replica. Losing the node (deploy, crash, AZ failure) drops its capacity entirely.`,
        blastRadius: blastRadius(c, onPath),
        recommendation: c.stateful
          ? "Run a primary + standby (or managed HA) with automated failover; enable PITR backups and test restores."
          : "Run at least 2 replicas across availability zones behind the load balancer; enable health checks and auto-replacement.",
      });
    }

    if (c.kind === "external") {
      findings.push({
        componentId: c.id,
        name: c.name,
        severity: "medium",
        title: `${c.name} is an external dependency`,
        detail: "Third-party latency and availability are outside your control and directly impact your SLO.",
        blastRadius: blastRadius(c, onPath),
        recommendation:
          "Add aggressive timeouts, retries with backoff, a circuit breaker, and a cached/degraded fallback path.",
      });
    }

    if (c.kind === "cache" && onPath && single) {
      findings.push({
        componentId: c.id,
        name: c.name,
        severity: "high",
        title: `${c.name} masks load on downstream stores`,
        detail:
          "If this cache fails, traffic falls through to the origin datastore which may not be provisioned for the un-cached load.",
        blastRadius: "Sudden origin load spike → datastore saturation → cascading latency and errors.",
        recommendation:
          "Replicate the cache, add request coalescing / stampede protection, and size the origin for a partial cache outage.",
      });
    }
  }

  // No load balancer in front of a multi-instance entry tier.
  const entry = model.components.find((c) => c.id === model.entrypoint);
  const hasLb = model.components.some((c) => c.kind === "load_balancer");
  if (entry && entry.instances > 1 && !hasLb && entry.kind !== "load_balancer") {
    findings.push({
      componentId: entry.id,
      name: entry.name,
      severity: "medium",
      title: "No load balancer in front of the entry tier",
      detail: `${entry.name} runs ${entry.instances} instances but there is no load balancer to distribute traffic or health-check them.`,
      blastRadius: "Uneven load, no automated failover when an instance is unhealthy.",
      recommendation: "Place a managed load balancer (with health checks) in front of the entry tier.",
    });
  }

  // Single-region note (we don't model regions).
  findings.push({
    componentId: model.entrypoint,
    name: model.name,
    severity: "info",
    title: "Multi-AZ / multi-region not verified",
    detail:
      "This analysis assumes a single region. Regional failure would take the whole system down.",
    blastRadius: "Full outage on a regional incident.",
    recommendation:
      "Deploy across ≥2 availability zones at minimum; consider multi-region active-passive for strict availability targets.",
  });

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  const penalty = findings.reduce((sum, f) => sum + SEVERITY_PENALTY[f.severity], 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return { findings, singlePointsOfFailure: spofs, score };
}
