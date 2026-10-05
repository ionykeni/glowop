import { isGroupOperationallyEnabled } from './groupOperationalIsolation.js';
import { occupiesSleepingNight } from './groupStayPeriods.js';
import { toInventory, maxSafeUnknown, reserveKnown, reserveUnknown, reserveTents } from './sleepingFeasibility.js';

/**
 * Shared read-only site sleeping capacity (single source of truth for the Quote
 * feasibility card and the Quotes availability calendar).
 * Sleeping nights: start <= night < end. MULTI_PERIOD Groups: ACTIVE GroupStayPeriod only.
 */
const VIP_MARKER = /__vip_req_\d+__/i;
const ALT_MARKER = '__alt_tent__';
const num = v => Number(v) || 0;
const parseJson = (v, fallback) => { try { const r = JSON.parse(v || ''); return r ?? fallback; } catch { return fallback; } };
export const inRange = (arr, dep, night) => !!arr && arr <= night && night < (dep || arr);

export async function loadSiteCapacityData(db) {
  const [settingsArr, allTents, allGroups, allProfiles, allHolds, allAllocations, allStayPeriods] = await Promise.all([
    db.SiteSettings.list(),
    db.Tent.list(null, 1000),
    db.Group.list("-arrival_date", 1000),
    db.OperationalGroupProfile.list(null, 2000),
    db.OperationalHold.filter({ status: "ACTIVE" }),
    db.SleepingAllocation.filter({ status: { $in: ["DRAFT", "CONFIRMED"] } }, null, 5000),
    db.GroupStayPeriod.filter({ status: "ACTIVE" }, null, 2000),
  ]);
  return { settings: settingsArr[0] || {}, allTents, allGroups, allProfiles, allHolds, allAllocations, allStayPeriods };
}

export function buildSiteCapacityContext(data, { exclude_group_id, exclude_quote_id } = {}) {
  const { allTents, allGroups, allProfiles, allHolds, allAllocations, allStayPeriods } = data;
  const working = allTents.filter(t => t.working_status === "WORKING");
  const standardTents = working.filter(t => t.tent_type === "STANDARD");
  const vipTents = working.filter(t => t.tent_type === "VIP");
  const tentById = Object.fromEntries(allTents.map(t => [t.id, t]));
  const groupById = Object.fromEntries(allGroups.map(g => [g.id, g]));
  const profileByGroupId = Object.fromEntries(allProfiles.map(p => [p.group_id, p]));
  const byGroup = rows => rows.reduce((m, r) => ((m[r.group_id] ||= []).push(r), m), {});
  const qualifyingGroups = allGroups.filter(g =>
    g.group_type === "LODGING" && isGroupOperationallyEnabled(g) &&
    ["CONFIRMED", "COMPLETED"].includes(g.status) && g.id !== exclude_group_id && g.arrival_date);
  const countedGroupIds = new Set(qualifyingGroups.map(g => g.id));
  const relevantHolds = allHolds.filter(h =>
    h.group_type === "LODGING" &&
    !(h.group_id && !isGroupOperationallyEnabled(groupById[h.group_id])) &&
    !(exclude_quote_id && h.quote_id === exclude_quote_id) &&
    !(h.group_id && countedGroupIds.has(h.group_id)));
  return {
    standardTents, vipTents, tentById, groupById, profileByGroupId, qualifyingGroups, relevantHolds,
    allocsByGroup: byGroup(allAllocations), periodsByGroup: byGroup(allStayPeriods),
  };
}

