import { describe, expect, it } from "vitest";
import {
  erlangB,
  erlangC,
  requiredInstances,
  stationMetrics,
  stationSaturationRps,
} from "./queueing";

describe("Erlang formulas", () => {
  it("erlangB matches known M/M/1 blocking", () => {
    // B(1, a) = a / (1 + a)
    expect(erlangB(1, 0.5)).toBeCloseTo(0.5 / 1.5, 6);
    expect(erlangB(1, 2)).toBeCloseTo(2 / 3, 6);
  });

  it("erlangC for a single server equals offered load", () => {
    // Known identity: C(1, a) = a  for a < 1
    expect(erlangC(1, 0.5)).toBeCloseTo(0.5, 6);
    expect(erlangC(1, 0.25)).toBeCloseTo(0.25, 6);
  });

  it("erlangC saturates to 1 when load >= servers", () => {
    expect(erlangC(2, 2)).toBe(1);
    expect(erlangC(3, 5)).toBe(1);
  });

  it("erlangC decreases as servers are added at fixed load", () => {
    const a = 5;
    const c6 = erlangC(6, a);
    const c10 = erlangC(10, a);
    expect(c10).toBeLessThan(c6);
  });
});

describe("stationMetrics (M/M/c)", () => {
  it("reproduces the textbook M/M/1 result", () => {
    // lambda = 0.5/s, service 1000ms => mu = 1/s, rho = 0.5
    const m = stationMetrics(0.5, 1000, 1);
    expect(m.utilization).toBeCloseTo(0.5, 6);
    expect(m.queueWaitMs).toBeCloseTo(1000, 3); // Wq = rho/(mu-lambda)*... = 1s
    expect(m.residenceMs).toBeCloseTo(2000, 3); // W = 1/(mu-lambda) = 2s
    expect(m.stable).toBe(true);
  });

  it("flags saturation when arrival rate exceeds capacity", () => {
    const m = stationMetrics(3, 1000, 2); // capacity 2/s
    expect(m.stable).toBe(false);
    expect(m.utilization).toBeGreaterThanOrEqual(1);
    expect(m.queueWaitMs).toBe(Number.POSITIVE_INFINITY);
  });

  it("adds servers to reduce queueing", () => {
    const a = stationMetrics(8, 1000, 10);
    const b = stationMetrics(8, 1000, 20);
    expect(b.queueWaitMs).toBeLessThan(a.queueWaitMs);
  });
});

describe("capacity helpers", () => {
  it("computes saturation rps", () => {
    expect(stationSaturationRps(50, 10)).toBeCloseTo(200, 6); // 10 servers, 50ms each
    expect(stationSaturationRps(1000, 1)).toBeCloseTo(1, 6);
  });

  it("sizes instances to a utilization target", () => {
    // offered = 10 * 0.1 = 1 Erlang; target 0.7 => 1.43 servers => 2 instances (1 worker each)
    expect(requiredInstances(10, 100, 1, 0.7)).toBe(2);
    // with 4 workers per instance, 1 instance suffices
    expect(requiredInstances(10, 100, 4, 0.7)).toBe(1);
  });
});
