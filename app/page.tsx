"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, AlertCircle, Cpu, DollarSign, Gauge, Loader2, Moon, Network, Sparkles, Sun, Terminal } from "lucide-react";
import type { AnalysisRequest, AnalysisResult } from "@/lib/model/types";
import { useTheme } from "@/components/ThemeProvider";
import { InputPanel } from "@/components/InputPanel";
import { Dashboard } from "@/components/Dashboard";

type State =
  | { phase: "idle" }
  | { phase: "loading"; step: string }
  | { phase: "partial"; result: AnalysisResult }
  | { phase: "error"; message: string }
  | { phase: "done"; result: AnalysisResult };

export default function Home() {
  const [state, setState] = useState<State>({ phase: "idle" });

  const analyze = async (req: AnalysisRequest) => {
    setState({ phase: "loading", step: "Profiling your architecture…" });
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error ?? `Request failed (${res.status}).`);
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type: string; [k: string]: unknown };
          if (event.type === "profiled") {
            setState({ phase: "loading", step: "Simulating & analyzing…" });
          } else if (event.type === "analysed") {
            setState({ phase: "partial", result: event.partial as AnalysisResult });
          } else if (event.type === "done") {
            setState({ phase: "done", result: event.result as AnalysisResult });
          } else if (event.type === "error") {
            throw new Error(event.message as string);
          }
        }
      }
    } catch (err) {
      setState({ phase: "error", message: (err as Error).message });
    }
  };

  return (
    <div className="relative z-10 flex min-h-screen flex-col selection:bg-brand/10">
      <TopNav />
      <main className="w-full flex-grow px-6 py-6 sm:px-10 lg:px-16">
        <div className="grid grid-cols-1 gap-12 xl:grid-cols-[462px_1fr]">
          <aside className="xl:sticky xl:top-[120px] xl:self-start space-y-8">
            <InputPanel onAnalyze={analyze} loading={state.phase === "loading"} />
            <HowItWorks />
          </aside>
          <section className="min-w-0">
            {state.phase === "idle" && <EmptyState />}
            {state.phase === "loading" && <LoadingState step={state.step} />}
            {state.phase === "error" && <ErrorState message={state.message} onReset={() => setState({ phase: "idle" })} />}
            {state.phase === "partial" && <Dashboard r={state.result} narrativeLoading />}
            {state.phase === "done" && <Dashboard r={state.result} />}
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <button 
      onClick={toggleTheme}
      className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-panel text-fg transition-all hover:border-brand/40 hover:shadow-sm active:scale-[0.95]"
      aria-label="Toggle theme"
    >
      {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}

function TopNav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur-xl">
      <div className="flex h-20 w-full items-center justify-between px-6 sm:px-10 lg:px-16">
        <div className="flex items-center gap-4">
          <div className="group relative flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-panel shadow-sm transition-all hover:border-brand/40 hover:shadow-brand/5">
            <Gauge size={24} className="text-brand transition-transform group-hover:rotate-12" />
          </div>
          <div className="flex flex-col">
            <span className="font-display text-[22px] font-bold tracking-tight text-fg leading-none font-bold">
              ScaleScope<span className="text-brand">.</span>
            </span>
            <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-faint mt-1.5 font-bold">
              Architectural Intelligence
            </span>
          </div>
        </div>
        <div className="flex items-center gap-10">
          <div className="hidden items-center gap-8 font-mono text-[11px] text-faint xl:flex">
            <span className="flex items-center gap-2.5 font-bold text-muted">
              <span className="h-2 w-2 rounded-full bg-good shadow-[0_0_8px_var(--color-good)]" /> 
              Sim Engine Active
            </span>
            <div className="h-5 w-px bg-border" />
            <span className="opacity-80 hover:opacity-100 transition-opacity cursor-default font-bold">Stable v1.2</span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button className="rounded-xl border border-border bg-panel px-6 py-2.5 text-xs font-bold text-fg shadow-sm transition-all hover:border-brand/40 hover:bg-bg hover:shadow-md active:scale-[0.97]">
              Configuration
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", icon: <Network size={13} />, title: "Profile", text: "Infer a system model from your description or repo." },
    { n: "02", icon: <Activity size={13} />, title: "Simulate", text: "A discrete-event queueing sim ramps load to its limits." },
    { n: "03", icon: <DollarSign size={13} />, title: "Price", text: "Size each tier and compare AWS / GCP / Vercel." },
    { n: "04", icon: <Gauge size={13} />, title: "Score", text: "SLO, resilience, scaling, readiness & IaC." },
  ];
  return (
    <div className="rounded-2xl border border-border bg-panel/60 p-5 shadow-sm">
      <div className="eyebrow lowercase opacity-70">The pipeline</div>
      <div className="mt-5 space-y-5">
        {steps.map((s) => (
          <div key={s.n} className="flex gap-4 group">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-soft text-brand transition-colors group-hover:border-brand/40 group-hover:bg-brand/5">
              {s.icon}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-faint">{s.n}</span>
                <span className="text-sm font-semibold text-fg">{s.title}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted leading-relaxed">{s.text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  const features = [
    ["Load simulation", "Real M/M/c queueing — p50/p95/p99 vs RPS, saturation & knee."],
    ["Bottleneck finder", "Which tier fails first, and at what request rate."],
    ["Multi-cloud cost", "AWS vs GCP vs Vercel, sized for your peak."],
    ["SLO & error budget", "Latency + availability vs your targets."],
    ["Resilience analysis", "Single points of failure & blast radius."],
    ["Scaling plan", "Autoscaling floors & ceilings per tier."],
  ];
  return (
    <div className="flex h-full min-h-[500px] flex-col justify-center rounded-2xl border border-border bg-panel/30 p-10 sm:p-14 animate-in">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-brand/30 bg-brand/5 text-brand shadow-[0_0_20px_rgba(230,169,60,0.1)]">
        <Sparkles size={28} />
      </div>
      <div className="eyebrow mt-8 lowercase opacity-70">Capacity & cost planning</div>
      <h2 className="mt-2.5 max-w-xl font-display text-4xl font-bold leading-tight tracking-tight text-fg transition-all">
        Know how it scales, breaks, and <span className="text-brand">bills</span> — before you ship.
      </h2>
      <p className="mt-4 max-w-lg text-md leading-relaxed text-muted font-medium">
        Input your system architecture, set your traffic targets, and let our engine simulate the results in real-time.
      </p>
      <div className="mt-10 grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
        {features.map(([t, d]) => (
          <div key={t} className="group rounded-xl border border-border bg-bg-soft/40 p-4 transition-all hover:border-border-strong hover:bg-bg-soft/60">
            <div className="text-sm font-semibold text-fg group-hover:text-brand transition-colors">{t}</div>
            <div className="mt-1 text-xs text-faint leading-relaxed">{d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingState({ step }: { step: string }) {
  return (
    <div className="flex min-h-[500px] flex-col items-center justify-center rounded-2xl border border-border bg-panel/20 p-12 text-center overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-b from-brand/5 to-transparent pointer-events-none" />
      <div className="relative mb-8">
        <div className="absolute inset-0 blur-2xl bg-brand/20 animate-pulse" />
        <Loader2 size={48} className="animate-spin text-brand relative z-10" strokeWidth={1.5} />
      </div>
      <div className="font-mono text-xs text-brand mb-2 animate-pulse uppercase tracking-[0.2em]">Processing Request</div>
      <h3 className="font-display text-2xl font-semibold text-fg">{step}</h3>
      <div className="mt-6 flex gap-1.5 justify-center">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-1.5 w-1.5 rounded-full bg-brand/40 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
      <p className="mt-8 max-w-[300px] text-xs font-mono text-faint uppercase leading-relaxed tracking-wider">
        Quantizing models · estimating latency · calculating cloud costs
      </p>
    </div>
  );
}

function ErrorState({ message, onReset }: { message: string; onReset: () => void }) {
  return (
    <div className="flex min-h-[500px] flex-col items-center justify-center rounded-2xl border border-bad/20 bg-bad/5 p-12 text-center animate-in">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-bad/30 bg-bad/10 text-bad shadow-[0_0_20px_rgba(251,93,108,0.1)]">
        <AlertCircle size={32} />
      </div>
      <div className="font-mono text-[10px] text-bad mb-2 uppercase tracking-[0.2em]">Simulation Failed</div>
      <h3 className="font-display text-2xl font-semibold text-fg font-mono">Analysis Error</h3>
      <p className="mt-4 max-w-md text-sm text-bad/80 leading-relaxed font-mono bg-bg/50 p-4 rounded-lg border border-bad/10">
        {message}
      </p>
      <button 
        onClick={onReset}
        className="mt-8 rounded-xl border border-border bg-panel px-6 py-2.5 text-xs font-bold text-fg transition-all hover:bg-bg-soft active:scale-95"
      >
        Retry Analysis
      </button>
    </div>
  );
}

const PHASES = [
  "Profiling the system…",
  "Building the system model…",
  "Simulating load to saturation…",
  "Pricing across clouds…",
  "Scoring production readiness…",
];

function Footer() {
  return (
    <footer className="border-t border-border/40 py-12 px-6 sm:px-10 lg:px-16">
      <div className="flex flex-col items-center justify-between gap-8 sm:flex-row">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Gauge size={18} className="text-brand" />
            <span className="font-display text-lg font-bold text-fg">ScaleScope</span>
          </div>
          <p className="text-xs text-muted max-w-xs leading-relaxed">
            A specialized tool for distributed systems architects and performance engineers.
          </p>
        </div>
        <div className="flex flex-col sm:items-end gap-2 text-right">
          <p className="text-[10px] font-mono text-faint tracking-widest uppercase">© 2026 SCALESCOPE ENGINE. ALL RIGHTS RESERVED.</p>
          <div className="flex gap-4 items-center">
            <div className="flex gap-1.5 items-center">
              <div className="h-1 w-1 rounded-full bg-good" />
              <span className="text-[9px] font-mono text-faint uppercase">Stability: Alpha</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

