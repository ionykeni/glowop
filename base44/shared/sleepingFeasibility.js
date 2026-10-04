/**
 * Conservative, read-only sleeping feasibility helpers (pure functions, no I/O).
 *
 * Inventory model: a pool of whole physical tents grouped by real Tent.capacity
 *   { caps: [8, 6, 3], counts: [31, 9, 1] }   (caps sorted descending)
 *
 * Rules enforced by the solver:
 *  - whole tents only; a tent is never split between demands
 *  - every demand (e.g. "student boys", "student girls", "staff men", "staff women")
 *    receives a DISJOINT set of tents
 *  - unknown gender: every split x / N-x is tested (symmetric, so x <= N/2)
 *
 * Complexity: instead of 2^tents, demands are covered by count-vectors over the few
 * distinct capacities (DP/memo over remaining count vectors).
 */

export function toInventory(capacities) {
  const valid = capacities.map(Number).filter(c => c > 0);
  const caps = [...new Set(valid)].sort((a, b) => b - a);
  return { caps, counts: caps.map(c => valid.filter(x => x === c).length) };
}

export const inventoryCapacity = inv => inv.caps.reduce((s, c, i) => s + c * inv.counts[i], 0);
export const inventoryTentCount = inv => inv.counts.reduce((s, n) => s + n, 0);
const cloneInv = inv => ({ caps: inv.caps, counts: [...inv.counts] });

// Count-vectors (within counts) covering `people`. Complete: every feasible cover dominates one of these.
function coverVectors(people, inv, cache) {
  const key = `${people}`;
  if (cache.has(key)) return cache.get(key);
  const out = [];
  const vec = inv.caps.map(() => 0);
  const walk = (i, remaining) => {
    if (remaining <= 0) { out.push([...vec]); return; }
    if (i === inv.caps.length) return;
    const max = Math.min(inv.counts[i], Math.ceil(remaining / inv.caps[i]));
    for (let k = max; k >= 0; k--) { vec[i] = k; walk(i + 1, remaining - k * inv.caps[i]); }
    vec[i] = 0;
  };
  walk(0, people);
  cache.set(key, out);
  return out;
}

/** Can every demand (people counts) get its own disjoint set of whole tents? */
export function canCoverAll(demands, inv, ctx = { vectors: new Map(), memo: new Map() }) {
  const ds = demands.filter(d => d > 0).sort((a, b) => b - a);
  if (ds.reduce((s, d) => s + d, 0) > inventoryCapacity(inv)) return false;
  const solve = (idx, counts) => {
    if (idx === ds.length) return true;
    const key = `${ds.slice(idx).join(",")}|${counts.join(",")}`;
    if (ctx.memo.has(key)) return ctx.memo.get(key);
    let ok = false;
    for (const v of coverVectors(ds[idx], inv, ctx.vectors)) {
      if (v.some((n, i) => n > counts[i])) continue;
      if (solve(idx + 1, counts.map((n, i) => n - v[i]))) { ok = true; break; }
    }
    ctx.memo.set(key, ok);
    return ok;
  };
  return solve(0, inv.counts);
}

/**
 * Classify all gender splits for one or more cohorts sharing one inventory.
 * cohorts: [{ total, split?: [a, b] }]   (split = known gender counts)
 * Returns "ALL" | "SOME" | "NO" (+ counts).
 */
export function classifySplits(cohorts, inv) {
  const active = cohorts.filter(c => (c.split ? c.split[0] + c.split[1] : c.total) > 0);
  if (active.length === 0) return { result: "ALL", feasible: 1, tested: 1 };
  const options = active.map(c => {
    if (c.split) return [c.split];
    const rows = [];
    for (let x = 0; x <= Math.floor(c.total / 2); x++) rows.push([x, c.total - x]);
    return rows;
  });
  const ctx = { vectors: new Map(), memo: new Map() };
  let feasible = 0, tested = 0;
  const walk = (i, demands) => {
    if (i === options.length) { tested++; if (canCoverAll(demands, inv, ctx)) feasible++; return; }
    for (const pair of options[i]) walk(i + 1, [...demands, ...pair]);
  };
  walk(0, []);
  return { result: feasible === tested ? "ALL" : feasible === 0 ? "NO" : "SOME", feasible, tested };
}

/** Largest k <= n such that EVERY gender split of k people fits the inventory. */
export function maxSafeUnknown(n, inv) {
  for (let k = n; k > 0; k--) if (classifySplits([{ total: k }], inv).result === "ALL") return k;
  return 0;
}

// Largest-first greedy removal covering `people`; mutates inv. Returns { tents, shortfall }.
function takeLargestFirst(inv, people) {
  let remaining = people, tents = 0;
  for (let i = 0; i < inv.caps.length && remaining > 0; i++) {
    while (inv.counts[i] > 0 && remaining > 0) { inv.counts[i]--; remaining -= inv.caps[i]; tents++; }
  }
  return { tents, shortfall: Math.max(0, remaining) };
}

/**
 * Existing-demand buffer: reserve tents for EXISTING groups' unallocated demand.
 * Strategy (deterministic, conservative): consume the LARGEST available tents first,
 * so the remainder offered to the new Quote is the pessimistic one. For unknown gender,
 * the split that consumes the MOST tents is reserved. Mutates inv; returns shortfall people.
 */
export function reserveKnown(inv, peopleByGender) {
  let shortfall = 0;
  for (const p of peopleByGender) if (p > 0) shortfall += takeLargestFirst(inv, p).shortfall;
  return shortfall;
}

export function reserveUnknown(inv, people) {
  if (people <= 0) return 0;
  let best = null;
  for (let x = 0; x <= Math.floor(people / 2); x++) {
    const trial = cloneInv(inv);
    const a = takeLargestFirst(trial, x), b = takeLargestFirst(trial, people - x);
    const used = a.tents + b.tents;
    if (!best || used > best.used) best = { used, counts: trial.counts, shortfall: a.shortfall + b.shortfall };
  }
  inv.counts = best.counts;
  return best.shortfall;
}

/** Remove `tents` whole tents (largest first) — for demands expressed in tents. Returns shortfall tents. */
export function reserveTents(inv, tents) {
  let remaining = tents;
  for (let i = 0; i < inv.caps.length && remaining > 0; i++) {
    const take = Math.min(inv.counts[i], remaining);
    inv.counts[i] -= take; remaining -= take;
  }
  return remaining;
}

/**
 * Human-readable tent estimate (display only — never the feasibility decision).
 * minimum = no gender separation; conservative = worst gender split.
 * With uniform capacity C: ceil(N/C) and max_x ceil(x/C)+ceil((N-x)/C).
 * With mixed capacities: largest-first greedy on the given inventory.
 */
export function tentEstimate(people, inv, nominalCap = null) {
  if (people <= 0) return { minimum: 0, conservative: 0 };
  const count = n => {
    if (n <= 0) return 0;
    if (nominalCap) return Math.ceil(n / nominalCap);
    const trial = cloneInv(inv); const r = takeLargestFirst(trial, n);
    return r.shortfall > 0 ? null : r.tents;
  };
  const pair = x => {
    if (nominalCap) return count(x) + count(people - x);
    const trial = cloneInv(inv);
    const a = takeLargestFirst(trial, x), b = takeLargestFirst(trial, people - x);
    return a.shortfall + b.shortfall > 0 ? null : a.tents + b.tents;
  };
  let conservative = 0;
  for (let x = 0; x <= Math.floor(people / 2); x++) {
    const v = pair(x);
    if (v === null) { conservative = null; break; }
    conservative = Math.max(conservative, v);
  }
  return { minimum: count(people), conservative };
}