import { generateObject } from "ai";
import type { Component, ComponentKind, SystemModel } from "../model/types";
import { SystemModelSchema } from "../model/schema";
import { normalizeModel } from "../sim/topology";
import { fetchRepoSnapshot } from "../github/fetch";
import { aiEnabled, modelId } from "./provider";

export interface ProfileSource {
  type: "description" | "repo" | "model";
  text?: string;
  url?: string;
  model?: SystemModel;
}

export interface ProfileResult {
  model: SystemModel;
  llmProfiled: boolean;
  warnings: string[];
}

// ---------------- per-kind sensible defaults ----------------

function base(kind: ComponentKind, id: string, name: string, extra: Partial<Component> = {}): Component {
  const defaults: Record<ComponentKind, Omit<Component, "id" | "name" | "kind" | "dependsOn">> = {
    load_balancer: { serviceTimeMs: 1, cpuMsPerReq: 0.2, memMbBaseline: 256, workersPerInstance: 4000, instances: 2, replicated: true, stateful: false },
    web: { serviceTimeMs: 25, cpuMsPerReq: 18, memMbBaseline: 512, workersPerInstance: 8, instances: 2, replicated: true, stateful: false },
    api: { serviceTimeMs: 20, cpuMsPerReq: 15, memMbBaseline: 512, workersPerInstance: 8, instances: 2, replicated: true, stateful: false },
    worker: { serviceTimeMs: 200, cpuMsPerReq: 150, memMbBaseline: 512, workersPerInstance: 4, instances: 2, replicated: true, stateful: false },
    database: { serviceTimeMs: 8, cpuMsPerReq: 6, memMbBaseline: 2048, workersPerInstance: 30, instances: 1, replicated: false, stateful: true },
    cache: { serviceTimeMs: 1, cpuMsPerReq: 0.5, memMbBaseline: 1024, workersPerInstance: 100, instances: 1, replicated: false, stateful: true },
    queue: { serviceTimeMs: 2, cpuMsPerReq: 1, memMbBaseline: 512, workersPerInstance: 200, instances: 2, replicated: true, stateful: true },
    search: { serviceTimeMs: 15, cpuMsPerReq: 10, memMbBaseline: 2048, workersPerInstance: 20, instances: 1, replicated: false, stateful: true },
    storage: { serviceTimeMs: 30, cpuMsPerReq: 1, memMbBaseline: 0, workersPerInstance: 500, instances: 1, replicated: true, stateful: true },
    external: { serviceTimeMs: 120, cpuMsPerReq: 1, memMbBaseline: 0, workersPerInstance: 1000, instances: 1, replicated: true, stateful: false },
  };
  return { id, name, kind, dependsOn: [], ...defaults[kind], ...extra };
}

interface Detected {
  stack: string[];
  hasWeb: boolean;
  hasApi: boolean;
  hasLb: boolean;
  hasWorker: boolean;
  databases: string[];
  cache?: string;
  search?: string;
  queue?: string;
  storage?: string;
  externals: string[];
}

const has = (t: string, ...needles: string[]) => needles.some((n) => t.includes(n));

