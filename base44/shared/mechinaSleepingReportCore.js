// Pure logic for the informational Mechina actual-sleeping report.
// Never touches operational entities.

const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

// entries: [{tent_id, boys, girls, is_exception, note}]
// tentMap: {id: {code, capacity, neighborhood_id}}, nbMap: {id: {name}}
export function buildSnapshot(rawEntries, tentMap, nbMap, assignedIds) {
  const errors = [];
  const seen = new Set();
  const entries = [];
  for (const e of rawEntries || []) {
    const tent = tentMap[e.tent_id];
    if (!tent) { errors.push(`אוהל לא קיים: ${e.tent_id}`); continue; }
    if (seen.has(e.tent_id)) { errors.push(`אוהל ${tent.code} מופיע פעמיים`); continue; }
    seen.add(e.tent_id);
    const boys = toInt(e.boys ?? 0);
    const girls = toInt(e.girls ?? 0);
    if (boys === null || girls === null) { errors.push(`ערך לא תקין באוהל ${tent.code}`); continue; }
    const assigned = assignedIds.has(e.tent_id);
    const total = boys + girls;
    const warnings = [];
    if (boys > 0 && girls > 0) warnings.push("MIXED");
    if (tent.capacity && total > tent.capacity) warnings.push("OVER_CAPACITY");
    if (!assigned && total > 0) warnings.push("NOT_ASSIGNED_TENT");
    entries.push({
      tent_id: e.tent_id,
      tent_code: tent.code,
      neighborhood_id: tent.neighborhood_id,
      neighborhood_name: nbMap[tent.neighborhood_id]?.name || "",
      capacity: tent.capacity || 0,
      official_pax: tent.official_pax || 0,
      boys, girls, total,
      assigned,
      note: String(e.note || "").slice(0, 500),
      warnings,
    });
  }
  const totals = entries.reduce((a, e) => ({ boys: a.boys + e.boys, girls: a.girls + e.girls }), { boys: 0, girls: 0 });
  const byNeighborhood = {};
  for (const e of entries) {
    const k = e.neighborhood_name || "—";
    byNeighborhood[k] = byNeighborhood[k] || { boys: 0, girls: 0, total: 0 };
    byNeighborhood[k].boys += e.boys; byNeighborhood[k].girls += e.girls; byNeighborhood[k].total += e.total;
  }
  return { errors, entries, totals: { ...totals, total: totals.boys + totals.girls }, byNeighborhood };
}

export function compareSnapshots(prev, next) {
  if (!prev) return null;
  const prevMap = Object.fromEntries((prev.entries || []).map(e => [e.tent_id, e]));
  const nextMap = Object.fromEntries((next.entries || []).map(e => [e.tent_id, e]));
  const ids = new Set([...Object.keys(prevMap), ...Object.keys(nextMap)]);
  const tents = [];
  for (const id of ids) {
    const a = prevMap[id] || { boys: 0, girls: 0 };
    const b = nextMap[id] || { boys: 0, girls: 0 };
    if (a.boys !== b.boys || a.girls !== b.girls) {
      tents.push({ tent_id: id, tent_code: (b.tent_code || a.tent_code), prev_boys: a.boys, prev_girls: a.girls, boys: b.boys, girls: b.girls });
    }
  }
  return {
    prev_total: prev.totals.total, total: next.totals.total,
    prev_boys: prev.totals.boys, boys: next.totals.boys,
    prev_girls: prev.totals.girls, girls: next.totals.girls,
    changed_tents: tents,
  };
}