import { todayIL } from './stayReconciliationCore.js';
import { RELEASE_SPEC, findLiveCommitments, releaseRow } from './quoteCancellationRelease.js';

// Group-level write fence shared by every operational writer and the Quote cancellation engine.
// Store-then-load on both sides (no status-only check):
//  - Cancellation: CAS lock on Group -> release -> verified sweeps -> status CANCELLED -> final sweep.
//  - Writer (this guard): precheck (reject if locked/cancelled) -> write -> re-read Group.
//    Lock visible -> wait for the outcome; CANCELLED -> release the Group's live commitments and fail.
// Either the writer's re-read sees the lock, or the cancellation's sweeps (run after the lock) see the write.
// Releases (status CANCELLED/RELEASED/REJECTED) and deletes are never blocked.
export const GROUP_FIELD = {
  MealReservation: 'group_id', SleepingAllocation: 'group_id', NeighborhoodReservation: 'group_id',
  GroupScheduleItem: 'group_id', CoffeeCornerRequest: 'group_id', PrisaRequest: 'group_id',
  OperationalHold: 'group_id', GroupStayPeriod: 'group_id', CommonSpaceBookingRequest: 'mechina_group_id',
};
export const GROUP_WRITE_MESSAGES = {
  GROUP_CANCELLED: 'הקבוצה בוטלה. לא ניתן להוסיף או לשנות שיבוצים, ארוחות או פעילויות.',
  GROUP_CANCELLATION_IN_PROGRESS: 'הקבוצה נמצאת בתהליך ביטול. לא ניתן לבצע שינויים כעת.',
  GROUP_NOT_FOUND: 'הקבוצה לא נמצאה. לא ניתן לשמור את הרשומה.',
};
export class GroupWriteBlocked extends Error {
  constructor(code, groupId) { super(GROUP_WRITE_MESSAGES[code]); this.code = code; this.status = 409; this.group_id = groupId; }
}

const RELEASE_STATUSES = new Set(['CANCELLED', 'RELEASED', 'REJECTED']);
const WRITES = new Set(['create', 'bulkCreate', 'update', 'bulkUpdate', 'updateMany']);
const READS = new Set(['filter', 'list', 'get']);
const POLL_MS = 1500, POLL_ROUNDS = 12;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isRelease = data => !!data && RELEASE_STATUSES.has(data.status);
const setPart = upd => upd?.$set || {};
const groupSensitive = (data, unset = {}) => !!data && ('cancellation_operation_id' in data || 'cancellation_operation_id' in unset
  || (data.status !== undefined && data.status !== 'CANCELLED') || data.operationally_active === true);
const blockedState = g => !g ? 'GROUP_NOT_FOUND' : g.status === 'CANCELLED' ? 'GROUP_CANCELLED' : g.cancellation_operation_id ? 'GROUP_CANCELLATION_IN_PROGRESS' : null;

export async function readAll(entity, query) {
  const rows = [];
  for (let skip = 0; ; skip += 500) { const page = await entity.filter(query, 'id', 500, skip); rows.push(...page); if (page.length < 500) return rows; }
}
// Plain-object proxies (empty targets) so SDK property invariants never apply.
const passthrough = (target, overrides) => new Proxy({}, {
  get(_, p) { if (p in overrides) return overrides[p](); const v = target[p]; return typeof v === 'function' ? v.bind(target) : v; },
});

