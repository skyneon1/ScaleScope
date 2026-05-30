/**
 * Seeded, reproducible pseudo-random generation for the simulator.
 * Same seed -> identical simulation, which keeps analysis results stable
 * for a given input (good UX) and makes the engine unit-testable.
 */

/** mulberry32 PRNG: fast, good enough for Monte-Carlo, deterministic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a numeric seed from an arbitrary string (FNV-1a). */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Sample an exponential variate with the given mean (memoryless inter-arrival / service times). */
export function expSample(rng: () => number, mean: number): number {
  if (mean <= 0) return 0;
  // 1 - u to avoid log(0)
  return -Math.log(1 - rng()) * mean;
}

/**
 * Sample a log-normal variate with target `mean` and coefficient of variation `cv`
 * (cv = stddev/mean). Service times are better modelled log-normal than exponential:
 * a tight body with a heavy tail, which is what real services look like.
 */
export function lognormalSample(rng: () => number, mean: number, cv: number): number {
  if (mean <= 0) return 0;
  if (cv <= 0) return mean;
  const sigma2 = Math.log(1 + cv * cv);
  const sigma = Math.sqrt(sigma2);
  const mu = Math.log(mean) - sigma2 / 2;
  // Box-Muller standard normal
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.exp(mu + sigma * z);
}
