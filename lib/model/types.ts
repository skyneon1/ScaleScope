import type {
  AnalysisRequest,
  Component,
  ComponentKind,
  SloTarget,
  SystemModel,
  TrafficProfile,
  TrafficShape,
} from "./schema";

export type {
  AnalysisRequest,
  Component,
  ComponentKind,
  SloTarget,
  SystemModel,
  TrafficProfile,
  TrafficShape,
};

/** Per-tier load and queueing metrics at a particular request rate. */
export interface StationLoad {
  componentId: string;
  name: string;
  kind: ComponentKind;
  /** times this tier is touched per inbound request (fan-out product). */
  visitsPerRequest: number;
  /** requests/sec actually hitting this tier (= externalRps * visitsPerRequest). */
  arrivalRps: number;
  serviceTimeMs: number;
  /** total parallel servers = instances * workersPerInstance. */
  servers: number;
  instances: number;
  /** 0..1+ — fraction of capacity in use. >=1 means saturated/unstable. */
  utilization: number;
  /** mean time queued before being served, ms. */
  queueWaitMs: number;
  /** mean residence time at this tier (wait + service), ms. */
  residenceMs: number;
  /** instances required to keep utilization under the target headroom at this rate. */
  requiredInstances: number;
}

/** Output of one simulation run at a fixed external request rate. */
export interface SimResult {
  rps: number;
  /** requests/sec that completed successfully. */
  throughput: number;
  latency: LatencyPercentiles;
  stations: StationLoad[];
  /** componentId of the most-utilized (bottleneck) tier. */
  bottleneckId: string;
  /** highest utilization across all tiers (system headroom = 1 - this). */
  maxUtilization: number;
  /** fraction of requests dropped/timed-out (queue overflow or > timeout). */
  dropRate: number;
  /** whether the system is stable (no tier saturated) at this rate. */
  stable: boolean;
}

export interface LatencyPercentiles {
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}

/** A point on the load-vs-performance sweep. */
export interface CapacityPoint {
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  throughput: number;
  maxUtilization: number;
  bottleneckId: string;
  stable: boolean;
}

export interface CapacityCurve {
  points: CapacityPoint[];
  /** highest external RPS the system can sustain before a tier saturates. */
  saturationRps: number;
  /** RPS at which p99 first exceeds the SLO (the practical ceiling). */
  sloBreakRps: number;
  /** RPS where latency starts climbing sharply (the "knee"). */
  kneeRps: number;
  /** the tier that saturates first. */
  bottleneckId: string;
}

/** A single hop in the end-to-end latency waterfall. */
export interface WaterfallHop {
  componentId: string;
  name: string;
  kind: ComponentKind;
  queueWaitMs: number;
  serviceMs: number;
  totalMs: number;
  pctOfTotal: number;
}

// ---------- Cost ----------

export type Cloud = "aws" | "gcp" | "vercel";

export interface CostLineItem {
  componentId: string;
  name: string;
  resource: string; // chosen instance/SKU
  quantity: number; // instance count or units
  unitMonthlyUsd: number;
  monthlyUsd: number;
  note?: string;
}

export interface CloudCost {
  cloud: Cloud;
  lineItems: CostLineItem[];
  computeMonthlyUsd: number;
  dataTransferMonthlyUsd: number;
  storageMonthlyUsd: number;
  totalMonthlyUsd: number;
  /** cost per million requests at baseline traffic. */
  costPerMillionRequestsUsd: number;
}

export interface CostComparison {
  clouds: CloudCost[];
  cheapest: Cloud;
  /** monthly spread between cheapest and most expensive. */
  spreadUsd: number;
}

// ---------- SLO ----------

export interface SloAssessment {
  target: SloTarget;
  /** measured p99 at baseline traffic. */
  p99AtBaselineMs: number;
  meetsLatency: boolean;
  /** modelled availability from redundancy of the components on the request path. */
  estimatedAvailabilityPct: number;
  meetsAvailability: boolean;
  /** error budget in minutes/month implied by the availability target. */
  errorBudgetMinutesPerMonth: number;
  headroomToSloBreakPct: number; // (sloBreakRps - baselineRps)/baselineRps
  notes: string[];
}

// ---------- Resilience ----------

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface ResilienceFinding {
  componentId: string;
  name: string;
  severity: Severity;
  title: string;
  detail: string;
  /** what happens to the system if this component degrades/fails. */
  blastRadius: string;
  recommendation: string;
}

export interface ResilienceReport {
  findings: ResilienceFinding[];
  singlePointsOfFailure: string[]; // component ids
  /** 0..100 — higher is more resilient. */
  score: number;
}

// ---------- Scaling ----------

export interface TierScalingPlan {
  componentId: string;
  name: string;
  kind: ComponentKind;
  strategy: "horizontal" | "vertical" | "managed" | "fixed";
  minInstances: number;
  baselineInstances: number;
  peakInstances: number;
  targetUtilizationPct: number;
  rationale: string;
}

export interface ScalingPlan {
  tiers: TierScalingPlan[];
  notes: string[];
}

// ---------- Optimization ----------

export interface OptimizationOpportunity {
  title: string;
  category: "rightsizing" | "commitment" | "architecture" | "caching" | "traffic";
  estimatedMonthlySavingsUsd: number;
  effort: "low" | "medium" | "high";
  detail: string;
}

// ---------- Readiness ----------

export interface ChecklistItem {
  id: string;
  category: "reliability" | "scalability" | "security" | "observability" | "cost" | "operations";
  label: string;
  status: "pass" | "warn" | "fail" | "manual";
  detail: string;
}

export interface ReadinessReport {
  /** 0..100 overall production-readiness score. */
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  byCategory: Record<ChecklistItem["category"], number>;
  checklist: ChecklistItem[];
}

// ---------- IaC ----------

export interface IacArtifact {
  filename: string;
  language: "hcl" | "yaml" | "dockerfile";
  content: string;
  target: Cloud | "kubernetes" | "compose";
}

// ---------- Aggregate ----------

export interface AnalysisResult {
  id: string;
  createdAt: string;
  model: SystemModel;
  traffic: TrafficProfile;
  slo: SloTarget;
  /** headline simulation at baseline (and at peak for spike scenarios). */
  baseline: SimResult;
  peak: SimResult;
  capacity: CapacityCurve;
  waterfall: WaterfallHop[];
  cost: CostComparison;
  sloAssessment: SloAssessment;
  resilience: ResilienceReport;
  scaling: ScalingPlan;
  optimizations: OptimizationOpportunity[];
  readiness: ReadinessReport;
  iac: IacArtifact[];
  /** SRE-style narrative (markdown) from the advisor. */
  narrative: string;
  /** true when the model was inferred by the LLM (vs heuristic fallback). */
  llmProfiled: boolean;
  /** true when the narrative came from the LLM (vs heuristic). */
  llmNarrated: boolean;
  warnings: string[];
}
