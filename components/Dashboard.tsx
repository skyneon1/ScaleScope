"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  DollarSign,
  FileCode2,
  Gauge,
  HelpCircle,
  Layers,
  Loader2,
  Network,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";
import type {
  AnalysisResult,
  ChecklistItem,
  CloudCost,
  StationLoad,
} from "@/lib/model/types";
import {
  CLOUD_META,
  KIND_META,
  SEVERITY_META,
  fmtMoney,
  fmtMoneyExact,
  fmtMs,
  fmtPct,
  fmtRps,
  gradeColor,
  scoreColor,
  utilColor,
} from "@/lib/format";
import { Badge, Bar, Card, CardHeader, Dot, Stat } from "./ui";
import { LatencyCurveChart } from "./charts";
import { Tip } from "./Tooltip";

/* ── Verdict: one plain-English sentence about system health ── */
function getVerdict(r: AnalysisResult): { ok: boolean; warn: boolean; text: string } {
  const bottleneck = r.model.components.find((c) => c.id === r.capacity.bottleneckId);
  const bn = bottleneck?.name ?? "a tier";
  const headroom = r.sloAssessment.headroomToSloBreakPct;
  if (!r.baseline.stable) {
    return { ok: false, warn: false, text: `Your system is already overloaded at ${fmtRps(r.traffic.baselineRps)} rps — ${bn} needs more capacity right now.` };
  }
  if (!r.sloAssessment.meetsLatency) {
    return { ok: false, warn: false, text: `Response times are too slow (${fmtMs(r.baseline.latency.p99)} p99 vs. your ${fmtMs(r.slo.p99LatencyMs)} target). ${bn} is the limiting factor.` };
  }
  if (headroom < 30) {
    return { ok: false, warn: true, text: `You have ~${Math.round(headroom)}% headroom left. ${bn} will be the first thing to break — plan capacity now before you hit ${fmtRps(r.capacity.sloBreakRps)} rps.` };
  }
  if (headroom < 80) {
    return { ok: false, warn: true, text: `System is healthy at ${fmtRps(r.traffic.baselineRps)} rps, but ${bn} starts struggling around ${fmtRps(r.capacity.kneeRps)} rps — keep an eye on it.` };
  }
  return { ok: true, warn: false, text: `Looking good. Handles ${fmtRps(r.traffic.baselineRps)} rps comfortably and can scale to ${fmtRps(r.capacity.saturationRps)} rps before ${bn} saturates.` };
}

/* ── Tab IDs ── */
type Tab = "performance" | "cost" | "reliability" | "readiness" | "infra";

