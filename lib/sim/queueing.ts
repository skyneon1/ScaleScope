/**
 * Analytic M/M/c queueing math (Erlang-B / Erlang-C).
 *
 * Used to compute exact saturation points and the instances required to hit a
 * utilization target, independent of the stochastic simulator. The simulator
 * produces empirical latency percentiles; this module produces the closed-form
 * capacity facts that bound and validate it.
 */

/**
 * Erlang-B blocking probability for `c` servers and offered load `a` Erlangs,
 * computed with the numerically stable recursion (no factorial overflow).
 */
export function erlangB(c: number, a: number): number {
  let b = 1; // B(0, a) = 1
  for (let k = 1; k <= c; k++) {
    b = (a * b) / (k + a * b);
  }
  return b;
}

/**
 * Erlang-C: probability that an arriving request has to wait (all servers busy),
 * for `c` servers and offered load `a`. Returns 1 when the system is saturated.
 */
export function erlangC(c: number, a: number): number {
  const rho = a / c;
  if (rho >= 1) return 1;
  const b = erlangB(c, a);
  return b / (1 - rho * (1 - b));
}

export interface StationMetrics {
  /** offered load in Erlangs (arrivalRps * serviceSec). */
  offeredLoad: number;
  /** rho = utilization, 0..1+. >=1 means unstable. */
  utilization: number;
  /** probability an arriving request must queue. */
  probWait: number;
  /** mean time spent waiting in queue (ms). */
  queueWaitMs: number;
  /** mean residence time = wait + service (ms). */
  residenceMs: number;
  stable: boolean;
}

/**
 * Closed-form metrics for one M/M/c station.
 * @param arrivalRps requests/sec arriving at this station
 * @param serviceTimeMs mean service time per request (ms)
 * @param servers total parallel servers (instances * workersPerInstance)
 */
export function stationMetrics(
  arrivalRps: number,
  serviceTimeMs: number,
  servers: number,
): StationMetrics {
  const c = Math.max(1, Math.floor(servers));
  const serviceSec = serviceTimeMs / 1000;
  if (serviceTimeMs <= 0 || arrivalRps <= 0) {
    return {
      offeredLoad: 0,
      utilization: 0,
      probWait: 0,
      queueWaitMs: 0,
      residenceMs: serviceTimeMs,
      stable: true,
    };
  }
  const mu = 1 / serviceSec; // per-server service rate (req/s)
  const a = arrivalRps / mu; // offered load in Erlangs
  const rho = a / c;
  if (rho >= 1) {
    return {
      offeredLoad: a,
      utilization: rho,
      probWait: 1,
      queueWaitMs: Number.POSITIVE_INFINITY,
      residenceMs: Number.POSITIVE_INFINITY,
      stable: false,
    };
  }
  const pWait = erlangC(c, a);
  // Wq = C / (c*mu - lambda)
  const wqSec = pWait / (c * mu - arrivalRps);
  const queueWaitMs = wqSec * 1000;
  return {
    offeredLoad: a,
    utilization: rho,
    probWait: pWait,
    queueWaitMs,
    residenceMs: queueWaitMs + serviceTimeMs,
    stable: true,
  };
}

/**
 * Maximum requests/sec a station can serve before saturating (rho -> 1).
 * Beyond this the queue is unstable and latency diverges.
 */
export function stationSaturationRps(serviceTimeMs: number, servers: number): number {
  if (serviceTimeMs <= 0) return Number.POSITIVE_INFINITY;
  const c = Math.max(1, Math.floor(servers));
  return (c * 1000) / serviceTimeMs;
}

/**
 * Smallest instance count keeping utilization at or below `targetUtilization`
 * for the given arrival rate.
 */
export function requiredInstances(
  arrivalRps: number,
  serviceTimeMs: number,
  workersPerInstance: number,
  targetUtilization = 0.7,
): number {
  if (arrivalRps <= 0 || serviceTimeMs <= 0) return 1;
  const serviceSec = serviceTimeMs / 1000;
  const offered = arrivalRps * serviceSec; // Erlangs
  const serversNeeded = offered / Math.min(0.95, Math.max(0.1, targetUtilization));
  return Math.max(1, Math.ceil(serversNeeded / Math.max(1, workersPerInstance)));
}
