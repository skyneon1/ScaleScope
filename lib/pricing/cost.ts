import type {
  Cloud,
  CloudCost,
  CostComparison,
  CostLineItem,
  SystemModel,
  TrafficProfile,
} from "../model/types";
import { computeVisits } from "../sim/topology";
import { requiredInstances } from "../sim/queueing";
import {
  HOURS_PER_MONTH,
  InstanceFamily,
  PRICING,
  pickInstance,
  SECONDS_PER_MONTH,
} from "./catalog";

const TARGET_UTILIZATION = 0.65; // headroom for spikes & rolling deploys

export interface TierSizing {
  componentId: string;
  name: string;
  kind: string;
  instances: number;
  perInstanceVcpu: number;
  perInstanceMemGb: number;
  peakArrivalRps: number;
}

function familyForKind(kind: string): InstanceFamily {
  switch (kind) {
    case "database":
      return "db";
    case "cache":
      return "cache";
    case "api":
    case "worker":
      return "compute";
    default:
      return "general";
  }
}

/**
 * Size every tier for peak traffic: enough instances to keep both concurrency
 * (queueing) and CPU under the utilization target, and the per-instance vCPU/mem
 * needed to pick a SKU.
 */
export function sizeTiers(model: SystemModel, peakRps: number): TierSizing[] {
  const visits = computeVisits(model);
  const out: TierSizing[] = [];
  for (const c of model.components) {
    const v = visits.get(c.id) ?? 0;
    const peakArrival = peakRps * v;
    const byConcurrency = requiredInstances(
      peakArrival,
      c.serviceTimeMs,
      c.workersPerInstance,
      TARGET_UTILIZATION,
    );
    const instances = Math.max(c.instances, byConcurrency);
    const perInstanceRps = instances > 0 ? peakArrival / instances : 0;
    // CPU-cores busy per instance = rps * cpu-seconds/req, with headroom.
    const cpuCores = (perInstanceRps * c.cpuMsPerReq) / 1000;
    const perInstanceVcpu = Math.max(1, Math.ceil(cpuCores / 0.7));
    const perInstanceMemGb = Math.max(
      0.5,
      (c.memMbBaseline + (c.memMbPerReq ?? 0) * c.workersPerInstance) / 1024,
    );
    out.push({
      componentId: c.id,
      name: c.name,
      kind: c.kind,
      instances,
      perInstanceVcpu,
      perInstanceMemGb,
      peakArrivalRps: peakArrival,
    });
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Price a fully-sized topology on one cloud. */
export function priceCloud(
  cloud: Cloud,
  model: SystemModel,
  traffic: TrafficProfile,
  sizing: TierSizing[],
): CloudCost {
  const pricing = PRICING[cloud];
  const byId = new Map(model.components.map((c) => [c.id, c]));
  const visits = computeVisits(model);
  const lineItems: CostLineItem[] = [];

  const monthlyRequests = traffic.baselineRps * SECONDS_PER_MONTH;

  for (const s of sizing) {
    const c = byId.get(s.componentId)!;
    if (c.kind === "external") {
      lineItems.push({
        componentId: c.id,
        name: c.name,
        resource: "third-party API",
        quantity: 1,
        unitMonthlyUsd: 0,
        monthlyUsd: 0,
        note: "external dependency — bill from provider",
      });
      continue;
    }
    if (c.kind === "load_balancer") {
      lineItems.push({
        componentId: c.id,
        name: c.name,
        resource: pricing.loadBalancerUsdPerMonth > 0 ? "managed load balancer" : "included routing",
        quantity: 1,
        unitMonthlyUsd: round2(pricing.loadBalancerUsdPerMonth),
        monthlyUsd: round2(pricing.loadBalancerUsdPerMonth),
      });
      continue;
    }

    if (pricing.serverless && (c.kind === "api" || c.kind === "web" || c.kind === "worker")) {
      // Serverless function pricing (Active CPU model).
      const v = visits.get(c.id) ?? 1;
      const invocations = monthlyRequests * v;
      const activeCpuHours = (invocations * c.cpuMsPerReq) / 3_600_000;
      const memGb = Math.min(4, Math.max(0.25, c.memMbBaseline / 1024));
      const invCost = (invocations / 1_000_000) * pricing.serverless.invocationUsdPerMillion;
      const cpuCost = activeCpuHours * pricing.serverless.activeCpuUsdPerHour;
      const memCost = activeCpuHours * memGb * pricing.serverless.memoryUsdPerGbHour;
      const monthly = invCost + cpuCost + memCost;
      lineItems.push({
        componentId: c.id,
        name: c.name,
        resource: "serverless function",
        quantity: Math.round(invocations),
        unitMonthlyUsd: round2(pricing.serverless.invocationUsdPerMillion),
        monthlyUsd: round2(monthly),
        note: `${(invocations / 1e6).toFixed(1)}M invocations · ${activeCpuHours.toFixed(0)} active CPU-h`,
      });
      continue;
    }

    if (pricing.managed && pricing.managed[c.kind]) {
      const m = pricing.managed[c.kind];
      const v = visits.get(c.id) ?? 1;
      const ops = monthlyRequests * v;
      const monthly = m.baseUsdPerMonth + (ops / 1_000_000) * m.usdPerMillionOps;
      lineItems.push({
        componentId: c.id,
        name: c.name,
        resource: "managed (marketplace)",
        quantity: 1,
        unitMonthlyUsd: round2(m.baseUsdPerMonth),
        monthlyUsd: round2(monthly),
        note: `${(ops / 1e6).toFixed(1)}M ops/mo`,
      });
      continue;
    }

    // VM/instance pricing.
    const family = familyForKind(c.kind);
    const inst = pickInstance(pricing, family, s.perInstanceVcpu, s.perInstanceMemGb);
    const unitMonthly = inst.usdPerHour * HOURS_PER_MONTH;
    lineItems.push({
      componentId: c.id,
      name: c.name,
      resource: inst.name,
      quantity: s.instances,
      unitMonthlyUsd: round2(unitMonthly),
      monthlyUsd: round2(unitMonthly * s.instances),
      note: `${s.instances}× (${inst.vcpu} vCPU / ${inst.memGb} GB)`,
    });
  }

  // Data transfer (egress) at baseline traffic.
  const egressGb = (monthlyRequests * traffic.avgResponseKb) / (1024 * 1024);
  const dataTransferMonthlyUsd = round2(egressGb * pricing.egressUsdPerGb);

  // Storage (if a storage tier exists) — assume a modest 100 GB working set.
  const hasStorage = model.components.some((c) => c.kind === "storage");
  const storageGb = hasStorage ? 100 : 0;
  const storageMonthlyUsd = round2(storageGb * pricing.storageUsdPerGbMonth);

  const computeMonthlyUsd = round2(lineItems.reduce((sum, li) => sum + li.monthlyUsd, 0));
  const totalMonthlyUsd = round2(computeMonthlyUsd + dataTransferMonthlyUsd + storageMonthlyUsd);
  const costPerMillionRequestsUsd =
    monthlyRequests > 0 ? round2(totalMonthlyUsd / (monthlyRequests / 1_000_000)) : 0;

  return {
    cloud,
    lineItems,
    computeMonthlyUsd,
    dataTransferMonthlyUsd,
    storageMonthlyUsd,
    totalMonthlyUsd,
    costPerMillionRequestsUsd,
  };
}

/** Price the topology across AWS, GCP and Vercel and rank them. */
export function compareClouds(
  model: SystemModel,
  traffic: TrafficProfile,
): CostComparison {
  const peakRps = Math.max(traffic.baselineRps, traffic.peakRps || traffic.baselineRps);
  const sizing = sizeTiers(model, peakRps);
  const clouds: CloudCost[] = (["aws", "gcp", "vercel"] as Cloud[]).map((c) =>
    priceCloud(c, model, traffic, sizing),
  );
  const sorted = [...clouds].sort((a, b) => a.totalMonthlyUsd - b.totalMonthlyUsd);
  const cheapest = sorted[0].cloud;
  const spreadUsd = round2(
    sorted[sorted.length - 1].totalMonthlyUsd - sorted[0].totalMonthlyUsd,
  );
  return { clouds, cheapest, spreadUsd };
}