export function Dashboard({ r, narrativeLoading = false }: { r: AnalysisResult; narrativeLoading?: boolean }) {
  const [tab, setTab] = useState<Tab>("performance");
  const bottleneck = r.model.components.find((c) => c.id === r.capacity.bottleneckId);
  const cheapest = r.cost.clouds.find((c) => c.cloud === r.cost.cheapest)!;
  const verdict = getVerdict(r);

  return (
    <div className="rise flex flex-col gap-8">
      {/* ── Hero strip ── */}
      <Card glow className="overflow-hidden border-border/80 shadow-2xl">
        {/* verdict bar */}
        <div
          className={`flex items-center gap-4 border-b border-border/60 px-6 py-4 ${
            verdict.ok
              ? "bg-good/[0.04]"
              : verdict.warn
                ? "bg-warn/[0.04]"
                : "bg-bad/[0.04]"
          }`}
        >
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm ${
              verdict.ok ? "bg-good text-white" : verdict.warn ? "bg-warn text-white" : "bg-bad text-white"
            }`}
          >
            {verdict.ok ? <Check size={18} strokeWidth={3} /> : verdict.warn ? <AlertTriangle size={18} /> : <XCircle size={18} />}
          </span>
          <p className="text-sm font-bold text-fg tracking-tight">{verdict.text}</p>
        </div>

        {/* system identity */}
        <div className="flex flex-col gap-6 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3.5 flex-wrap">
              <h2 className="metric text-3xl font-black text-fg">{r.model.name}</h2>
              <Badge color={r.llmProfiled ? "var(--color-brand)" : "var(--color-faint)"} subtle={false} className="px-3 py-1">
                {r.llmProfiled ? <><Sparkles size={12} /> Pro Model</> : "standard model"}
              </Badge>
            </div>
            <p className="mt-3 max-w-2xl text-md leading-relaxed text-muted font-medium">{r.model.summary}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {r.model.stack.slice(0, 10).map((s) => (
                <span key={s} className="rounded-lg border border-border bg-bg-soft px-3 py-1 text-[11px] font-bold text-faint tracking-tight">
                  {s}
                </span>
              ))}
            </div>
          </div>
          <ScoreRing score={r.readiness.score} grade={r.readiness.grade} />
        </div>

        {/* 4 headline stats */}
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
          <HeroStat
            icon={<Clock size={16} />}
            label="Simulated p99"
            value={fmtMs(r.baseline.latency.p99)}
            sub={`${fmtMs(r.baseline.latency.p50)} avg · ${fmtRps(r.traffic.baselineRps)} current`}
            color={r.sloAssessment.meetsLatency ? "var(--color-good)" : "var(--color-bad)"}
          />
          <HeroStat
            icon={<Zap size={16} />}
            label="Peak Capacity"
            value={`${fmtRps(r.capacity.saturationRps)} rps`}
            sub={`Limit: ${bottleneck?.name ?? "—"}`}
            color="var(--color-brand)"
          />
          <HeroStat
            icon={<DollarSign size={16} />}
            label={`Optimum · ${CLOUD_META[cheapest.cloud].label}`}
            value={`${fmtMoney(cheapest.totalMonthlyUsd)}`}
            sub={`$${cheapest.costPerMillionRequestsUsd}/M requests`}
            color="var(--color-fg)"
          />
          <HeroStat
            icon={<ShieldAlert size={16} />}
            label="Reliability"
            value={fmtPct(r.sloAssessment.estimatedAvailabilityPct, 2)}
            sub={`${r.resilience.singlePointsOfFailure.length} SPoF identified`}
            color={r.sloAssessment.meetsAvailability ? "var(--color-good)" : "var(--color-hot)"}
          />
        </div>
      </Card>

      {/* ── Tab nav ── */}
      <div className="flex items-center gap-2 border-b border-border/80 sticky top-[80px] z-30 bg-bg/80 backdrop-blur-md px-1">
        {([
          ["performance", "Latency & Load", <TrendingUp key="p" size={16} />],
          ["cost", "Cloud Economics", <DollarSign key="c" size={16} />],
          ["reliability", "Infrastructure Faults", <ShieldAlert key="r" size={16} />],
          ["readiness", "Production Checklist", <Gauge key="rr" size={16} />],
          ["infra", "System definition", <FileCode2 key="i" size={16} />],
        ] as [Tab, string, React.ReactNode][]).map(([t, label, icon]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative flex items-center gap-3 px-6 py-5 text-[11px] font-bold uppercase tracking-[0.15em] transition-all group ${
              tab === t
                ? "text-brand"
                : "text-faint hover:text-fg"
            }`}
          >
            <span className="relative z-10 flex items-center gap-3">
              {icon}
              {label}
            </span>
            {tab === t && (
              <motion.div
                layoutId="activeTab"
                className="absolute bottom-[-1px] left-0 right-0 h-[3px] bg-brand rounded-t-full shadow-[0_-2px_8px_rgba(196,140,52,0.3)]"
                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
              />
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <motion.div
        key={tab}
        initial={{ opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] as const }}
        className="min-h-[400px]"
      >
        {tab === "performance" && <PerformanceTab r={r} bottleneckName={bottleneck?.name ?? r.capacity.bottleneckId} narrativeLoading={narrativeLoading} />}
        {tab === "cost" && <CostTab r={r} />}
        {tab === "reliability" && <ReliabilityTab r={r} />}
        {tab === "readiness" && <ReadinessTab r={r} />}
        {tab === "infra" && <InfraTab r={r} />}
      </motion.div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Hero building blocks
   ────────────────────────────────────────────── */

function HeroStat({
  icon, label, value, sub, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="bg-panel px-6 py-6 transition-colors relative group">
      <div className="flex items-center gap-3 font-bold text-[10px] uppercase tracking-[0.2em] text-faint">
        <span className="transition-transform group-hover:scale-110 group-hover:rotate-3" style={{ color }}>{icon}</span>
        {label}
      </div>
      <div className="metric mt-3 text-3xl font-black tracking-tight" style={{ color }}>{value}</div>
      <div className="mt-1.5 text-[11.5px] font-bold text-muted/60 tracking-tight">{sub}</div>
      <div className="absolute inset-x-0 bottom-0 h-1 bg-current opacity-0 group-hover:opacity-[0.03] transition-opacity" style={{ color }} />
    </div>
  );
}

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const R = 32;
  const C = 2 * Math.PI * R;
  const off = C * (1 - score / 100);
  const color = scoreColor(score);
  return (
    <div className="flex shrink-0 items-center gap-6 rounded-3xl border border-border/80 bg-panel p-5 shadow-sm hover:shadow-md transition-all group">
      <div className="relative h-[84px] w-[84px]">
        <svg width="84" height="84" className="-rotate-90">
          <circle cx="42" cy="42" r={R} fill="none" stroke="var(--color-border)" strokeWidth="8" opacity="0.3" />
          <motion.circle
            initial={{ strokeDashoffset: C }}
            animate={{ strokeDashoffset: off }}
            transition={{ duration: 1.5, ease: [0.2, 0.8, 0.2, 1] as const, delay: 0.2 }}
            cx="42" cy="42" r={R} fill="none" stroke={color}
            strokeWidth="8" strokeLinecap="round"
            strokeDasharray={C}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="metric text-3xl font-black group-hover:scale-110 transition-transform" style={{ color }}>{grade}</span>
        </div>
      </div>
      <div className="flex flex-col">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-faint">Readiness Index</div>
        <div className="metric mt-1 text-3xl font-black" style={{ color }}>
          {score}<span className="font-sans text-[11px] font-bold text-faint uppercase ml-1.5 tracking-widest">/ 100</span>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   PERFORMANCE tab
   ────────────────────────────────────────────── */

function PerformanceTab({ r, bottleneckName, narrativeLoading }: { r: AnalysisResult; bottleneckName: string; narrativeLoading?: boolean }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          icon={<TrendingUp size={15} />}
          title="How latency grows with traffic"
          subtitle="As you add more users, response times climb — the simulation shows where things break"
        />
        <LatencyCurveChart capacity={r.capacity} slo={r.slo} baselineRps={r.traffic.baselineRps} />
        <div className="grid grid-cols-2 gap-4 border-t border-border p-6 sm:grid-cols-4">
          <Stat
            label="Queue starts forming"
            value={`${fmtRps(r.capacity.kneeRps)} rps`}
            sub="latency begins to climb"
          />
          <Stat
            label="Speed target missed"
            value={`${fmtRps(r.capacity.sloBreakRps)} rps`}
            sub={`p99 exceeds ${fmtMs(r.slo.p99LatencyMs)}`}
          />
          <Stat
            label="Breaking point"
            value={`${fmtRps(r.capacity.saturationRps)} rps`}
            sub="a tier hits 100% capacity"
          />
          <Stat
            label="Weakest link"
            value={bottleneckName}
            sub="fails first under load"
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: waterfall chart */}
        <div>

          <Card>
            <CardHeader
              icon={<Clock size={15} />}
              title="Where request time goes"
              subtitle={`End-to-end journey of a single request at ${fmtRps(r.traffic.baselineRps)} rps`}
            />
            <WaterfallInline r={r} />
          </Card>
        </div>

        {/* Right: tier table */}
        <div>
          <Card>
            <CardHeader
              icon={<Layers size={15} />}
              title="Load per component"
              subtitle="How hard each part of your system is working right now"
            />
            <TierRows stations={r.baseline.stations} bottleneckId={r.capacity.bottleneckId} />
          </Card>
        </div>
      </div>

      {/* Full width narrative */}
      <Card>
        <CardHeader
          icon={<Sparkles size={15} />}
          title="What the analysis found"
          subtitle={narrativeLoading ? "AI is writing the report…" : r.llmNarrated ? "Written by AI based on your system" : "Generated from the simulation data"}
        />
        {narrativeLoading ? (
          <div className="flex items-center gap-3 px-6 py-10 text-sm text-muted">
            <Loader2 size={15} className="animate-spin text-brand shrink-0" />
            Writing analysis report…
          </div>
        ) : (
          <div className="prose-narrative max-h-96 overflow-y-auto scroll-thin px-6 py-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.narrative}</ReactMarkdown>
          </div>
        )}
      </Card>
    </div>
  );
}

function TierRows({ stations, bottleneckId }: { stations: StationLoad[]; bottleneckId: string }) {
  const shown = stations
    .filter((s) => s.visitsPerRequest > 0)
    .sort((a, b) => b.utilization - a.utilization);
  return (
    <div className="divide-y divide-border/40">
      {/* header */}
      <div className="grid grid-cols-12 gap-4 px-6 py-3 font-mono text-[9px] uppercase tracking-[0.15em] text-muted/60 bg-bg-soft/30">
        <div className="col-span-5">Component</div>
        <div className="col-span-4">Capacity</div>
        <div className="col-span-3 text-right">Instances</div>
      </div>
      <div className="flex flex-col">
        {shown.map((s, idx) => (
          <motion.div 
            key={s.componentId} 
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="grid grid-cols-12 items-center gap-4 px-6 py-5 hover:bg-bg-soft/40 transition-colors group border-border/40"
          >
            <div className="col-span-5 flex items-center gap-3 min-w-0">
              <div className="h-2.5 w-2.5 rounded-full bg-faint/40" />
              <div className="flex flex-col min-w-0">
                <span className="truncate text-sm font-semibold text-fg">{s.name}</span>
                <span className="text-[9px] font-mono text-muted/60 uppercase tracking-tighter">{s.kind}</span>
              </div>
              {s.componentId === bottleneckId && (
                <span className="ml-auto shrink-0 text-[8px] font-bold uppercase tracking-wide px-2 py-1 rounded bg-fg/10 text-fg">Bottleneck</span>
              )}
            </div>
            <div className="col-span-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs text-muted font-medium flex-1">{fmtRps(s.arrivalRps)} rps</span>
                <span className="font-mono text-xs font-bold text-fg tabular-nums" style={{ color: utilColor(s.utilization) }}>
                  {fmtPct(s.utilization * 100)}
                </span>
              </div>
              <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(0,0,0,0.1)]"
                  style={{
                    width: `${s.utilization * 100}%`,
                    backgroundColor: utilColor(s.utilization),
                  }}
                />
              </div>
            </div>
            <div className="col-span-3 text-right font-mono text-xs font-medium text-fg">
              <span>{s.instances}</span><span className="text-muted/50 mx-1">→</span><span>{s.requiredInstances}</span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function WaterfallInline({ r }: { r: AnalysisResult }) {
  const total = r.waterfall.reduce((s, h) => s + h.totalMs, 0);
  return (
    <div className="space-y-4 p-6">
      {r.waterfall.map((h) => (
        <div key={h.componentId}>
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="flex items-center gap-2 text-fg font-medium">
              <span className="h-2 w-2 rounded-full bg-muted/50" /> {h.name}
            </span>
            <span className="font-mono text-muted/70 tabular-nums">
              {fmtMs(h.totalMs)} · {h.pctOfTotal.toFixed(0)}%
            </span>
          </div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-border/40">
            <div
              className="h-full transition-all duration-500"
              style={{ 
                width: `${(h.serviceMs / total) * 100}%`,
                backgroundColor: KIND_META[h.kind].color 
              }}
              title={`processing: ${fmtMs(h.serviceMs)}`}
            />
            <div
              className="h-full opacity-30"
              style={{ 
                width: `${(h.queueWaitMs / total) * 100}%`,
                backgroundColor: KIND_META[h.kind].color 
              }}
              title={`waiting: ${fmtMs(h.queueWaitMs)}`}
            />
          </div>
        </div>
      ))}
      <div className="flex items-center gap-6 pt-2 font-mono text-[9px] text-muted/60 uppercase tracking-wide">
        <span className="flex items-center gap-2"><i className="h-1.5 w-1.5 rounded-full bg-brand" /> Processing</span>
        <span className="flex items-center gap-2"><i className="h-1.5 w-1.5 rounded-full bg-brand opacity-30" /> Queue wait</span>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   COST tab
   ────────────────────────────────────────────── */

function CostTab({ r }: { r: AnalysisResult }) {
  const max = Math.max(...r.cost.clouds.map((c) => c.totalMonthlyUsd), 1);
  const totalSavings = r.optimizations.reduce((s, o) => s + o.estimatedMonthlySavingsUsd, 0);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          icon={<DollarSign size={15} />}
          title="Cloud cost comparison"
          subtitle={`Monthly estimate sized for ${fmtRps(Math.max(r.traffic.baselineRps, r.traffic.peakRps || 0))} rps peak · approximate on-demand prices`}
        />
        <div className="space-y-3 p-6">
          {[...r.cost.clouds]
            .sort((a, b) => a.totalMonthlyUsd - b.totalMonthlyUsd)
            .map((c) => (
              <CloudBreakdown key={c.cloud} c={c} max={max} cheapest={r.cost.cheapest === c.cloud} />
            ))}
        </div>
      </Card>

      {r.optimizations.length > 0 && (
        <Card>
          <CardHeader
            icon={<DollarSign size={15} />}
            title="Ways to reduce cost"
            subtitle={`Up to ~${fmtMoney(totalSavings)}/mo in identified savings`}
          />
          <div className="divide-y divide-border">
            {r.optimizations.map((o, i) => (
              <div key={i} className="flex items-start gap-4 p-6">
                <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/10 font-display font-bold text-xs text-fg">
                  ${Math.round(o.estimatedMonthlySavingsUsd / 100) * 100 >= 1000
                    ? `${Math.round(o.estimatedMonthlySavingsUsd / 1000)}k`
                    : Math.round(o.estimatedMonthlySavingsUsd)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-fg">{o.title}</span>
                    <span className="text-[9px] font-mono font-bold uppercase tracking-wide px-2 py-1 rounded bg-muted/10 text-muted/70">
                      {o.effort} effort
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted">{o.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function CloudBreakdown({ c, max, cheapest }: { c: CloudCost; cheapest: boolean; max: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="w-24 shrink-0 text-sm font-semibold text-fg">
          {CLOUD_META[c.cloud].label}
        </span>
        <div className="h-6 flex-1 overflow-hidden rounded-lg bg-border/40">
          <div
            className="flex h-full items-center justify-end px-3 transition-all duration-700 shadow-inner"
            style={{
              width: `${Math.max(20, (c.totalMonthlyUsd / max) * 100)}%`,
              backgroundColor: CLOUD_META[c.cloud].color,
              color: c.cloud === "vercel" ? "#000" : "#fff"
            }}
          >
            <span className="text-[11px] font-black tracking-tight">{fmtMoneyExact(c.totalMonthlyUsd)}</span>
          </div>
        </div>
        {cheapest && <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded bg-fg/10 text-fg">best</span>}
        {open ? <ChevronDown size={14} className="text-muted/60" /> : <ChevronRight size={14} className="text-muted/60" />}
      </button>
      {open && (
        <div className="ml-[76px] mt-2 space-y-1 border-l border-border pl-3">
          {c.lineItems.map((li, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="truncate text-muted">
                {li.name}{" "}
                {li.note && <span className="text-faint">· {li.note}</span>}
              </span>
              <span className="tabular-nums text-fg">{fmtMoneyExact(li.monthlyUsd)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-border pt-1 text-xs">
            <span className="text-faint">Data transfer + storage</span>
            <span className="tabular-nums text-muted">{fmtMoneyExact(c.dataTransferMonthlyUsd + c.storageMonthlyUsd)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────
   RELIABILITY tab
   ────────────────────────────────────────────── */

function ReliabilityTab({ r }: { r: AnalysisResult }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* SLO check */}
        <Card>
          <CardHeader
            icon={<ShieldAlert size={15} />}
            title="Are you meeting your targets?"
            subtitle="Based on the simulation at your current traffic"
          />
          <div className="space-y-4 p-6">
            <SloCheck
              label="Response time"
              pass={r.sloAssessment.meetsLatency}
              actual={fmtMs(r.sloAssessment.p99AtBaselineMs)}
              target={fmtMs(r.slo.p99LatencyMs)}
              tip={{ title: "p99 latency check", description: "Whether the slowest 1 in 100 requests finishes within your target time.", example: "421ms < 400ms target → FAIL" }}
            />
            <SloCheck
              label="Uptime / availability"
              pass={r.sloAssessment.meetsAvailability}
              actual={fmtPct(r.sloAssessment.estimatedAvailabilityPct, 2)}
            target={`${r.slo.availabilityPct}%`}
            tip={{ title: "Availability check", description: "Modelled availability based on component redundancy. A single non-replicated tier on the request path caps this number.", example: "99.5% availability = ~44 hours downtime/year" }}
          />
          <div className="rounded-lg bg-bg-soft/60 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted flex items-center gap-1">
                Error budget <Tip title="Error budget" description="The amount of downtime your SLO target allows per month. Once you burn through it, every minute of downtime is over-budget." example="99.9% SLO = 43.8 minutes/month of allowed downtime" />
              </span>
              <span className="metric text-base text-fg">
                {Math.round(r.sloAssessment.errorBudgetMinutesPerMonth)} min/month
              </span>
            </div>
            <p className="mt-1.5 text-[11px] text-faint">
              {r.sloAssessment.headroomToSloBreakPct >= 0
                ? `~${Math.round(r.sloAssessment.headroomToSloBreakPct)}% traffic headroom before the speed target is missed`
                : "Already over the speed target ceiling"}
            </p>
          </div>
          <ul className="space-y-1.5 text-xs text-muted">
            {r.sloAssessment.notes.map((n, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-0.5 text-faint">·</span> {n}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {/* Resilience */}
      <Card>
        <CardHeader
          icon={<ShieldAlert size={15} />}
          title="What could go wrong?"
          subtitle={`${r.resilience.singlePointsOfFailure.length} single point${r.resilience.singlePointsOfFailure.length !== 1 ? "s" : ""} of failure · resilience score ${r.resilience.score}/100`}
        />
        <div className="max-h-[400px] space-y-2 overflow-y-auto scroll-thin p-6">
          {r.resilience.findings.map((f, i) => (
            <details key={i} className="group rounded-lg border border-border/60 bg-bg-soft/40 hover:bg-bg-soft/60 transition-colors">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3">
                <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded bg-muted/20 text-muted/80 shrink-0">
                  {SEVERITY_META[f.severity].label}
                </span>
                <span className="text-sm font-semibold text-fg flex-1">{f.title}</span>
                <ChevronRight size={13} className="text-muted/60 transition group-open:rotate-90" />
              </summary>
              <div className="border-t border-border/40 px-4 pb-4 pt-3 text-xs space-y-2.5">
                <p className="text-muted/80">{f.detail}</p>
                <div>
                  <span className="font-semibold text-muted/70">If this fails: </span>
                  <span className="text-muted/80">{f.blastRadius}</span>
                </div>
                <div className="rounded-lg bg-fg/5 px-3 py-2 text-muted/80 text-[10px]">→ {f.recommendation}</div>
              </div>
            </details>
          ))}
        </div>
      </Card>
      </div>

      {/* Scaling plan */}
      <Card>
        <CardHeader
          icon={<TrendingUp size={15} />}
          title="Scaling plan"
          subtitle="How many instances you need at baseline vs. peak traffic, and the best scaling strategy per tier"
        />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/40 text-left font-mono text-[9px] uppercase tracking-widest text-muted/60">
                <th className="px-6 py-3">Component</th>
                <th className="px-6 py-3">Strategy</th>
                <th className="px-6 py-3 text-right">Min</th>
                <th className="px-6 py-3 text-right">Normal</th>
                <th className="px-6 py-3 text-right">Peak</th>
                <th className="px-6 py-3 hidden lg:table-cell">Notes</th>
              </tr>
            </thead>
            <tbody>
              {r.scaling.tiers.map((t) => (
                <tr key={t.componentId} className="border-b border-border/40 hover:bg-bg-soft/30 transition-colors">
                  <td className="px-6 py-4">
                    <span className="flex items-center gap-2 text-fg font-medium">
                      <span className="h-1.5 w-1.5 rounded-full bg-muted/40" /> {t.name}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded bg-muted/10 text-muted/70">
                      {t.strategy}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right font-mono font-medium text-muted/80">{t.minInstances}</td>
                  <td className="px-6 py-4 text-right font-mono font-medium text-muted/80">{t.baselineInstances}</td>
                  <td className="px-6 py-4 text-right font-mono font-bold text-fg">{t.peakInstances}</td>
                  <td className="hidden px-6 py-4 text-muted/70 lg:table-cell text-[10px]">{t.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.scaling.notes.length > 0 && (
          <ul className="space-y-2 border-t border-border/40 p-6 text-xs text-muted/70">
            {r.scaling.notes.map((n, i) => (
              <li key={i} className="flex gap-2"><span className="text-muted/40">·</span>{n}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function SloCheck({ label, pass, actual, target, tip }: {
  label: string; pass: boolean; actual: string; target: string;
  tip?: { title: string; description: string; example?: string };
}) {
  return (
    <div className={`flex items-center justify-between rounded-lg border px-4 py-3.5 ${pass ? "border-border/50 bg-fg/5" : "border-border/60 bg-fg/2"}`}>
      <div className="flex items-center gap-2 flex-1">
        <span className={`flex h-5 w-5 items-center justify-center rounded-full shrink-0 ${pass ? "bg-fg/20 text-fg" : "bg-fg/10"}`}>
          {pass ? <CheckCircle2 size={12} /> : <XCircle size={12} className="text-muted/60" />}
        </span>
        <span className="flex items-center gap-1 text-sm font-semibold text-fg">
          {label}
          {tip && <Tip {...tip} />}
        </span>
      </div>
      <div className="text-right font-mono text-sm">
        <span className={pass ? "text-fg font-bold" : "text-muted/70"}>{actual}</span>
        <span className="text-muted/60"> vs {target}</span>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   READINESS tab
   ────────────────────────────────────────────── */

const CAT_LABELS: Record<ChecklistItem["category"], { label: string; description: string }> = {
  reliability: { label: "Reliability", description: "Redundancy, backups, failover" },
  scalability: { label: "Scalability", description: "Headroom, autoscaling, stateful limits" },
  security: { label: "Security", description: "TLS, secrets, WAF, rate limiting" },
  observability: { label: "Observability", description: "Metrics, alerts, tracing" },
  cost: { label: "Cost", description: "Efficiency, right-sizing" },
  operations: { label: "Operations", description: "IaC, runbooks, safe deploys" },
};
const CAT_ORDER = Object.keys(CAT_LABELS) as ChecklistItem["category"][];

const statusIcon = (s: ChecklistItem["status"]) => {
  switch (s) {
    case "pass": return <CheckCircle2 size={14} className="text-good shrink-0" />;
    case "warn": return <AlertTriangle size={14} className="text-warn shrink-0" />;
    case "fail": return <XCircle size={14} className="text-bad shrink-0" />;
    default: return <HelpCircle size={14} className="text-faint shrink-0" />;
  }
};

function ReadinessTab({ r }: { r: AnalysisResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        {/* Score ring */}
        <Card className="flex flex-col items-center justify-center gap-6 p-8 text-center">
          <div className="relative h-[140px] w-[140px]">
            {(() => {
              const R = 55; const C = 2 * Math.PI * R;
              const off = C * (1 - r.readiness.score / 100);
              const color = gradeColor(r.readiness.grade);
              return (
                <svg width="140" height="140" className="-rotate-90">
                  <circle cx="70" cy="70" r={R} fill="none" stroke="var(--color-border)" strokeWidth="8" opacity="0.3" />
                  <circle cx="70" cy="70" r={R} fill="none" stroke={color} strokeWidth="8"
                    strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off}
                    style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.2,0.7,0.2,1)" }} />
                </svg>
              );
            })()}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="metric text-4xl font-black" style={{ color: gradeColor(r.readiness.grade) }}>{r.readiness.grade}</span>
              <span className="metric text-[9px] font-bold text-muted uppercase tracking-wider mt-1">{r.readiness.score} pts</span>
            </div>
          </div>
          <div>
            <p className="text-sm font-bold text-fg">Production Readiness</p>
            <p className="mt-2 text-xs text-muted/80 leading-relaxed">
              {r.readiness.score >= 80 ? "✓ Ready to ship." : r.readiness.score >= 60 ? "~ Almost there — a few things to fix." : "⚠ Needs work before going to production."}
            </p>
          </div>
        </Card>

        {/* Category breakdown + checklist */}
        <div className="space-y-6">
          <Card>
            <CardHeader icon={<Gauge size={15} />} title="Score by category" />
            <div className="space-y-4 p-6">
              {CAT_ORDER.map((cat) => (
                <div key={cat} className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-fg">
                      {CAT_LABELS[cat].label}
                      <span className="text-faint">— {CAT_LABELS[cat].description}</span>
                    </span>
                    <span className="font-mono tabular-nums" style={{ color: scoreColor(r.readiness.byCategory[cat]) }}>
                      {r.readiness.byCategory[cat]}
                    </span>
                  </div>
                  <Bar value={r.readiness.byCategory[cat]} max={100} color={scoreColor(r.readiness.byCategory[cat])} />
                </div>
              ))}
            </div>
          </Card>

          <div className="border-t border-border px-4 py-3">
            <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-xs text-brand hover:text-brand-2">
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {open ? "Hide" : "Show all"} {r.readiness.checklist.length} checklist items
            </button>
          </div>

          {open && (
            <Card>
              <div className="divide-y divide-border">
                {CAT_ORDER.map((cat) => {
                  const items = r.readiness.checklist.filter((i) => i.category === cat);
                  return (
                    <div key={cat}>
                      <div className="bg-bg-soft/40 px-4 py-2">
                        <p className="font-mono text-[10px] uppercase tracking-wider text-faint">{CAT_LABELS[cat].label}</p>
                      </div>
                      <div className="divide-y divide-border/50">
                        {items.map((item) => (
                          <div key={item.id} className="flex items-start gap-3 px-4 py-2.5">
                            <span className="mt-0.5">{statusIcon(item.status)}</span>
                            <div>
                              <p className="text-sm text-fg">{item.label}</p>
                              <p className="text-xs text-muted">{item.detail}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   INFRA tab
   ────────────────────────────────────────────── */

function InfraTab({ r }: { r: AnalysisResult }) {
  const [iacTab, setIacTab] = useState(0);
  const [copied, setCopied] = useState(false);
  const artifact = r.iac[iacTab];

  const copy = async () => {
    await navigator.clipboard.writeText(artifact.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
      {/* IaC viewer */}
      <Card>
        <CardHeader
          icon={<FileCode2 size={15} />}
          title="Infrastructure as Code"
          subtitle="Generated starting-point templates — review before applying"
          right={
            <button onClick={copy} className="flex items-center gap-1.5 text-xs text-muted transition hover:text-fg">
              {copied ? <Check size={13} className="text-good" /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
          }
        />
        <div className="flex gap-1 border-b border-border px-3 pt-2">
          {r.iac.map((a, i) => (
            <button
              key={a.filename}
              onClick={() => setIacTab(i)}
              className={`rounded-t-md px-3 py-1.5 font-mono text-xs transition ${i === iacTab ? "bg-bg-soft text-fg" : "text-muted hover:text-fg"}`}
            >
              {a.filename}
            </button>
          ))}
        </div>
        <pre className="max-h-[420px] overflow-auto scroll-thin bg-bg-soft/30 p-4 font-mono text-[11px] leading-relaxed text-muted">
          <code>{artifact.content}</code>
        </pre>
      </Card>

      {/* Architecture + assumptions */}
      <div className="space-y-4">
        <Card>
          <CardHeader icon={<Network size={15} />} title="Your architecture" subtitle={`${r.model.components.length} components`} />
          <div className="divide-y divide-border">
            {r.model.components.map((c) => (
              <div key={c.id} className="flex items-center gap-2.5 px-4 py-2.5">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-bold uppercase"
                  style={{ background: `${KIND_META[c.kind].color}20`, color: KIND_META[c.kind].color }}
                >
                  {c.kind.slice(0, 2)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-medium text-fg">{c.name}</span>
                    {c.id === r.model.entrypoint && <Badge color="var(--color-brand)">entry</Badge>}
                    {!c.replicated && c.kind !== "external" && <Badge color="var(--color-bad)">single</Badge>}
                  </div>
                  <div className="text-[11px] text-faint">{KIND_META[c.kind].label}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader icon={<HelpCircle size={15} />} title="Assumptions made" subtitle="Review and correct these for better accuracy" />
          <ul className="space-y-1.5 p-4 text-xs text-muted">
            {[...r.model.assumptions, ...r.warnings].map((a, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-0.5 text-brand">·</span>
                {a}
              </li>
            ))}
          </ul>
          <div className="border-t border-border px-4 py-3 text-[11px] text-faint">
            Cost figures are approximate on-demand US list prices. Latency/throughput depend on the accuracy of the inferred per-tier parameters.
          </div>
        </Card>
      </div>
    </div>
  );
}
