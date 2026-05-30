import { describe, expect, it } from "vitest";
import type { Component, SystemModel } from "../model/types";
import {
  computeVisits,
  normalizeModel,
  sampleRoute,
  systemSaturationRps,
} from "./topology";
import { mulberry32 } from "./random";

function comp(partial: Partial<Component> & Pick<Component, "id" | "kind">): Component {
  return {
    name: partial.id,
    serviceTimeMs: 10,
    cpuMsPerReq: 5,
    memMbBaseline: 128,
    workersPerInstance: 1,
    instances: 1,
    dependsOn: [],
    replicated: false,
    stateful: false,
    ...partial,
  };
}

function fanoutModel(): SystemModel {
  return {
    name: "fanout",
    summary: "",
    stack: [],
    entrypoint: "web",
    assumptions: [],
    components: [
      comp({ id: "web", kind: "web", serviceTimeMs: 5, instances: 1, workersPerInstance: 100, dependsOn: ["api"] }),
      comp({
        id: "api",
        kind: "api",
        serviceTimeMs: 20,
        instances: 1,
        workersPerInstance: 50,
        dependsOn: ["db", "cache"],
        callsPerRequest: { db: 2, cache: 1 },
      }),
      comp({ id: "db", kind: "database", serviceTimeMs: 10, instances: 1, workersPerInstance: 20, stateful: true }),
      comp({ id: "cache", kind: "cache", serviceTimeMs: 1, instances: 1, workersPerInstance: 50, stateful: true }),
    ],
  };
}

describe("computeVisits", () => {
  it("propagates fan-out through the graph", () => {
    const v = computeVisits(fanoutModel());
    expect(v.get("web")).toBeCloseTo(1, 6);
    expect(v.get("api")).toBeCloseTo(1, 6);
    expect(v.get("db")).toBeCloseTo(2, 6); // 2 calls per request
    expect(v.get("cache")).toBeCloseTo(1, 6);
  });

  it("gives unreachable workers a default async unit", () => {
    const m = fanoutModel();
    m.components.push(comp({ id: "worker", kind: "worker", serviceTimeMs: 100 }));
    const v = computeVisits(m);
    expect(v.get("worker")).toBe(1);
  });
});

describe("sampleRoute", () => {
  it("produces a deterministic pre-order route with fan-out expanded", () => {
    const route = sampleRoute(fanoutModel(), mulberry32(1));
    expect(route).toEqual(["web", "api", "db", "db", "cache"]);
  });
});

describe("systemSaturationRps", () => {
  it("finds the bottleneck tier and its external capacity", () => {
    // db: 20 servers / 10ms => 2000 rps raw, /2 visits => 1000 external rps (lowest)
    const cap = systemSaturationRps(fanoutModel());
    expect(cap.bottleneckId).toBe("db");
    expect(cap.saturationRps).toBeCloseTo(1000, 3);
  });

  it("ignores async (off-path) workers when bounding request capacity", () => {
    const m = fanoutModel();
    // a very slow background worker that is NOT on the synchronous request path
    m.components.push(
      comp({ id: "worker", kind: "worker", serviceTimeMs: 500, instances: 1, workersPerInstance: 1 }),
    );
    const cap = systemSaturationRps(m);
    // worker capacity would be 2 rps, but it must not become the bottleneck
    expect(cap.bottleneckId).toBe("db");
    expect(cap.saturationRps).toBeCloseTo(1000, 3);
  });
});

describe("normalizeModel", () => {
  it("drops dangling dependencies and reports them", () => {
    const m = fanoutModel();
    m.components[1].dependsOn.push("ghost");
    const { model, warnings } = normalizeModel(m);
    expect(model.components[1].dependsOn).not.toContain("ghost");
    expect(warnings.some((w) => w.includes("ghost"))).toBe(true);
  });

  it("repairs a missing entrypoint", () => {
    const m = fanoutModel();
    m.entrypoint = "nope";
    const { model, warnings } = normalizeModel(m);
    expect(model.entrypoint).toBe("web"); // first web-kind component
    expect(warnings.some((w) => w.includes("Entrypoint"))).toBe(true);
  });
});
