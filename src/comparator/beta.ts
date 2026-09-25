const lnGamma = (n: number) => { let s = 0; for (let k = 2; k < n; k++) s += Math.log(k); return s; };
const lnBeta = (a: number, b: number) => lnGamma(a) + lnGamma(b) - lnGamma(a + b);

// P(X < Y) for X ~ Beta(a1, b1), Y ~ Beta(a2, b2) with integer params (Cook 2005)
function pLess(a1: number, b1: number, a2: number, b2: number): number {
  let s = 0;
  for (let i = 0; i < a2; i++) s += Math.exp(lnBeta(a1 + i, b1 + b2) - Math.log(b2 + i) - lnBeta(1 + i, b2) - lnBeta(a1, b1));
  return s;
}

/** P(p_new < p_old) under Beta(1,1) priors. */
export function pRegressed(oldPass: number, oldN: number, newPass: number, newN: number): number {
  return 1 - pLess(1 + oldPass, 1 + oldN - oldPass, 1 + newPass, 1 + newN - newPass);
}
