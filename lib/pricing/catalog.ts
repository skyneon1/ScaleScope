import type { Cloud } from "../model/types";

/**
 * Approximate on-demand list prices (USD), US regions, late-2025.
 * These are intended for *relative* comparison and order-of-magnitude budgeting,
 * not invoice-accurate quotes. Reserved/committed-use discounts are modelled
 * separately in the optimizer.
 */
export const PRICING_DISCLAIMER =
  "Approximate on-demand US list prices (late 2025). For relative comparison and budgeting — not a quote. Reserved/committed-use savings shown separately.";

export const HOURS_PER_MONTH = 730;
export const SECONDS_PER_MONTH = 2_592_000; // 30 days

export type InstanceFamily = "general" | "compute" | "db" | "cache";

export interface InstanceType {
  name: string;
  vcpu: number;
  memGb: number;
  usdPerHour: number;
  family: InstanceFamily;
}

export interface CloudPricing {
  cloud: Cloud;
  /** VM/instance catalog (empty for serverless-first clouds). */
  instances: InstanceType[];
  egressUsdPerGb: number;
  storageUsdPerGbMonth: number;
  loadBalancerUsdPerMonth: number;
  /** Serverless function rates (used by Vercel-style pricing). */
  serverless?: {
    invocationUsdPerMillion: number;
    activeCpuUsdPerHour: number; // per vCPU-hour of active compute
    memoryUsdPerGbHour: number; // provisioned memory while active
  };
  /** Managed data service base + per-million-ops rate, by component kind. */
  managed?: Record<string, { baseUsdPerMonth: number; usdPerMillionOps: number }>;
}

const AWS: CloudPricing = {
  cloud: "aws",
  egressUsdPerGb: 0.09,
  storageUsdPerGbMonth: 0.023,
  loadBalancerUsdPerMonth: 22, // ALB base ~ $0.0225/hr
  instances: [
    { name: "t3.medium", vcpu: 2, memGb: 4, usdPerHour: 0.0416, family: "general" },
    { name: "m6i.large", vcpu: 2, memGb: 8, usdPerHour: 0.096, family: "general" },
    { name: "m6i.xlarge", vcpu: 4, memGb: 16, usdPerHour: 0.192, family: "general" },
    { name: "m6i.2xlarge", vcpu: 8, memGb: 32, usdPerHour: 0.384, family: "general" },
    { name: "m6i.4xlarge", vcpu: 16, memGb: 64, usdPerHour: 0.768, family: "general" },
    { name: "c6i.large", vcpu: 2, memGb: 4, usdPerHour: 0.085, family: "compute" },
    { name: "c6i.xlarge", vcpu: 4, memGb: 8, usdPerHour: 0.17, family: "compute" },
    { name: "c6i.2xlarge", vcpu: 8, memGb: 16, usdPerHour: 0.34, family: "compute" },
    { name: "db.m6g.large", vcpu: 2, memGb: 8, usdPerHour: 0.171, family: "db" },
    { name: "db.m6g.xlarge", vcpu: 4, memGb: 16, usdPerHour: 0.342, family: "db" },
    { name: "db.r6g.xlarge", vcpu: 4, memGb: 32, usdPerHour: 0.452, family: "db" },
    { name: "db.r6g.2xlarge", vcpu: 8, memGb: 64, usdPerHour: 0.904, family: "db" },
    { name: "cache.m6g.large", vcpu: 2, memGb: 6.4, usdPerHour: 0.156, family: "cache" },
    { name: "cache.m6g.xlarge", vcpu: 4, memGb: 12.9, usdPerHour: 0.311, family: "cache" },
  ],
};

const GCP: CloudPricing = {
  cloud: "gcp",
  egressUsdPerGb: 0.12,
  storageUsdPerGbMonth: 0.02,
  loadBalancerUsdPerMonth: 18,
  instances: [
    { name: "e2-medium", vcpu: 2, memGb: 4, usdPerHour: 0.0335, family: "general" },
    { name: "n2-standard-2", vcpu: 2, memGb: 8, usdPerHour: 0.0971, family: "general" },
    { name: "n2-standard-4", vcpu: 4, memGb: 16, usdPerHour: 0.1942, family: "general" },
    { name: "n2-standard-8", vcpu: 8, memGb: 32, usdPerHour: 0.3885, family: "general" },
    { name: "n2-standard-16", vcpu: 16, memGb: 64, usdPerHour: 0.7769, family: "general" },
    { name: "c2-standard-4", vcpu: 4, memGb: 16, usdPerHour: 0.2088, family: "compute" },
    { name: "c2-standard-8", vcpu: 8, memGb: 32, usdPerHour: 0.4176, family: "compute" },
    { name: "sql-db-n1-2", vcpu: 2, memGb: 8, usdPerHour: 0.18, family: "db" },
    { name: "sql-db-n1-4", vcpu: 4, memGb: 16, usdPerHour: 0.36, family: "db" },
    { name: "sql-db-n1-8", vcpu: 8, memGb: 32, usdPerHour: 0.72, family: "db" },
    { name: "memorystore-m1", vcpu: 2, memGb: 6, usdPerHour: 0.16, family: "cache" },
    { name: "memorystore-m2", vcpu: 4, memGb: 13, usdPerHour: 0.32, family: "cache" },
  ],
};

// Vercel: serverless-first (Fluid Compute / Active CPU pricing) + Marketplace data.
const VERCEL: CloudPricing = {
  cloud: "vercel",
  egressUsdPerGb: 0.15, // fast data transfer
  storageUsdPerGbMonth: 0.023, // Vercel Blob
  loadBalancerUsdPerMonth: 0, // routing is included
  instances: [], // no VMs
  serverless: {
    invocationUsdPerMillion: 0.6,
    activeCpuUsdPerHour: 0.128,
    memoryUsdPerGbHour: 0.0106,
  },
  managed: {
    // Marketplace partners (Neon / Upstash / etc.) — base + usage.
    database: { baseUsdPerMonth: 19, usdPerMillionOps: 0.55 },
    cache: { baseUsdPerMonth: 10, usdPerMillionOps: 0.2 },
    queue: { baseUsdPerMonth: 10, usdPerMillionOps: 0.3 },
    search: { baseUsdPerMonth: 25, usdPerMillionOps: 0.6 },
    storage: { baseUsdPerMonth: 5, usdPerMillionOps: 0.1 },
  },
};

export const PRICING: Record<Cloud, CloudPricing> = { aws: AWS, gcp: GCP, vercel: VERCEL };

/** Pick the cheapest instance in a family meeting vCPU and memory requirements. */
export function pickInstance(
  pricing: CloudPricing,
  family: InstanceFamily,
  vcpuNeeded: number,
  memGbNeeded: number,
): InstanceType {
  const pool = pricing.instances.filter((i) => i.family === family);
  const fallback = pricing.instances.filter((i) => i.family === "general");
  const candidates = (pool.length ? pool : fallback).slice().sort((a, b) => a.usdPerHour - b.usdPerHour);
  const fit = candidates.find((i) => i.vcpu >= vcpuNeeded && i.memGb >= memGbNeeded);
  // if nothing fits (huge per-instance need), return the largest available
  return fit ?? candidates[candidates.length - 1];
}
