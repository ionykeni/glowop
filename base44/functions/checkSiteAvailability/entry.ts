import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { isGroupOperationallyEnabled } from '../../shared/groupOperationalIsolation.js';
import { occupiesSleepingNight } from '../../shared/groupStayPeriods.js';
import {
  toInventory, inventoryCapacity, inventoryTentCount, classifySplits, maxSafeUnknown,
  reserveKnown, reserveUnknown, reserveTents, tentEstimate,
} from '../../shared/sleepingFeasibility.js';

/**
 * Conservative sleeping feasibility check (read-only, informational — never blocks).
 *
 * Payload:
 *   arrival_date, departure_date (YYYY-MM-DD), total_pax, group_type "LODGING"|"DAY_USE"
 *   participant_count, staff_count, vip_people (staff sleeping in the real VIP pool)
 *   boys_count, girls_count (optional known student split)
 *   exclude_quote_id (holds), exclude_group_id (linked Group — never self-counted)
 *
 * Sleeping nights: arrival <= night < departure. MULTI_PERIOD Groups: ACTIVE GroupStayPeriod only.
 */
const NEAR_FULL_PCT = 0.85;
const RANK = { ALL: 0, SOME: 1, NO: 2 };
const VIP_RANK = { NONE: 0, OK: 0, VIP_OVERFLOW_TO_ALT: 1, NOT_FEASIBLE: 2 };
const VIP_MARKER = /__vip_req_\d+__/i;
const ALT_MARKER = '__alt_tent__';
const num = v => Number(v) || 0;
const parseJson = (v, fallback) => { try { const r = JSON.parse(v || ''); return r ?? fallback; } catch { return fallback; } };
const fmt = night => night.slice(5).split('-').reverse().join('/');

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const { arrival_date, departure_date, total_pax, group_type, exclude_quote_id, exclude_group_id } = body;
    if (!arrival_date || !total_pax || !group_type) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    const db = base44.asServiceRole.entities;
    const [settingsArr, allTents, allGroups, allProfiles, allHolds, allAllocations, allStayPeriods] = await Promise.all([
      db.SiteSettings.list(),
      db.Tent.list(null, 1000),
      db.Group.list("-arrival_date", 1000),
      db.OperationalGroupProfile.list(null, 2000),
      db.OperationalHold.filter({ status: "ACTIVE" }),
      db.SleepingAllocation.filter({ status: { $in: ["DRAFT", "CONFIRMED"] } }, null, 5000),
      db.GroupStayPeriod.filter({ status: "ACTIVE" }, null, 2000),
    ]);
    const settings = settingsArr[0] || {};
    const maxSleeping = num(settings.max_sleeping_pax);
    const maxDayUse = num(settings.max_day_use_pax);
    const maxMeal = num(settings.max_meal_pax);

    // ── Physical inventory (real WORKING tents, real capacities) ──────────────
    const working = allTents.filter(t => t.working_status === "WORKING");
    const standardTents = working.filter(t => t.tent_type === "STANDARD");
    const vipTents = working.filter(t => t.tent_type === "VIP");
    const tentById = Object.fromEntries(allTents.map(t => [t.id, t]));
    const vipCaps = [...new Set(vipTents.map(t => num(t.capacity)))];
    const vipNominalCap = vipCaps.length === 1 ? vipCaps[0] : null; // display only, never faked
    const stdCapFreq = {};
    standardTents.forEach(t => { stdCapFreq[num(t.capacity)] = (stdCapFreq[num(t.capacity)] || 0) + 1; });
    const stdNominalCap = Number(Object.entries(stdCapFreq).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0]) || null; // display only

    // ── Requested sleeping nights ────────────────────────────────────────────
    const nights = [];
    if (group_type === "LODGING") {
      const cur = new Date(`${arrival_date}T00:00:00Z`);
      const end = new Date(`${departure_date || arrival_date}T00:00:00Z`);
      while (cur < end) { nights.push(cur.toISOString().slice(0, 10)); cur.setUTCDate(cur.getUTCDate() + 1); }
    }
    const inRange = (arr, dep, night) => !!arr && arr <= night && night < (dep || arr);

    // ── Indexes ──────────────────────────────────────────────────────────────
    const groupById = Object.fromEntries(allGroups.map(g => [g.id, g]));
    const profileByGroupId = Object.fromEntries(allProfiles.map(p => [p.group_id, p]));
    const byGroup = rows => rows.reduce((m, r) => ((m[r.group_id] ||= []).push(r), m), {});
    const allocsByGroup = byGroup(allAllocations);
    const periodsByGroup = byGroup(allStayPeriods);

    const qualifyingGroups = allGroups.filter(g =>
      g.group_type === "LODGING" && isGroupOperationallyEnabled(g) &&
      ["CONFIRMED", "COMPLETED"].includes(g.status) && g.id !== exclude_group_id && g.arrival_date);
    const countedGroupIds = new Set(qualifyingGroups.map(g => g.id));
    const relevantHolds = allHolds.filter(h =>
      h.group_type === "LODGING" &&
      !(h.group_id && !isGroupOperationallyEnabled(groupById[h.group_id])) &&
      !(exclude_quote_id && h.quote_id === exclude_quote_id) &&
      !(h.group_id && countedGroupIds.has(h.group_id)));

    // ── Current Quote cohorts ────────────────────────────────────────────────
    const requestedPax = num(total_pax);
    const staff = Math.min(num(body.staff_count), requestedPax);
    const students = num(body.participant_count) || Math.max(0, requestedPax - staff);
    const vipPeople = group_type === "LODGING" ? Math.min(num(body.vip_people), staff) : 0;
    const regularStaff = Math.max(0, staff - vipPeople);
    const boys = num(body.boys_count), girls = num(body.girls_count);
    const studentSplit = (boys > 0 || girls > 0) ? [boys, girls] : null;
    const invariantOk = students + regularStaff + vipPeople === requestedPax;

    let unmodeledHolds = false, dataIncomplete = false, existingOvercommitted = false;

    // ── Per-night evaluation ─────────────────────────────────────────────────
    const perNight = nights.map(night => {
      let existingPeople = 0;
      const occupiedTentIds = new Set();
      const pending = []; // existing demand not represented by allocations
      const staffVipFirst = []; // existing unresolved staff (VIP-first, overflow to standard)

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

        // Student requirement: authoritative OGP beds, then known counts, else unknown gender.
        const reqBoys = num(profile?.boys_beds_needed) || num(profile?.boys_count);
        const reqGirls = num(profile?.girls_beds_needed) || num(profile?.girls_count);
        if (reqBoys > 0 || reqGirls > 0) {
          pending.push({ kind: "known", people: [Math.max(0, reqBoys - allocBy("BOYS")), Math.max(0, reqGirls - allocBy("GIRLS"))] });
        } else {
          if (!profile) dataIncomplete = true;
          const reqStudents = num(profile?.participant_count) || num(g.participant_count) || Math.max(0, pax - num(profile?.staff_count ?? g.staff_count));
          pending.push({ kind: "unknown", people: Math.max(0, reqStudents - allocStudentTotal) });
        }
        // VIP requirement (tents): vip_tent_requirements_json, else legacy tent counts.
        const vipReq = parseJson(profile?.vip_tent_requirements_json, []);
        const vipReqTents = Array.isArray(vipReq) && vipReq.length > 0
          ? vipReq.filter(r => num(r.people_count) > 0).length
          : num(profile?.vip_tents_men_needed) + num(profile?.vip_tents_women_needed);
        pending.push({ kind: "vipTents", tents: Math.max(0, vipReqTents - vipAllocTents) });
        // Alternative staff tents (אוהל חילופי).
        const remainingAlt = Math.max(0, num(profile?.staff_alt_tent_pax) - altAllocPax);
        pending.push({ kind: "unknown", people: remainingAlt });
        // Unresolved staff (no allocation / explicit requirement): VIP first, overflow → אוהל חילופי.
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
        // Holds carry no VIP/gender detail: reserve students conservatively, flag the rest.
        if (num(h.participant_count) > 0) pending.push({ kind: "unknown", people: num(h.participant_count) });
        if (!(num(h.participant_count) > 0) || num(h.staff_count) > 0) unmodeledHolds = true;
      }

      // Pools after exact occupied tents, then existing-demand buffer (largest tents first).
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

      // New Quote: VIP first, overflow to alternative staff tents, then joint standard solve.
      const vipCapacity = inventoryCapacity(vipInv);
      let vipOverflow = 0, vipSplits = "ALL";
      if (vipPeople > 0) {
        vipSplits = classifySplits([{ total: vipPeople }], vipInv).result;
        if (vipSplits !== "ALL") vipOverflow = vipPeople - maxSafeUnknown(vipPeople, vipInv);
      }
      const altPeople = regularStaff + vipOverflow;
      const std = classifySplits([{ total: students, split: studentSplit }, { total: altPeople }], stdInv);
      const vipStatus = vipPeople === 0 ? "NONE" : vipOverflow === 0 ? "OK"
        : std.result === "NO" ? "NOT_FEASIBLE" : "VIP_OVERFLOW_TO_ALT"; // normal fallback, not a review reason

      return {
        night,
        people: { existing: existingPeople, projected: existingPeople + requestedPax },
        standard: { result: std.result, available_tents: inventoryTentCount(stdInv), available_capacity: inventoryCapacity(stdInv), alt_people: altPeople, inventory: stdInv },
        vip: { status: vipStatus, splits: vipSplits, available_tents: inventoryTentCount(vipInv), available_capacity: vipCapacity, overflow: vipOverflow, inventory: vipInv },
      };
    });

    // ── Limiting nights ──────────────────────────────────────────────────────
    const worst = (rows, score) => rows.reduce((w, r) => (w === null || score(r) > score(w) ? r : w), null);
    const peakPeople = worst(perNight, r => r.people.projected);
    const limitingStd = worst(perNight, r => RANK[r.standard.result] * 1e6 - r.standard.available_capacity);
    const limitingVip = worst(perNight, r => VIP_RANK[r.vip.status] * 1e6 - r.vip.available_capacity);

    const peopleExceeded = maxSleeping > 0 && !!peakPeople && peakPeople.people.projected > maxSleeping;
    const peopleNearFull = maxSleeping > 0 && !!peakPeople && !peopleExceeded && peakPeople.people.projected >= maxSleeping * NEAR_FULL_PCT;

    // ── Overall status ───────────────────────────────────────────────────────
    let feasibility = null;
    if (group_type === "LODGING" && perNight.length > 0) {
      const red = peopleExceeded || limitingStd.standard.result === "NO" || limitingVip.vip.status === "NOT_FEASIBLE";
      const reasons = [];
      if (limitingStd.standard.result === "SOME") reasons.push("GENDER_SPLIT_DEPENDENT");
      if (unmodeledHolds) reasons.push("UNMODELED_HOLDS");
      if (dataIncomplete) reasons.push("EXISTING_DATA_INCOMPLETE");
      if (existingOvercommitted) reasons.push("EXISTING_DEMAND_EXCEEDS_INVENTORY");
      if (peopleNearFull) reasons.push("NEAR_FULL");
      if (maxSleeping === 0) reasons.push("CAPACITY_UNCONFIGURED");
      if (!invariantOk) reasons.push("PEOPLE_BREAKDOWN_MISMATCH");
      const stdEst = night => ({
        students: tentEstimate(students, night.standard.inventory, stdNominalCap),
        alt: tentEstimate(night.standard.alt_people, night.standard.inventory, stdNominalCap),
      });
      const est = stdEst(limitingStd);
      feasibility = {
        status: red ? "NOT_FEASIBLE" : reasons.length > 0 ? "NEEDS_REVIEW" : "OK",
        reasons,
        nights_count: perNight.length,
        first_night: perNight[0].night,
        last_night: perNight[perNight.length - 1].night,
        physical_capacity_has_unmodeled_holds: unmodeledHolds,
        people: {
          capacity: maxSleeping, peak_projected: peakPeople.people.projected, peak_existing: peakPeople.people.existing,
          peak_date: peakPeople.night, remaining: maxSleeping - peakPeople.people.projected, exceeded: peopleExceeded, near_full: peopleNearFull,
        },
        breakdown: { total: requestedPax, students, regular_staff: regularStaff, vip_people: vipPeople, invariant_ok: invariantOk },
        standard: {
          result: limitingStd.standard.result, limiting_date: limitingStd.night,
          available_tents: limitingStd.standard.available_tents, available_capacity: limitingStd.standard.available_capacity,
          students_estimate: est.students, alt_people: limitingStd.standard.alt_people, alt_estimate: est.alt,
          nominal_capacity: stdNominalCap,
        },
        vip: {
          status: limitingVip.vip.status, splits: limitingVip.vip.splits, limiting_date: limitingVip.night,
          people: vipPeople, available_tents: limitingVip.vip.available_tents, available_capacity: limitingVip.vip.available_capacity,
          overflow: limitingVip.vip.overflow, estimate: tentEstimate(vipPeople, limitingVip.vip.inventory, vipNominalCap),
          total_working_tents: vipTents.length, nominal_capacity: vipNominalCap,
        },
        per_night: perNight.map(({ night, people, standard, vip }) => ({
          night, people,
          standard: { result: standard.result, available_tents: standard.available_tents, available_capacity: standard.available_capacity, alt_people: standard.alt_people },
          vip: { status: vip.status, available_tents: vip.available_tents, available_capacity: vip.available_capacity, overflow: vip.overflow },
        })),
      };
    }

    // ── Legacy warnings (consumed by the approval dialog) ────────────────────
    const warnings = [];
    if (peopleExceeded || peopleNearFull) {
      const p = peakPeople.people;
      warnings.push(peopleExceeded
        ? { type: "SLEEPING_CAPACITY", severity: "WARNING", message: `בתאריך ${fmt(peakPeople.night)} צפויים ללון באתר ${p.projected} אנשים מתוך ${maxSleeping}.\nיש חריגה מתפוסת הלינה המקסימלית.`, held: p.existing, requested: requestedPax, max: maxSleeping }
        : { type: "SLEEPING_CAPACITY_NEAR_FULL", severity: "NEAR_FULL", message: `בתאריך ${fmt(peakPeople.night)} צפויים ללון באתר ${p.projected} אנשים מתוך ${maxSleeping}.\nכולל קבוצות קיימות וההצעה הנוכחית.`, held: p.existing, requested: requestedPax, max: maxSleeping, percentage: Math.round(p.projected / maxSleeping * 100) });
    }
    if (feasibility?.status === "NOT_FEASIBLE" && !peopleExceeded) {
      warnings.push({ type: "SLEEPING_PHYSICAL", severity: "WARNING", message: "לפי מלאי האוהלים הפעיל, הלינה לא נראית אפשרית בתרחיש שמרני." });
    }

    const capacityInfo = {};
    if (group_type === "LODGING" && peakPeople) capacityInfo.sleeping = maxSleeping > 0
      ? { max: maxSleeping, held: peakPeople.people.existing, requested: requestedPax, totalAfter: peakPeople.people.projected }
      : { max: 0, held: 0, requested: requestedPax, unconfigured: true };

    if (group_type === "DAY_USE") {
      const reqArr = arrival_date, reqDep = departure_date || arrival_date;
      const held = allHolds.filter(h => h.group_type === "DAY_USE" &&
        !(h.group_id && !isGroupOperationallyEnabled(groupById[h.group_id])) &&
        !(exclude_quote_id && h.quote_id === exclude_quote_id) &&
        !((h.departure_date || h.arrival_date) < reqArr || h.arrival_date > reqDep))
        .reduce((s, h) => s + num(h.total_pax), 0);
      const totalAfter = held + requestedPax;
      capacityInfo.day_use = { max: maxDayUse, held, requested: requestedPax, totalAfter };
      if (maxDayUse > 0 && totalAfter > maxDayUse) warnings.unshift({ type: "DAY_USE_CAPACITY", severity: "WARNING",
        message: `קיבולת יום כיף תעלה על ${maxDayUse} (${totalAfter}/${maxDayUse})`, held, requested: requestedPax, max: maxDayUse });
    }

    const status = warnings.some(w => w.severity === "WARNING") ? "WARNING" : warnings.some(w => w.severity === "NEAR_FULL") ? "NEAR_FULL" : "OK";
    return Response.json({
      warnings, capacityInfo, status, overlappingHoldsCount: relevantHolds.length,
      settings: { maxSleeping, maxDayUse, maxMeal },
      feasibility,
      messages: warnings.map(w => w.message),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}