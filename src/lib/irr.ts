/**
 * True IRR from cashflow · Newton-Raphson method.
 * @param cashflows array: [outflow (negative), inflow1, inflow2, ...]
 * @param guess initial guess (e.g. 0.01 for monthly, 0.05 for annual)
 * @returns IRR rate (as decimal · e.g. 0.008 = 0.8%) · returns NaN if no convergence
 */
export function irr(cashflows: number[], guess = 0.01): number {
  if (cashflows.length < 2) return NaN;
  const MAX_ITER = 100;
  const TOL = 1e-7;
  let rate = guess;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let npv = 0, dNpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const factor = Math.pow(1 + rate, t);
      npv += cashflows[t] / factor;
      if (t > 0) dNpv += -t * cashflows[t] / (factor * (1 + rate));
    }
    if (Math.abs(dNpv) < 1e-12) return NaN;
    const newRate = rate - npv / dNpv;
    if (Math.abs(newRate - rate) < TOL) return newRate;
    rate = newRate;
  }
  return NaN;
}