/** Existing operational demand on one night → remaining conservative STANDARD/VIP inventories. */
export function evaluateExistingNight(ctx, night) {
  const { qualifyingGroups, relevantHolds, profileByGroupId, allocsByGroup, periodsByGroup, tentById, standardTents, vipTents } = ctx;
  let existingPeople = 0, unmodeledHolds = false, dataIncomplete = false, existingOvercommitted = false;
  const occupiedTentIds = new Set();
  const pending = [];
  const staffVipFirst = [];

  for (const g of qualifyingGroups) {
    const present = g.stay_mode === "MULTI_PERIOD"
      ? occupiesSleepingNight(night, periodsByGroup[g.id] || [])
      : inRange(g.arrival_date, g.departure_date, night);
    if (!present) continue;
    const profile = profileByGroupId[g.id];
    const pax = num(g.total_pax) || num(profile?.total_pax) || (num(profile?.participant_count) + num(profile?.staff_count));
    existingPeople += pax;

    const allocs = (allocsByGroup[g.id] || []).filter(a => inRange(a.arrival_date, a.departure_date, night));
    allocs.forEach(a => a.tent_id && occupiedTentIds.add(a.tent_id));
    if (profile?.is_sleeping_group === false) continue;

    const studentAllocs = allocs.filter(a => a.allocation_type === "STUDENT");
    const staffAllocs = allocs.filter(a => a.allocation_type === "STAFF");
    const isVipRow = a => tentById[a.tent_id]?.tent_type === "VIP" || VIP_MARKER.test(a.notes || '');
    const vipAllocTents = new Set(staffAllocs.filter(isVipRow).map(a => a.tent_id)).size;
    const altAllocPax = staffAllocs.filter(a => !isVipRow(a) || (a.notes || '').includes(ALT_MARKER)).reduce((s, a) => s + num(a.allocated_pax), 0);
    const allocBy = gender => studentAllocs.filter(a => a.gender_group === gender).reduce((s, a) => s + num(a.allocated_pax), 0);
    const allocStudentTotal = studentAllocs.reduce((s, a) => s + num(a.allocated_pax), 0);

    const reqBoys = num(profile?.boys_beds_needed) || num(profile?.boys_count);
    const reqGirls = num(profile?.girls_beds_needed) || num(profile?.girls_count);
    if (reqBoys > 0 || reqGirls > 0) {
      pending.push({ kind: "known", people: [Math.max(0, reqBoys - allocBy("BOYS")), Math.max(0, reqGirls - allocBy("GIRLS"))] });
    } else {
      if (!profile) dataIncomplete = true;
      const reqStudents = num(profile?.participant_count) || num(g.participant_count) || Math.max(0, pax - num(profile?.staff_count ?? g.staff_count));
      pending.push({ kind: "unknown", people: Math.max(0, reqStudents - allocStudentTotal) });
    }
    const vipReq = parseJson(profile?.vip_tent_requirements_json, []);
    const vipReqTents = Array.isArray(vipReq) && vipReq.length > 0
      ? vipReq.filter(r => num(r.people_count) > 0).length
      : num(profile?.vip_tents_men_needed) + num(profile?.vip_tents_women_needed);
    pending.push({ kind: "vipTents", tents: Math.max(0, vipReqTents - vipAllocTents) });
    const remainingAlt = Math.max(0, num(profile?.staff_alt_tent_pax) - altAllocPax);
    pending.push({ kind: "unknown", people: remainingAlt });
    const requiredStaff = num(profile?.staff_count) || num(g.staff_count);
    const staffAllocPax = staffAllocs.reduce((s, a) => s + num(a.allocated_pax), 0);
    const vipAllocPax = staffAllocs.filter(isVipRow).reduce((s, a) => s + num(a.allocated_pax), 0);
    const explicitVipPeople = Array.isArray(vipReq) && vipReq.length > 0
      ? vipReq.reduce((s, r) => s + num(r.people_count), 0)
      : num(profile?.staff_men_beds_needed) + num(profile?.staff_women_beds_needed);
    const remainingVipPeople = Math.max(0, explicitVipPeople - vipAllocPax);
    const unresolvedStaff = Math.max(0, requiredStaff - staffAllocPax - remainingVipPeople - remainingAlt);
    if (unresolvedStaff > 0) staffVipFirst.push(unresolvedStaff);
  }

  for (const h of relevantHolds) {
    if (!inRange(h.arrival_date, h.departure_date, night)) continue;
    existingPeople += num(h.total_pax);
    if (num(h.participant_count) > 0) pending.push({ kind: "unknown", people: num(h.participant_count) });
    if (!(num(h.participant_count) > 0) || num(h.staff_count) > 0) unmodeledHolds = true;
  }

  const stdInv = toInventory(standardTents.filter(t => !occupiedTentIds.has(t.id)).map(t => num(t.capacity)));
  const vipInv = toInventory(vipTents.filter(t => !occupiedTentIds.has(t.id)).map(t => num(t.capacity)));
  for (const p of pending) {
    const shortfall = p.kind === "known" ? reserveKnown(stdInv, p.people)
      : p.kind === "unknown" ? reserveUnknown(stdInv, p.people)
      : reserveTents(vipInv, p.tents);
    if (shortfall > 0) existingOvercommitted = true;
  }
  for (const n of staffVipFirst) {
    const safe = maxSafeUnknown(n, vipInv);
    if (safe > 0) reserveUnknown(vipInv, safe);
    if (n - safe > 0 && reserveUnknown(stdInv, n - safe) > 0) existingOvercommitted = true;
  }
  return { existingPeople, stdInv, vipInv, unmodeledHolds, dataIncomplete, existingOvercommitted };
}