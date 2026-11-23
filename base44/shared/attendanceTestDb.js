// Test-only in-memory datastore for attendance tests (isolated, SIMULATED identities; never touches real records).
import { attendanceAccess } from "./attendancePolicy.js";

const tick = () => new Promise((r) => setImmediate(r));
let stamp = 0;
export function entity(rows = [], { readOnly = false, name = "" } = {}) {
  let seq = 0;
  const cond = (val, c) => {
    if (c && typeof c === "object" && !Array.isArray(c)) {
      return Object.entries(c).every(([op, v]) => ({ $in: () => v.includes(val), $gte: () => val >= v, $gt: () => val > v, $lte: () => val <= v, $lt: () => val < v })[op]());
    }
    return (val ?? null) === c;
  };
  const match = (r, q) => Object.entries(q).every(([k, c]) => cond(r[k], c));
  const guard = () => { if (readOnly) throw new Error(`write attempted on ${name}`); };
  return {
    rows,
    get: async (id) => { await tick(); const r = rows.find((x) => x.id === id); if (!r) throw Object.assign(new Error("nf"), { status: 404 }); return { ...r }; },
    filter: async (q, sort, limit = 1000) => {
      await tick();
      const desc = sort?.startsWith("-"), key = sort?.replace(/^-/, "");
      return rows.filter((r) => match(r, q)).sort((a, b) => (key ? String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * (desc ? -1 : 1) : 0)).slice(0, limit).map((r) => ({ ...r }));
    },
    create: async (d) => { guard(); await tick(); const r = { id: `${name}${++seq}`, created_date: String(++stamp).padStart(8, "0"), ...d }; rows.push(r); return { ...r }; },
    update: async (id, d) => { guard(); await tick(); const r = rows.find((x) => x.id === id); Object.assign(r, d); return { ...r }; },
    updateMany: async (q, { $set }) => { guard(); await tick(); const hits = rows.filter((r) => match(r, q)); hits.forEach((r) => Object.assign(r, $set)); return { updated: hits.length }; },
  };
}

export const W1 = { id: "worker1", full_name: "עובד בדיקה א", is_active: true };
export const W2 = { id: "worker2", full_name: "עובד בדיקה ב", is_active: true };
export const makeDb = (extra = {}) => ({
  AttendanceRecord: entity([], { name: "rec" }), AttendanceCorrection: entity([], { name: "cor" }), AttendanceLock: entity([], { name: "lock" }),
  AttendanceCorrectionRequest: entity([], { name: "req" }),
  WorkerProfile: entity([W1, W2], { readOnly: true, name: "WorkerProfile" }),
  WorkShift: entity(extra.shifts || [], { readOnly: true, name: "WorkShift" }),
  WorkSchedule: entity(extra.schedules || [], { readOnly: true, name: "WorkSchedule" }),
});
export const callerOf = (role, profile, id) => ({ role, profile, access: attendanceAccess(role, profile), internalUser: { id }, actorName: profile?.full_name || "מנהל" });
export const rid = () => crypto.randomUUID();
export const at = (iso) => new Date(iso);
export const T0 = "2026-11-23T06:00:00.000Z"; // 08:00 Israel (UTC+2)