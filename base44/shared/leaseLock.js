// Generic compare-and-set lease lock (same proven pattern as preventiveMaintenanceLock):
// the oldest row for a key is canonical, and a conditional updateMany succeeds for exactly one caller.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isThrottled = (e) => (e?.status || e?.response?.status) === 429;

async function lockRow(entity, lockKey) {
  let rows = await entity.filter({ lock_key: lockKey }, 'created_date', 5);
  if (!rows.length) {
    await entity.create({ lock_key: lockKey });
    rows = await entity.filter({ lock_key: lockKey }, 'created_date', 5);
  }
  return rows[0];
}

async function tryAcquire(entity, lockKey, holder, leaseMs) {
  const lock = await lockRow(entity, lockKey);
  const nowIso = new Date().toISOString();
  if (lock.holder_key && !(lock.expires_at && lock.expires_at < nowIso)) return null;
  const query = lock.holder_key
    ? { id: lock.id, holder_key: lock.holder_key, expires_at: lock.expires_at }
    : { id: lock.id, holder_key: null };
  const res = await entity.updateMany(query, {
    $set: { holder_key: holder, acquired_at: nowIso, expires_at: new Date(Date.now() + leaseMs).toISOString() },
  });
  return res?.updated === 1 ? lock.id : null;
}

// Runs fn while holding the lock. Returns { value } or { busy: true } when the lock could not be taken.
export async function withLeaseLock(db, entityName, lockKey, fn, { leaseMs = 60000, attempts = 6, delayMs = 400 } = {}) {
  const entity = db[entityName];
  const holder = crypto.randomUUID();
  let lockId = null;
  for (let i = 0; i < attempts && !lockId; i++) {
    lockId = await tryAcquire(entity, lockKey, holder, leaseMs).catch((e) => (isThrottled(e) ? null : Promise.reject(e)));
    if (!lockId) await sleep(delayMs + Math.floor(Math.random() * delayMs));
  }
  if (!lockId) return { busy: true };
  try {
    return { value: await fn() };
  } finally {
    const lock = await entity.get(lockId).catch(() => null);
    if (lock?.holder_key === holder) await entity.update(lockId, { holder_key: null, expires_at: null }).catch((e) => console.error('[leaseLock] release failed', e?.message));
  }
}