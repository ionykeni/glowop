// Compare-and-set lease serializing all preventive-maintenance writers (generation, seeding, completion, correction).
// Same proven pattern as activityDayLock: oldest lock row is canonical; updateMany(...) succeeds for exactly one caller.
// Service-role calls share one rate budget (updateMany is the scarcest), so polling is sparse and release uses update.
const LOCK_KEY = 'PREVENTIVE_MAINTENANCE';
const LEASE_MS = 90 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isThrottled = (e) => (e?.status || e?.response?.status) === 429;

async function lockRow(db) {
  let rows = await db.PreventiveMaintenanceLock.filter({ lock_key: LOCK_KEY }, 'created_date', 5);
  if (!rows.length) {
    await db.PreventiveMaintenanceLock.create({ lock_key: LOCK_KEY });
    rows = await db.PreventiveMaintenanceLock.filter({ lock_key: LOCK_KEY }, 'created_date', 5);
  }
  return rows[0];
}

async function tryAcquire(db, holder) {
  const lock = await lockRow(db);
  const nowIso = new Date().toISOString();
  if (lock.holder_key && !(lock.expires_at && lock.expires_at < nowIso)) return null;
  const query = lock.holder_key
    ? { id: lock.id, holder_key: lock.holder_key, expires_at: lock.expires_at }
    : { id: lock.id, holder_key: null };
  const res = await db.PreventiveMaintenanceLock.updateMany(query, {
    $set: { holder_key: holder, acquired_at: nowIso, expires_at: new Date(Date.now() + LEASE_MS).toISOString() },
  });
  return res?.updated === 1 ? lock.id : null;
}

async function release(db, lockId, holder) {
  const lock = await db.PreventiveMaintenanceLock.get(lockId);
  if (lock.holder_key === holder) await db.PreventiveMaintenanceLock.update(lockId, { holder_key: null, expires_at: null });
}

// Runs fn while holding the lock. Returns { value } or { busy: true } when the lock could not be taken.
export async function withPmLock(db, fn, { attempts = 6, delayMs = 700 } = {}) {
  const holder = crypto.randomUUID();
  let lockId = null;
  for (let i = 0; i < attempts && !lockId; i++) {
    lockId = await tryAcquire(db, holder).catch((e) => (isThrottled(e) ? null : Promise.reject(e)));
    if (!lockId) await sleep(delayMs + Math.floor(Math.random() * 500));
  }
  if (!lockId) return { busy: true };
  try {
    return { value: await fn() };
  } finally {
    await release(db, lockId, holder).catch((e) => console.error('[pmLock] release failed', e?.message));
  }
}