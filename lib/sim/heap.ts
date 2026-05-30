/**
 * Binary min-heap keyed by a numeric priority. The discrete-event simulator
 * uses this as its event queue (lowest timestamp first).
 */
export class MinHeap<T> {
  private items: T[] = [];

  constructor(private readonly key: (item: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(item: T): void {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    const k = this.key;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (k(items[i]) >= k(items[parent])) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      i = parent;
    }
  }

  pop(): T | undefined {
    const items = this.items;
    const n = items.length;
    if (n === 0) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (n > 1) {
      items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftDown(i: number): void {
    const items = this.items;
    const n = items.length;
    const k = this.key;
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < n && k(items[l]) < k(items[smallest])) smallest = l;
      if (r < n && k(items[r]) < k(items[smallest])) smallest = r;
      if (smallest === i) break;
      [items[i], items[smallest]] = [items[smallest], items[i]];
      i = smallest;
    }
  }
}