function detectStack(text: string): Detected {
  const t = text.toLowerCase();
  const stack: string[] = [];
  const add = (s: string) => {
    if (!stack.includes(s)) stack.push(s);
  };

  const hasNext = has(t, "next.js", "nextjs", "next ", "remix", "nuxt", "sveltekit");
  const hasSpa = has(t, "react", "vue", "angular", "svelte", "spa", "frontend", "single page");
  const apiFw = has(
    t,
    "express",
    "fastify",
    "koa",
    "nestjs",
    "nest.js",
    "flask",
    "django",
    "fastapi",
    "rails",
    "spring",
    "gin",
    "echo",
    "laravel",
    "phoenix",
    "api",
    "backend",
    "server",
    "service",
    "microservice",
  );
  if (hasNext) add("Next.js");
  if (has(t, "express")) add("Express");
  if (has(t, "fastify")) add("Fastify");
  if (has(t, "nestjs", "nest.js")) add("NestJS");
  if (has(t, "fastapi")) add("FastAPI");
  if (has(t, "django")) add("Django");
  if (has(t, "flask")) add("Flask");
  if (has(t, "rails")) add("Rails");
  if (has(t, "spring")) add("Spring Boot");
  if (has(t, "go ", "golang", "go.mod", "gin", "echo")) add("Go");
  if (has(t, "node", "express", "fastify", "nestjs", "next")) add("Node.js");
  if (has(t, "python", "django", "flask", "fastapi", "requirements.txt", "pyproject")) add("Python");

  const databases: string[] = [];
  if (has(t, "postgres", "postgresql", "aurora", "cockroach", "supabase", "neon")) {
    databases.push("PostgreSQL");
    add("PostgreSQL");
  }
  if (has(t, "mysql", "mariadb", "planetscale")) {
    databases.push("MySQL");
    add("MySQL");
  }
  if (has(t, "mongodb", "mongo", "documentdb")) {
    databases.push("MongoDB");
    add("MongoDB");
  }
  if (has(t, "dynamodb")) {
    databases.push("DynamoDB");
    add("DynamoDB");
  }
  if (has(t, "cassandra", "scylla")) {
    databases.push("Cassandra");
    add("Cassandra");
  }

  let cache: string | undefined;
  if (has(t, "redis", "elasticache", "memcached", "upstash", "valkey")) {
    cache = has(t, "memcached") ? "Memcached" : "Redis";
    add(cache);
  }
  let search: string | undefined;
  if (has(t, "elasticsearch", "opensearch", "algolia", "meilisearch", "typesense")) {
    search = "Search";
    add("Search engine");
  }
  let queue: string | undefined;
  if (has(t, "kafka", "rabbitmq", "sqs", "pubsub", "pub/sub", "nats", "celery", "sidekiq", "bullmq", "bull ", "redis queue")) {
    queue = "Queue";
    add("Message queue");
  }
  let storage: string | undefined;
  if (has(t, "s3", "gcs", "cloud storage", "object storage", "blob", "minio", "uploads", "media")) {
    storage = "Object storage";
    add("Object storage");
  }
  const externals: string[] = [];
  for (const [needle, label] of [
    ["stripe", "Stripe"],
    ["twilio", "Twilio"],
    ["openai", "OpenAI"],
    ["anthropic", "Anthropic"],
    ["sendgrid", "SendGrid"],
    ["paypal", "PayPal"],
    ["auth0", "Auth0"],
  ] as const) {
    if (t.includes(needle)) {
      externals.push(label);
      add(label);
    }
  }

  const hasWorker = has(t, "worker", "background job", "celery", "sidekiq", "bullmq", "cron", "async job", "consumer");
  const hasLb = has(t, "load balancer", "nginx", "haproxy", "alb", "ingress", "envoy");

  return {
    stack,
    hasWeb: hasNext || hasSpa,
    hasApi: apiFw || !(hasNext || hasSpa),
    hasLb,
    hasWorker: hasWorker || Boolean(queue),
    databases,
    cache,
    search,
    queue,
    storage,
    externals,
  };
}