export function guardOperationalClient(client) {
  const raw = () => client.asServiceRole.entities;
  const verdict = new Map(); const rowGroup = new Map(); const released = new Set();
  // A lookup that fails (e.g. malformed id) is treated as a missing Group: the write is rejected.
  const readGroup = async gid => (await raw().Group.filter({ id: gid }).catch(() => []))[0] || null;

  const remember = (name, field, res) => {
    if (!field || !res) return;
    const rows = Array.isArray(res) ? res : Array.isArray(res.items) ? res.items : [res];
    for (const r of rows) if (r?.id && r[field]) rowGroup.set(`${name}:${r.id}`, r[field]);
  };
  async function existingGroups(name, field, ids) {
    const missing = ids.filter(id => !rowGroup.has(`${name}:${id}`));
    if (missing.length) remember(name, field, await raw()[name].filter({ id: { $in: missing } }));
    return ids.map(id => rowGroup.get(`${name}:${id}`));
  }
  async function groupsFor(name, field, method, args) {
    if (name === 'Group') {
      if (method === 'update') return groupSensitive(args[1]) ? [args[0]] : [];
      if (method === 'updateMany' && groupSensitive(setPart(args[1]), args[1]?.$unset)) {
        return typeof args[0]?.id === 'string' ? [args[0].id] : (await raw().Group.filter(args[0])).map(g => g.id);
      }
      return [];
    }
    if (method === 'create') return [args[0]?.[field]];
    if (method === 'bulkCreate') return (args[0] || []).map(d => d?.[field]);
    if (method === 'update') return isRelease(args[1]) ? [] : [args[1]?.[field], ...await existingGroups(name, field, [args[0]])];
    if (method === 'bulkUpdate') {
      const items = (args[0] || []).filter(i => !isRelease(i));
      return [...items.map(i => i[field]), ...await existingGroups(name, field, items.map(i => i.id))];
    }
    const set = setPart(args[1]);
    if (isRelease(set)) return [];
    const q = args[0] || {};
    return [set[field], ...(typeof q[field] === 'string' ? [q[field]] : (await raw()[name].filter(q)).map(r => r[field]))];
  }
  async function precheck(gids) {
    for (const gid of gids) {
      const known = verdict.get(gid);
      if (known === 'OK') continue;
      if (known) throw new GroupWriteBlocked(known, gid);
      const state = blockedState(await readGroup(gid));
      verdict.set(gid, state || 'OK');
      if (state) throw new GroupWriteBlocked(state, gid);
    }
  }
  async function releaseGroup(gid) {
    if (released.has(gid)) return; released.add(gid);
    const db = raw(); const live = await findLiveCommitments(db, gid, todayIL(), readAll);
    for (const spec of RELEASE_SPEC) for (const row of live[spec.key]) await releaseRow(db, spec, row);
  }
  async function postcheck(gids) {
    for (const gid of gids) {
      let g = await readGroup(gid);
      for (let i = 0; i < POLL_ROUNDS && blockedState(g) === 'GROUP_CANCELLATION_IN_PROGRESS'; i++) { await sleep(POLL_MS); g = await readGroup(gid); }
      const state = blockedState(g);
      if (!state) continue;
      if (state === 'GROUP_CANCELLED') await releaseGroup(gid);
      verdict.set(gid, state);
      throw new GroupWriteBlocked(state, gid);
    }
  }
  const handlers = new Map();
  const wrapHandler = (name, handler) => {
    const field = GROUP_FIELD[name];
    return new Proxy({}, { get(_, method) {
      const fn = handler[method];
      if (typeof fn !== 'function') return fn;
      if (READS.has(method)) return async (...args) => { const res = await fn.apply(handler, args); remember(name, field, res); return res; };
      if (!WRITES.has(method)) return fn.bind(handler);
      return async (...args) => {
        const gids = [...new Set((await groupsFor(name, field, method, args)).filter(Boolean))];
        if (!gids.length) return fn.apply(handler, args);
        await precheck(gids);
        const res = await fn.apply(handler, args);
        remember(name, field, res);
        await postcheck(gids);
        return res;
      };
    } });
  };
  const wrapEntities = ents => new Proxy({}, { get(_, name) {
    const h = ents[name];
    if (typeof name !== 'string' || !h || !(GROUP_FIELD[name] || name === 'Group')) return h;
    if (!handlers.has(h)) handlers.set(h, wrapHandler(name, h));
    return handlers.get(h);
  } });
  const sr = passthrough(client.asServiceRole, { entities: () => wrapEntities(client.asServiceRole.entities) });
  return passthrough(client, { asServiceRole: () => sr, entities: () => wrapEntities(client.entities) });
}