import { describe, expect, it } from "vitest";
import { MinHeap } from "./heap";

describe("MinHeap", () => {
  it("pops items in ascending key order", () => {
    const h = new MinHeap<number>((x) => x);
    const input = [5, 1, 9, 3, 3, 7, 0, 2, 8, 4];
    for (const x of input) h.push(x);
    const out: number[] = [];
    while (h.size > 0) out.push(h.pop()!);
    expect(out).toEqual([...input].sort((a, b) => a - b));
  });

  it("handles interleaved push/pop (event-queue style)", () => {
    const h = new MinHeap<{ t: number }>((x) => x.t);
    h.push({ t: 10 });
    h.push({ t: 5 });
    expect(h.pop()!.t).toBe(5);
    h.push({ t: 7 });
    h.push({ t: 3 });
    expect(h.pop()!.t).toBe(3);
    expect(h.pop()!.t).toBe(7);
    expect(h.pop()!.t).toBe(10);
    expect(h.pop()).toBeUndefined();
  });
});