/** Build a credible SystemModel from a text description (no LLM). */
export function heuristicProfile(text: string, name = "Your Service"): SystemModel {
  const d = detectStack(text);
  const components: Component[] = [];
  const assumptions: string[] = [];

  // data tiers
  const dataDeps: string[] = [];
  const dataCalls: Record<string, number> = {};
  if (d.cache) {
    components.push(base("cache", "cache", d.cache));
    dataDeps.push("cache");
    dataCalls.cache = 2;
  }
  if (d.databases.length) {
    components.push(base("database", "db", d.databases[0]));
    dataDeps.push("db");
    dataCalls.db = d.cache ? 1 : 2; // a cache absorbs read load
  }
  if (d.search) {
    components.push(base("search", "search", "Search"));
    dataDeps.push("search");
    dataCalls.search = 0.3;
  }
  if (d.queue) {
    components.push(base("queue", "queue", "Queue"));
    dataDeps.push("queue");
    dataCalls.queue = 0.4;
  }
  if (d.storage) {
    components.push(base("storage", "storage", "Object storage"));
    dataDeps.push("storage");
    dataCalls.storage = 0.3;
  }
  for (const ext of d.externals) {
    const id = `ext-${ext.toLowerCase()}`;
    components.push(base("external", id, ext));
    dataDeps.push(id);
    dataCalls[id] = 0.3;
  }
  if (d.databases.length === 0 && !d.cache) {
    components.push(base("database", "db", "PostgreSQL"));
    dataDeps.push("db");
    dataCalls.db = 1.5;
    assumptions.push("No datastore was specified — assumed a PostgreSQL primary.");
  }

  // app tier
  const api = base("api", "api", "API service", { dependsOn: dataDeps, callsPerRequest: dataCalls });
  components.push(api);

  // web / entry
  let entrypoint = "api";
  if (d.hasWeb) {
    const web = base("web", "web", "Web / SSR", { dependsOn: ["api"], callsPerRequest: { api: 1 } });
    components.push(web);
    entrypoint = "web";
  }
  if (d.hasLb) {
    const lb = base("load_balancer", "lb", "Load balancer", {
      dependsOn: [entrypoint],
      callsPerRequest: { [entrypoint]: 1 },
    });
    components.push(lb);
    entrypoint = "lb";
  }

  // async worker (off the synchronous path)
  if (d.hasWorker) {
    const wdeps = dataDeps.filter((id) => id === "db" || id === "cache" || id === "storage");
    components.push(base("worker", "worker", "Background worker", { dependsOn: wdeps }));
  }

  assumptions.push(
    "Per-tier service times, concurrency and CPU/request are inferred defaults — adjust them for accuracy.",
    "Stateful tiers (DB/cache/search) start as a single non-redundant node so risks are surfaced.",
  );
  if (d.cache) assumptions.push("Assumed the cache absorbs the bulk of read traffic (2 cache calls vs 1 DB call per request).");

  const model: SystemModel = {
    name,
    summary: `Inferred ${d.hasWeb ? "web + API" : "API"} architecture${
      d.databases.length ? ` on ${d.databases[0]}` : ""
    }${d.cache ? ` with ${d.cache} caching` : ""}${d.queue ? ", async workers" : ""}.`,
    stack: d.stack.length ? d.stack : ["Unknown stack"],
    entrypoint,
    components,
    assumptions,
  };
  return normalizeModel(model).model;
}

const SYSTEM_PROMPT = `You are a principal infrastructure architect. Convert a project description or repository into a structured capacity model for simulation.

Rules:
- Produce 3–7 components covering the real request path: entry (load_balancer/web/api), app tier, and data tiers (database/cache/queue/search/storage) plus any external APIs.
- serviceTimeMs is the tier's OWN processing time per request, EXCLUDING downstream calls (which are separate components it dependsOn).
- workersPerInstance is concurrency per instance: ~CPU-core count for CPU-bound tiers; a DB connection-pool size for databases; high for caches.
- Use realistic numbers for the described stack. Set callsPerRequest for fan-out (e.g. several cache reads, fewer DB writes). Mark stateful tiers stateful, and replicated=false for single-node datastores so risks surface.
- entrypoint must be the id where external traffic lands. List the assumptions you made.`;

/** Profile a source into a SystemModel, preferring the LLM, falling back to heuristics. */
export async function profile(source: ProfileSource): Promise<ProfileResult> {
  const warnings: string[] = [];

  if (source.type === "model" && source.model) {
    const n = normalizeModel(source.model);
    return { model: n.model, llmProfiled: false, warnings: n.warnings };
  }

  let text = source.text ?? "";
  let name = "Your Service";
  if (source.type === "repo" && source.url) {
    const snap = await fetchRepoSnapshot(source.url);
    text = snap.digest;
    name = snap.name || name;
  }
  if (!text.trim()) {
    throw new Error("No description or repository content to analyze.");
  }

  if (aiEnabled()) {
    try {
      const { object } = await generateObject({
        model: modelId(),
        schema: SystemModelSchema,
        system: SYSTEM_PROMPT,
        prompt: `Project ${source.type === "repo" ? "repository" : "description"}:\n\n${text}`,
      });
      const n = normalizeModel(object);
      return { model: n.model, llmProfiled: true, warnings: [...warnings, ...n.warnings] };
    } catch (err) {
      warnings.push(
        `LLM profiling failed (${(err as Error).message}); used heuristic model instead.`,
      );
    }
  }

  const model = heuristicProfile(text, name);
  return { model, llmProfiled: false, warnings };
}
