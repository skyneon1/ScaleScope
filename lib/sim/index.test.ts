import { describe, expect, it } from "vitest";
import type { Component, SystemModel } from "../model/types";
import { buildCapacityCurve, simulate, waterfall } from "./index";

function singleTier(): SystemModel {
  const api: Component = {
    id: "api",
    name: "API",
    kind: "api",
    serviceTimeMs: 50,
    cpuMsPerReq: 40,
    memMbBaseline: 256,
    workersPerInstance: 10,
    instances: 1, // => 10 servers => saturation at 200 rps
    dependsOn: [],
    replicated: false,
    stateful: false,
  };
  return {
    name: "single",
    summary: "",
    stack: [],
    entrypoint: "api",
    assumptions: [],
    components: [api],
  };
}

describe("simulate", () => {
  it("is stable and low-latency under light load", () => {
    const r = simulate(singleTier(), 40, { arrivals: 8000 });
    expect(r.stable).toBe(true);
    expect(r.maxUtilization).toBeCloseTo(0.2, 2); // 40 * 0.05 / 10
    expect(r.throughput).toBeGreaterThan(34);
    expect(r.throughput).toBeLessThan(46);
    expect(r.latency.p50).toBeGreaterThan(10);
    expect(r.latency.p50).toBeLessThan(120);
    expect(r.dropRate).toBe(0);
  });

  it("detects overload past saturation", () => {
    const r = simulate(singleTier(), 400, { arrivals: 8000 });
    expect(r.stable).toBe(false);
    expect(r.maxUtilization).toBeCloseTo(2.0, 1); // 400 * 0.05 / 10
    expect(r.dropRate).toBeGreaterThan(0);
    expect(r.throughput).toBeLessThan(400);
  });
});

describe("waterfall", () => {
  it("attributes latency to tiers and sums to 100%", () => {
    const hops = waterfall(singleTier(), 40);
    expect(hops).toHaveLength(1);
    expect(hops[0].componentId).toBe("api");
    expect(hops[0].pctOfTotal).toBeCloseTo(100, 3);
  });
});

describe("buildCapacityCurve", () => {
  it("produces a monotonic-ish curve with thresholds below saturation", () => {
    const curve = buildCapacityCurve(singleTier(), { p99LatencyMs: 300, availabilityPct: 99.9 }, 40, {
      arrivalsPerPoint: 4000,
    });
    expect(curve.saturationRps).toBeCloseTo(200, 0);
    expect(curve.points.length).toBeGreaterThan(5);
    // sorted by rps
    for (let i = 1; i < curve.points.length; i++) {
      expect(curve.points[i].rps).toBeGreaterThanOrEqual(curve.points[i - 1].rps);
    }
    // latency at the top of the ladder is worse than at the bottom
    const first = curve.points[0];
    const last = curve.points[curve.points.length - 1];
    expect(last.p99).toBeGreaterThan(first.p99);
    // thresholds are sane
    expect(curve.sloBreakRps).toBeGreaterThan(0);
    expect(curve.sloBreakRps).toBeLessThanOrEqual(curve.saturationRps + 1);
    expect(curve.bottleneckId).toBe("api");
  });
});
