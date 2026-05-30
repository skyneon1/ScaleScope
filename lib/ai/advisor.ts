import { generateText } from "ai";
import type { AnalysisResult } from "../model/types";
import { aiEnabled, modelId } from "./provider";

type Input = Omit<AnalysisResult, "narrative" | "llmNarrated">;

function nameOf(r: Input, id: string): string {
  return r.model.components.find((c) => c.id === id)?.name ?? id;
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/** Deterministic, genuinely useful narrative used when the LLM is unavailable. */
export function heuristicNarrative(r: Input): string {
  const bottleneck = nameOf(r, r.capacity.bottleneckId);
  const cheapest = r.cost.clouds.find((c) => c.cloud === r.cost.cheapest)!;
  const others = r.cost.clouds.filter((c) => c.cloud !== r.cost.cheapest);
  const topRisks = r.resilience.findings
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .slice(0, 3);
  const topOpts = r.optimizations.slice(0, 3);

  const lines: string[] = [];
  lines.push(`## Summary`);
  lines.push(
    `At a baseline of **${r.traffic.baselineRps} rps**, end-to-end latency is **~${Math.round(
      r.baseline.latency.p99,
    )} ms p99** (${Math.round(r.baseline.latency.p50)} ms median). The first tier to saturate is **${bottleneck}**, and the system stays within its **${r.slo.p99LatencyMs} ms** SLO up to **~${Math.round(
      r.capacity.sloBreakRps,
    )} rps** before p99 breaks. Production readiness grades **${r.readiness.grade} (${r.readiness.score}/100)**.`,
  );

  lines.push(`## Where it breaks`);
  lines.push(
    `- **Bottleneck:** ${bottleneck} — queueing starts to bite around **${Math.round(
      r.capacity.kneeRps,
    )} rps** (the knee) and the tier saturates at **~${Math.round(r.capacity.saturationRps)} rps**.`,
  );
  lines.push(
    `- **Headroom:** ${
      r.sloAssessment.headroomToSloBreakPct >= 0
        ? `~${Math.round(r.sloAssessment.headroomToSloBreakPct)}% above today's traffic before the SLO is at risk`
        : `**none** — baseline already exceeds the SLO-safe ceiling`
    }.`,
  );
  if (r.baseline.dropRate > 0.001) {
    lines.push(`- **Load shedding:** ~${(r.baseline.dropRate * 100).toFixed(1)}% of requests fail under baseline load.`);
  }

  if (topRisks.length) {
    lines.push(`## Top resilience risks`);
    for (const f of topRisks) {
      lines.push(`- **${f.title}** (${f.severity}). ${f.blastRadius} _${f.recommendation}_`);
    }
  }

  lines.push(`## Cost`);
  lines.push(
    `- Cheapest is **${cheapest.cloud.toUpperCase()}** at **${money(
      cheapest.totalMonthlyUsd,
    )}/mo** (≈ $${cheapest.costPerMillionRequestsUsd}/M requests), vs ${others
      .map((c) => `${c.cloud.toUpperCase()} ${money(c.totalMonthlyUsd)}`)
      .join(" and ")} — a spread of **${money(r.cost.spreadUsd)}/mo**.`,
  );

  if (topOpts.length) {
    lines.push(`## Recommended next steps`);
    for (const o of topOpts) {
      lines.push(
        `- **${o.title}** (${o.effort} effort) — save ~${money(o.estimatedMonthlySavingsUsd)}/mo. ${o.detail}`,
      );
    }
  }
  for (const n of r.scaling.notes.slice(0, 2)) lines.push(`- ${n}`);

  return lines.join("\n");
}

function compactSummary(r: Input): string {
  return JSON.stringify(
    {
      name: r.model.name,
      stack: r.model.stack,
      components: r.model.components.map((c) => ({
        id: c.id,
        kind: c.kind,
        instances: c.instances,
        replicated: c.replicated,
        stateful: c.stateful,
      })),
      traffic: r.traffic,
      slo: r.slo,
      baseline: { p50: r.baseline.latency.p50, p99: r.baseline.latency.p99, dropRate: r.baseline.dropRate },
      capacity: {
        saturationRps: r.capacity.saturationRps,
        sloBreakRps: r.capacity.sloBreakRps,
        kneeRps: r.capacity.kneeRps,
        bottleneck: r.capacity.bottleneckId,
      },
      cost: r.cost.clouds.map((c) => ({ cloud: c.cloud, monthly: c.totalMonthlyUsd, perMillion: c.costPerMillionRequestsUsd })),
      slo_assessment: {
        meetsLatency: r.sloAssessment.meetsLatency,
        availability: r.sloAssessment.estimatedAvailabilityPct,
        headroomPct: r.sloAssessment.headroomToSloBreakPct,
      },
      resilience: { score: r.resilience.score, findings: r.resilience.findings.slice(0, 5) },
      optimizations: r.optimizations.slice(0, 5),
      readiness: { grade: r.readiness.grade, score: r.readiness.score, byCategory: r.readiness.byCategory },
    },
    null,
    0,
  );
}

const SYSTEM = `You are a staff SRE writing a concise production-readiness brief for an engineering team.
Use the provided analysis JSON only — do not invent numbers. Write GitHub-flavoured markdown with short sections:
Summary, Where it breaks, Top risks, Cost, Recommended next steps. Be direct and specific, cite the figures, and lead with the single most important action.`;

/** Produce the narrative, preferring the LLM and falling back to the heuristic. */
export async function narrate(r: Input): Promise<{ narrative: string; llmNarrated: boolean }> {
  if (aiEnabled()) {
    try {
      const { text } = await generateText({
        model: modelId(),
        system: SYSTEM,
        prompt: `Analysis JSON:\n${compactSummary(r)}`,
      });
      if (text.trim()) return { narrative: text.trim(), llmNarrated: true };
    } catch {
      // fall through to heuristic
    }
  }
  return { narrative: heuristicNarrative(r), llmNarrated: false };
}
