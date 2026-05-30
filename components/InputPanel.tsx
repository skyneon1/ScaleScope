"use client";

import { useState } from "react";
import { Activity, ChevronDown, GitBranch, Loader2, PenLine, Target, TrendingUp } from "lucide-react";
import { motion } from "framer-motion";
import type { AnalysisRequest, TrafficShape } from "@/lib/model/types";
import { EXAMPLES } from "@/lib/examples";
import { Card } from "./ui";
import { FieldHelp, Tooltip } from "./Tooltip";

/* ---- Traffic shape options ---- */
const SHAPES: { id: TrafficShape; label: string; description: string; example: string }[] = [
  {
    id: "steady",
    label: "Steady",
    description: "Traffic stays roughly constant all day — like a B2B API or internal tool.",
    example: "An API called by automated scripts on a fixed schedule",
  },
  {
    id: "diurnal",
    label: "Diurnal",
    description: "Traffic peaks during business hours and drops overnight — the most common pattern for consumer apps.",
    example: "An e-commerce site with 3× traffic at noon vs. 3am",
  },
  {
    id: "spike",
    label: "Spiky",
    description: "Sudden bursts of traffic from events: a marketing email, a viral moment, a product launch.",
    example: "10× normal traffic for 15 minutes after a tweet goes viral",
  },
  {
    id: "growth",
    label: "Growing",
    description: "Traffic is growing month over month — useful for planning ahead.",
    example: "A startup scaling from 100 to 1000 rps over 6 months",
  },
];

const AVAILABILITY = [
  { value: 99, label: "99%", hint: "7.3 days downtime/year" },
  { value: 99.9, label: "99.9%", hint: "8.7 hours downtime/year" },
  { value: 99.95, label: "99.95%", hint: "4.4 hours downtime/year" },
  { value: 99.99, label: "99.99%", hint: "52 minutes downtime/year" },
];

