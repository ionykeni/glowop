// Global compare-and-set lease serializing activity-day writers (C1 execution and C2 management).
// Other booking modules do not take this lock (documented limitation).
export const LOCK_KEY = 'GLOBAL';
export const LEASE_MS = 6 * 60 * 1000; // longer than the 5-minute request limit, so a live holder never loses it

export async function acquireLock(db, key) {
  let rows = await db.ActivityDayExecutionLock.filter({ lock_key: LOCK_KEY }, 'created_date', 5);
  if (!rows.length) {
    await db.ActivityDayExecutionLock.create({ lock_key: LOCK_KEY });
    rows = await db.ActivityDayExecutionLock.filter({ lock_key: LOCK_KEY }, 'created_date', 5);
  }
  const lock = rows[0]; // oldest row is the canonical lock for every caller
  const nowIso = new Date().toISOString();
  const held = !!lock.holder_execution_key && !(lock.expires_at && lock.expires_at < nowIso);
  if (held) return null;
  const query = lock.holder_execution_key
    ? { id: lock.id, holder_execution_key: lock.holder_execution_key, expires_at: lock.expires_at }
    : { id: lock.id, holder_execution_key: null };
  const res = await db.ActivityDayExecutionLock.updateMany(query, {
    $set: { holder_execution_key: key, acquired_at: nowIso, expires_at: new Date(Date.now() + LEASE_MS).toISOString() },
  });
  return res?.updated === 1 ? lock.id : null;
}

export const releaseLock = (db, lockId, key) =>
  db.ActivityDayExecutionLock.updateMany({ id: lockId, holder_execution_key: key }, { $unset: { holder_execution_key: '', expires_at: '' } })
    .catch(e => console.error('[activityDayLock] release failed', e?.message));