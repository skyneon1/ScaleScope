import type { Cloud, ComponentKind, Severity } from "./model/types";

const SATURATED = 600_000;

export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms >= SATURATED) return "∞";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

export function fmtRps(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `${Math.round(n)}`;
}

export function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function fmtMoneyExact(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

export function fmtPct(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export const KIND_META: Record<ComponentKind, { label: string; color: string }> = {
  load_balancer: { label: "Load balancer", color: "#9b8cf0" },
  web: { label: "Web / SSR", color: "#5ea9e6" },
  api: { label: "API", color: "#38c2a8" },
  worker: { label: "Worker", color: "#c08ae0" },
  database: { label: "Database", color: "#4fc78a" },
  cache: { label: "Cache", color: "#ef8f6b" },
  queue: { label: "Queue", color: "#d9b24a" },
  search: { label: "Search", color: "#f0855d" },
  storage: { label: "Storage", color: "#8a93a6" },
  external: { label: "External", color: "#ef6b78" },
};

export const CLOUD_META: Record<Cloud, { label: string; color: string }> = {
  aws: { label: "AWS", color: "#f0993e" },
  gcp: { label: "GCP", color: "#6f9bef" },
  vercel: { label: "Vercel", color: "#f1f1f4" },
};

export const SEVERITY_META: Record<Severity, { label: string; color: string }> = {
  critical: { label: "Critical", color: "#ff7886" },
  high: { label: "High", color: "#fb5d6c" },
  medium: { label: "Medium", color: "#f2a23c" },
  low: { label: "Low", color: "#6fb1e0" },
  info: { label: "Info", color: "#8a8a98" },
};

export function gradeColor(grade: string): string {
  switch (grade) {
    case "A":
      return "#43d199";
    case "B":
      return "#8fd16a";
    case "C":
      return "#f2a23c";
    case "D":
      return "#f5793b";
    default:
      return "#fb5d6c";
  }
}

export function scoreColor(score: number): string {
  if (score >= 80) return "#43d199";
  if (score >= 60) return "#f2a23c";
  if (score >= 40) return "#f5793b";
  return "#fb5d6c";
}

export function utilColor(u: number): string {
  if (u >= 1) return "#fb5d6c";
  if (u >= 0.85) return "#f5793b";
  if (u >= 0.65) return "#f2a23c";
  return "#43d199";
}