export function InputPanel({
  onAnalyze,
  loading,
}: {
  onAnalyze: (req: AnalysisRequest) => void;
  loading: boolean;
}) {
  const [mode, setMode] = useState<"describe" | "repo">("describe");
  const [text, setText] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [shape, setShape] = useState<TrafficShape>("diurnal");
  const [baselineRps, setBaselineRps] = useState(300);
  const [peakRps, setPeakRps] = useState(1200);
  const [p99, setP99] = useState(400);
  const [availability, setAvailability] = useState(99.95);

  const applyExample = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    setMode("describe");
    setText(ex.description);
    setShape(ex.shape);
    setBaselineRps(ex.baselineRps);
    setPeakRps(ex.peakRps);
    setP99(ex.p99LatencyMs);
    setAvailability(ex.availabilityPct);
  };

  const canRun = mode === "describe" ? text.trim().length > 10 : /github\.com\//.test(repoUrl);

  const run = () => {
    if (!canRun || loading) return;
    onAnalyze({
      source:
        mode === "describe"
          ? { type: "description", text: text.trim() }
          : { type: "repo", url: repoUrl.trim() },
      traffic: {
        shape,
        baselineRps,
        peakRps: Math.max(peakRps, baselineRps),
        avgRequestKb: 2,
        avgResponseKb: 20,
      },
      slo: { p99LatencyMs: p99, availabilityPct: availability },
    });
  };

  return (
    <Card glow className="p-6 sm:p-8 backdrop-blur-md bg-panel/90 shadow-xl border-border/60 overflow-visible">
      {/* mode toggle */}
      <div className="flex items-center gap-1 rounded-2xl border border-border bg-bg-soft/80 p-1.5 text-sm shadow-inner">
        {([
          ["describe", "Describe Architecture", <PenLine key="p" size={14} className="shrink-0" />],
          ["repo", "GitHub Repository", <GitBranch key="g" size={14} className="shrink-0" />],
        ] as const).map(([m, label, icon]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex flex-1 items-center justify-center gap-2.5 rounded-xl py-1 text-[11px] font-bold uppercase tracking-wider transition-all relative ${
              mode === m ? "text-brand" : "text-faint hover:text-muted"
            }`}
          >
            <span className="relative z-10 inline-flex items-center gap-2.5 leading-none">
              <span className="flex items-center justify-center shrink-0">{icon}</span>
              <span className="relative top-[0.5px]">{label}</span>
            </span>
            {mode === m && (
              <motion.div
                layoutId="activeInputMode"
                className="absolute inset-0 bg-panel rounded-xl shadow-md border border-border"
                transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
              />
            )}
          </button>
        ))}
      </div>

      <div className="relative">
        {mode === "describe" ? (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6"
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Describe your stack (e.g., 'A Go API on RDS Aurora, using Redis for caching and SQS for background jobs')."
              className="h-44 w-full resize-none rounded-2xl border border-border bg-bg-soft/20 px-5 py-4 text-sm leading-relaxed text-fg placeholder:text-faint outline-none transition-all focus:border-brand/50 focus:ring-4 focus:ring-brand/5 focus:bg-panel shadow-sm"
            />
            <div className="mt-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[10px] font-mono text-faint uppercase tracking-[0.2em] font-bold">Standard Models</span>
                <div className="h-px flex-1 bg-border/60" />
              </div>
              <div className="flex flex-wrap gap-2.5">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.id}
                    onClick={() => applyExample(ex.id)}
                    className="group rounded-xl border border-border bg-panel px-4 py-2 text-xs font-bold text-muted transition-all hover:border-brand/40 hover:bg-brand/[0.02] hover:text-brand hover:shadow-sm"
                  >
                    <span className="mr-2 opacity-70 group-hover:opacity-100">{ex.emoji}</span>
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6"
          >
            <div className="relative">
              <input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repository"
                className="w-full rounded-2xl border border-border bg-bg-soft/20 px-5 py-4 font-mono text-sm text-fg placeholder:text-faint outline-none transition-all focus:border-brand/50 focus:ring-4 focus:ring-brand/5 focus:bg-panel pl-12 shadow-sm"
              />
              <GitBranch size={18} className="absolute left-4.5 top-1/2 -translate-y-1/2 text-faint" />
            </div>
            <p className="mt-4 text-[12px] text-faint leading-relaxed font-medium px-1 flex items-start gap-2">
              <Target size={14} className="mt-0.5 shrink-0" />
              Extract service definitions and deployment configurations automatically from public sources.
            </p>
          </motion.div>
        )}
      </div>

      {/* ── Traffic ── */}
      <div className="mt-8 border-t border-border pt-8 space-y-6">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.15em] text-faint mb-4">
            <TrendingUp size={14} className="text-brand" />
            <FieldHelp
              label="Demand Profile"
              title="Traffic Distribution Pattern"
              description="Defines how request volume fluctuates over a cycle."
            />
          </p>
          <div className="grid grid-cols-4 gap-2.5">
            {SHAPES.map((s) => (
              <Tooltip key={s.id} title={s.label} description={s.description} example={s.example} align="center">
                <button
                  onClick={() => setShape(s.id)}
                  className={`w-full rounded-xl border py-2.5 text-[10px] font-bold transition-all uppercase tracking-tighter ${
                    shape === s.id
                      ? "border-brand/60 bg-brand/5 text-brand shadow-sm font-black"
                      : "border-border bg-bg-soft/40 text-muted hover:text-fg hover:border-border-strong"
                  }`}
                >
                  {s.label}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <NumberField
            label={
              <FieldHelp
                label="Base Load"
                title="Nominal Throughput"
                description="Average number of concurrent requests per second."
              />
            }
            value={baselineRps}
            onChange={setBaselineRps}
            min={1}
            suffix="rps"
          />
          <NumberField
            label={
              <FieldHelp
                label="Peak Load"
                title="Burst Throughput"
                description="Max expected traffic volume."
                align="right"
              />
            }
            value={peakRps}
            onChange={setPeakRps}
            min={1}
            suffix="rps"
          />
        </div>

        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.15em] text-faint mb-4">
            <Target size={14} className="text-brand" />
            Design Constraints (SLO)
          </p>
          <div className="grid grid-cols-2 gap-6">
            <NumberField
              label={
                <FieldHelp
                  label="Latency Target"
                  title="Max p99 Response"
                  description="Maximum acceptable 99th percentile response time."
                />
              }
              value={p99}
              onChange={setP99}
              min={1}
              suffix="ms"
            />
            <AvailabilityPicker value={availability} onChange={setAvailability} />
          </div>
        </div>
      </div>

      <button
        disabled={!canRun || loading}
        onClick={run}
        className="mt-10 w-full group relative flex items-center justify-center gap-4 overflow-hidden rounded-2xl bg-fg px-8 py-5 text-sm font-bold text-bg transition-all hover:scale-[1.01] active:scale-[0.98] disabled:opacity-50 disabled:grayscale shadow-lg hover:shadow-xl"
      >
        {loading ? (
          <>
            <Loader2 size={20} className="animate-spin" />
            <span>Processing Model...</span>
          </>
        ) : (
          <>
            <Activity size={20} className="transition-transform group-hover:scale-110" />
            <span>Run Simulation</span>
          </>
        )}
      </button>
    </Card>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  suffix,
}: {
  label: React.ReactNode;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  suffix?: string;
}) {
  return (
    <div className="group flex flex-col gap-2">
      <div className="text-xs transition-colors group-hover:text-fg">{label}</div>
      <div className="relative">
        <input
          type="number"
          value={value}
          min={min}
          onChange={(e) => onChange(parseInt(e.target.value) || 0)}
          className="w-full rounded-xl border border-border/80 bg-bg-soft/30 px-4 py-3.5 text-sm font-bold text-fg outline-none transition-all focus:border-brand/40 focus:bg-bg-soft/60 pr-12 font-mono"
        />
        {suffix && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-[10px] lowercase text-faint font-bold tracking-tighter">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function AvailabilityPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const hint = AVAILABILITY.find((a) => a.value === value)?.hint;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_auto] items-start gap-3 min-h-[1.25rem]">
        <FieldHelp
          label="Uptime Target"
          title="Availability Objective"
          description="Percentage of time the system must be operational. Higher numbers require more redundancy."
          align="right"
        />
        {hint && (
          <span className="max-w-[120px] text-right font-mono text-[9px] text-brand font-bold uppercase tracking-tight leading-tight">
            {hint}
          </span>
        )}
      </div>
      <div className="relative group/sel">
        <select
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full rounded-xl border border-border/80 bg-bg-soft/30 px-4 py-3.5 text-sm font-bold text-fg outline-none appearance-none cursor-pointer hover:border-border-strong transition-all focus:border-brand/40 font-mono pr-10"
        >
          {AVAILABILITY.map((a) => (
            <option key={a.value} value={a.value} className="bg-panel font-bold">
              {a.label}
            </option>
          ))}
        </select>
        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-faint group-hover/sel:text-brand transition-colors">
          <ChevronDown size={14} />
        </div>
      </div>
    </div>
  );
}

