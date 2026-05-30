# ScaleScope — AI DevOps Capacity & Cost Architect

Describe a system in plain English (or point at a GitHub repo) and ScaleScope acts like a
senior SRE: it **simulates load**, finds the **bottleneck** and the **breakpoint**, prices the
topology across **AWS / GCP / Vercel**, checks it against your **SLOs**, flags **resilience
risks**, plans **autoscaling**, surfaces **cost savings**, generates **Infrastructure-as-Code**,
and scores **production readiness** — with an SRE-style narrative on top.

The headline numbers come from a **real discrete-event queueing simulation**, not an LLM guess.
The LLM only sits at the edges (turning your description into a structured model, and narrating
the results). Everything in the middle is deterministic, testable math — and it runs **fully
offline** with no API key.

```
 INPUT                PROFILER            SIMULATOR             ADVISOR
 form / repo   ──►   (LLM or heuristic)  (discrete-event   ──► (LLM or heuristic)
                      → system model      queueing sim)         → SRE narrative
                                              │
                                              ▼
                                         COST ENGINE  +  SLO / RESILIENCE / SCALING
                                       AWS·GCP·Vercel     OPTIMIZE / READINESS / IaC
```

## What you get

| Feature | Answers |
|---|---|
| **Load simulation** | p50/p90/p95/p99 latency & throughput as traffic ramps to saturation |
| **Bottleneck + breakpoint** | which tier saturates first, and at what request rate |
| **Latency waterfall** | how the end-to-end request time splits across tiers |
| **Multi-cloud cost** | monthly bill on AWS vs GCP vs Vercel, sized for your peak |
| **SLO check** | latency + availability vs target, error budget, traffic headroom |
| **Resilience** | single points of failure, blast radius, redundancy gaps |
| **Scaling plan** | strategy + autoscaling floor/ceiling per tier |
| **Cost optimization** | rightsizing, commitments, caching, autoscaling savings |
| **Readiness scorecard** | 0–100 across reliability/scalability/security/observability/cost/ops |
| **IaC** | starting-point Terraform (AWS), Kubernetes, and docker-compose |

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
```

No API key is required — the profiler and advisor fall back to deterministic heuristics, and the
simulation/cost engines are entirely local. Pick an example, set traffic & SLO, hit **Analyze**.

### Optional: enable the LLM

To get LLM-powered profiling (better at reading messy descriptions/repos) and a richer narrative,
provide a [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) key. Models are addressed as
plain `provider/model` strings through the gateway.

```bash
# .env.local
AI_GATEWAY_API_KEY=...           # enables LLM profiling + narrative
SCALESCOPE_MODEL=anthropic/claude-sonnet-4.5   # optional override (default shown)
GITHUB_TOKEN=...                 # optional, for private repos / higher rate limits
```

Set `SCALESCOPE_NO_AI=1` to force the offline heuristic path even when a key is present.

## How the simulation works

Each component is modelled as an **M/M/c queueing station** with
`instances × workersPerInstance` parallel servers and a per-request service time. A request is an
entity that samples a route through the architecture (fan-out expanded stochastically) and queues
at every tier it visits — log-normal service times, Poisson arrivals.

- **Latency percentiles & throughput** come from the discrete-event simulation
  (`lib/sim/des.ts`) — tens of thousands of simulated requests per run.
- **Per-tier utilization, queueing and the exact saturation point** come from closed-form
  Erlang-B/C (`lib/sim/queueing.ts`), which can show >100% overload that a bounded simulation
  can't.
- **Async tiers** (background workers draining a queue) are kept off the synchronous latency
  path: their backlog shows up as a throughput/scaling concern, not as request latency.

The capacity curve sweeps RPS from light load through saturation, running a simulation at each
step to plot the hockey-stick and locate the **knee**, the **SLO-break** point, and **saturation**.

### Trust & limitations

- Latency/throughput are only as good as the **inferred per-tier parameters** (service time,
  concurrency, fan-out). They're surfaced as editable assumptions — refine them for accuracy.
- Cost figures are **approximate on-demand US list prices** (late 2025) for relative comparison
  and budgeting — not a quote. Reserved/committed-use savings are shown separately.
- Availability is modelled from per-tier redundancy on the request path (series reliability),
  assuming a single region.

## Project layout

```
app/
  api/analyze/route.ts     POST → full analysis pipeline
  api/github/route.ts      GET  → repo manifest preview
  page.tsx                 input + dashboard (client)
components/                InputPanel, Dashboard, charts, ui primitives
lib/
  model/                   Zod schemas + result types
  sim/                     heap, RNG, Erlang math, topology, DES, capacity sweep
  pricing/                 instance catalogs + multi-cloud cost engine
  analysis/                slo, resilience, scaling, optimize, readiness, orchestrator
  ai/                      provider, profiler (LLM + heuristic), advisor
  github/                  repo snapshot fetcher
  iac/                     Terraform / Kubernetes / docker-compose generators
```

## Scripts

```bash
npm run dev          # dev server
npm run build        # production build (typecheck + lint)
npm start            # run the production build
npm test             # vitest — engine & cost unit tests
npm run test:watch   # vitest watch mode
```

## Tests

The deterministic core is unit-tested (`npm test`): the Erlang queueing identities, the
min-heap event queue, topology/fan-out visit accounting, the simulator's stability/overload
behavior, the capacity-curve thresholds, and the multi-cloud cost engine.

---

Built with Next.js (App Router), the Vercel AI SDK + AI Gateway, Tailwind CSS, and Recharts.
