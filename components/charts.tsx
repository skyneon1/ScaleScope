"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CapacityCurve, SloTarget } from "@/lib/model/types";
import { fmtMs, fmtRps } from "@/lib/format";

interface Props {
  capacity: CapacityCurve;
  slo: SloTarget;
  baselineRps: number;
}

const MONO = "var(--font-mono)";

export function LatencyCurveChart({ capacity, slo, baselineRps }: Props) {
  const baselineP99 = capacity.points.find((p) => p.rps >= baselineRps)?.p99 ?? 0;
  const ceiling = Math.max(slo.p99LatencyMs * 3, baselineP99 * 4, 60);
  const data = capacity.points.map((p) => ({
    rps: p.rps,
    p50: Math.min(p.p50, ceiling),
    p95: Math.min(p.p95, ceiling),
    p99: Math.min(p.p99, ceiling),
    util: p.maxUtilization,
  }));

  return (
    <div className="h-72 w-full px-1 py-3">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 18, bottom: 18, left: 2 }}>
          <CartesianGrid stroke="#e2e2e8" strokeDasharray="3 4" vertical={false} />
          <XAxis
            dataKey="rps"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={fmtRps}
            stroke="#d1d1db"
            tick={{ fill: "#81818c", fontSize: 10, fontFamily: MONO }}
            label={{ value: "REQUESTS / SEC", position: "insideBottom", offset: -10, fill: "#81818c", fontSize: 9, fontFamily: MONO, letterSpacing: 2 }}
          />
          <YAxis
            tickFormatter={(v) => fmtMs(v)}
            stroke="#d1d1db"
            tick={{ fill: "#81818c", fontSize: 10, fontFamily: MONO }}
            domain={[0, ceiling]}
            width={54}
          />
          <Tooltip
            contentStyle={{
              background: "#ffffff",
              border: "1px solid #e2e2e8",
              borderRadius: 8,
              fontSize: 12,
              fontFamily: MONO,
              boxShadow: "0 10px 30px -10px rgba(0,0,0,0.1)",
            }}
            labelStyle={{ color: "#0a0a0b", fontWeight: 700 }}
            itemStyle={{ padding: "1px 0" }}
            formatter={(value: unknown) => fmtMs(Number(value))}
            labelFormatter={(l: unknown) => `${fmtRps(Number(l))} rps`}
          />
          <ReferenceLine
            y={slo.p99LatencyMs}
            stroke="#c48c34"
            strokeDasharray="5 4"
            label={{ value: `SLO ${fmtMs(slo.p99LatencyMs)}`, fill: "#c48c34", fontSize: 10, fontFamily: MONO, position: "insideTopRight" }}
          />
          {Number.isFinite(capacity.saturationRps) && (
            <ReferenceLine
              x={Math.round(capacity.saturationRps)}
              stroke="#e34351"
              strokeDasharray="3 4"
              label={{ value: "saturation", fill: "#e34351", fontSize: 9, fontFamily: MONO, position: "top" }}
            />
          )}
          <ReferenceLine
            x={Math.round(baselineRps)}
            stroke="#81818c"
            strokeDasharray="2 3"
            label={{ value: "today", fill: "#81818c", fontSize: 9, fontFamily: MONO, position: "top" }}
          />
          <Line type="monotone" dataKey="p50" stroke="#43d199" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="p95" stroke="#6fb1e0" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="p99" stroke="#f0855d" strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-4 font-mono text-[10px] uppercase tracking-wider text-muted">
        <span className="flex items-center gap-1.5"><i className="h-0.5 w-3.5 rounded" style={{ background: "#43d199" }} />p50</span>
        <span className="flex items-center gap-1.5"><i className="h-0.5 w-3.5 rounded" style={{ background: "#6fb1e0" }} />p95</span>
        <span className="flex items-center gap-1.5"><i className="h-0.5 w-3.5 rounded" style={{ background: "#f0855d" }} />p99</span>
      </div>
    </div>
  );
}
