import { z } from "zod";

/**
 * The component taxonomy. Each kind has different scaling, cost and resilience
 * characteristics that the engine reasons about.
 */
export const ComponentKindSchema = z.enum([
  "load_balancer",
  "web", // static frontend / CDN origin / SSR server
  "api", // stateless application/API tier
  "worker", // async/background job processor
  "database", // primary datastore (SQL/NoSQL)
  "cache", // in-memory cache (redis/memcached)
  "queue", // message broker
  "search", // search/index engine
  "storage", // object/blob storage
  "external", // third-party API dependency
]);
export type ComponentKind = z.infer<typeof ComponentKindSchema>;

/**
 * A single tier in the architecture. Modelled as an M/M/c queueing station:
 * `instances * workersPerInstance` parallel servers, each taking `serviceTimeMs`
 * of wall-clock time to process one request that touches this tier.
 */
export const ComponentSchema = z.object({
  id: z.string().describe("short unique slug, e.g. 'api', 'db', 'cache'"),
  name: z.string().describe("human readable name"),
  kind: ComponentKindSchema,
  serviceTimeMs: z
    .number()
    .min(0)
    .describe(
      "mean wall-clock processing time at THIS tier per request, EXCLUDING time spent in downstream calls",
    ),
  cpuMsPerReq: z
    .number()
    .min(0)
    .describe("CPU-milliseconds of actual compute consumed per request (drives sizing & cost)"),
  memMbBaseline: z
    .number()
    .min(0)
    .describe("baseline RAM footprint of one instance in MB (idle working set)"),
  memMbPerReq: z
    .number()
    .min(0)
    .optional()
    .describe("extra MB held per concurrent in-flight request"),
  workersPerInstance: z
    .number()
    .min(1)
    .describe(
      "concurrent requests a single instance can serve at once: thread-pool size for blocking servers; a high number (e.g. 200) for event-loop / IO-bound servers; connection limit for databases",
    ),
  instances: z.number().min(1).describe("baseline number of instances/nodes for this tier"),
  maxInstances: z
    .number()
    .min(1)
    .optional()
    .describe("autoscaling ceiling (omit if fixed/stateful)"),
  dependsOn: z
    .array(z.string())
    .describe("ids of components this tier calls synchronously while serving a request"),
  callsPerRequest: z
    .record(z.string(), z.number())
    .optional()
    .describe(
      "for each downstream id, the average number of calls made per inbound request (default 1 each)",
    ),
  replicated: z
    .boolean()
    .describe("true when this tier has 2+ redundant instances/nodes (i.e. not a single point of failure)"),
  stateful: z
    .boolean()
    .describe("true for tiers that hold durable or in-memory state (databases, caches, queues)"),
});
export type Component = z.infer<typeof ComponentSchema>;

/**
 * The full architecture model. This is the structured artifact the LLM profiler
 * produces from a description or repo, and the input to the deterministic engine.
 */
export const SystemModelSchema = z.object({
  name: z.string().describe("name of the project/system"),
  summary: z.string().describe("one-paragraph plain-English description of the architecture"),
  stack: z.array(z.string()).describe("detected or assumed technologies (languages, frameworks, datastores)"),
  entrypoint: z.string().describe("id of the component where external traffic first lands"),
  components: z.array(ComponentSchema).min(1),
  assumptions: z
    .array(z.string())
    .describe("explicit assumptions made while inferring the model, so the user can correct them"),
});
export type SystemModel = z.infer<typeof SystemModelSchema>;

/** Shape of the incoming traffic used to drive the simulation. */
export const TrafficShapeSchema = z.enum(["steady", "diurnal", "spike", "growth"]);
export type TrafficShape = z.infer<typeof TrafficShapeSchema>;

export const TrafficProfileSchema = z.object({
  shape: TrafficShapeSchema.default("steady"),
  baselineRps: z.number().min(0).describe("typical sustained requests per second"),
  peakRps: z.number().min(0).describe("peak requests per second (diurnal/spike scenarios)"),
  monthlyGrowthPct: z.number().optional().describe("month-over-month traffic growth, for the growth scenario"),
  avgRequestKb: z.number().min(0).default(2),
  avgResponseKb: z.number().min(0).default(20),
});
export type TrafficProfile = z.infer<typeof TrafficProfileSchema>;

/** Service-level objectives the architecture is checked against. */
export const SloTargetSchema = z.object({
  p99LatencyMs: z.number().min(1).default(500),
  availabilityPct: z.number().min(0).max(100).default(99.9),
});
export type SloTarget = z.infer<typeof SloTargetSchema>;

/** Everything needed to run an analysis. */
export const AnalysisRequestSchema = z.object({
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("description"), text: z.string().min(1) }),
    z.object({ type: z.literal("repo"), url: z.string().url() }),
    z.object({ type: z.literal("model"), model: SystemModelSchema }),
  ]),
  traffic: TrafficProfileSchema,
  slo: SloTargetSchema,
});
export type AnalysisRequest = z.infer<typeof AnalysisRequestSchema>;
