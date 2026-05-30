import { describe, expect, it } from "vitest";
import type { Component, SystemModel, TrafficProfile } from "../model/types";
import { compareClouds, priceCloud, sizeTiers } from "./cost";

function comp(p: Partial<Component> & Pick<Component, "id" | "kind">): Component {
  return {
    name: p.id,
    serviceTimeMs: 10,
    cpuMsPerReq: 8,
    memMbBaseline: 256,
    workersPerInstance: 20,
    instances: 1,
    dependsOn: [],
    replicated: false,
    stateful: false,
    ...p,
  };
}

function model(): SystemModel {
  return {
    name: "shop",
    summary: "",
    stack: ["node", "postgres", "redis"],
    entrypoint: "lb",
    assumptions: [],
    components: [
      comp({ id: "lb", kind: "load_balancer", serviceTimeMs: 1, workersPerInstance: 1000, dependsOn: ["api"] }),
      comp({ id: "api", kind: "api", serviceTimeMs: 40, cpuMsPerReq: 30, workersPerInstance: 8, dependsOn: ["db", "cache"], callsPerRequest: { db: 1.5, cache: 3 } }),
      comp({ id: "db", kind: "database", serviceTimeMs: 8, workersPerInstance: 50, stateful: true }),
      comp({ id: "cache", kind: "cache", serviceTimeMs: 1, workersPerInstance: 100, stateful: true }),
      comp({ id: "storage", kind: "storage", serviceTimeMs: 20 }),
    ],
  };
}

const traffic: TrafficProfile = {
  shape: "steady",
  baselineRps: 100,
  peakRps: 300,
  avgRequestKb: 2,
  avgResponseKb: 30,
};

describe("sizeTiers", () => {
  it("scales instance counts with peak traffic", () => {
    const low = sizeTiers(model(), 100);
    const high = sizeTiers(model(), 1000);
    const apiLow = low.find((s) => s.componentId === "api")!.instances;
    const apiHigh = high.find((s) => s.componentId === "api")!.instances;
    expect(apiHigh).toBeGreaterThan(apiLow);
  });
});

describe("priceCloud", () => {
  it("prices AWS with a real DB SKU and positive totals", () => {
    const sizing = sizeTiers(model(), 300);
    const cost = priceCloud("aws", model(), traffic, sizing);
    expect(cost.totalMonthlyUsd).toBeGreaterThan(0);
    expect(cost.costPerMillionRequestsUsd).toBeGreaterThan(0);
    const dbLine = cost.lineItems.find((l) => l.componentId === "db")!;
    expect(dbLine.resource).toMatch(/^db\./);
    // egress shows up
    expect(cost.dataTransferMonthlyUsd).toBeGreaterThan(0);
    // storage tier exists -> storage cost
    expect(cost.storageMonthlyUsd).toBeGreaterThan(0);
  });

  it("prices Vercel via serverless + managed services (no VM SKUs)", () => {
    const sizing = sizeTiers(model(), 300);
    const cost = priceCloud("vercel", model(), traffic, sizing);
    const apiLine = cost.lineItems.find((l) => l.componentId === "api")!;
    expect(apiLine.resource).toBe("serverless function");
    const dbLine = cost.lineItems.find((l) => l.componentId === "db")!;
    expect(dbLine.resource).toBe("managed (marketplace)");
    expect(cost.totalMonthlyUsd).toBeGreaterThan(0);
  });
});

describe("compareClouds", () => {
  it("ranks the three clouds", () => {
    const cmp = compareClouds(model(), traffic);
    expect(cmp.clouds.map((c) => c.cloud).sort()).toEqual(["aws", "gcp", "vercel"]);
    expect(["aws", "gcp", "vercel"]).toContain(cmp.cheapest);
    expect(cmp.spreadUsd).toBeGreaterThanOrEqual(0);
    // cheapest really is the minimum
    const min = Math.min(...cmp.clouds.map((c) => c.totalMonthlyUsd));
    expect(cmp.clouds.find((c) => c.cloud === cmp.cheapest)!.totalMonthlyUsd).toBeCloseTo(min, 2);
  });
});
