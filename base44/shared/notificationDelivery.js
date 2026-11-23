// An adapter stores/submits one event and returns an outcome. SENT is not a device receipt.
export const inAppAdapter = {
  channel: 'IN_APP',
  async deliver(db, { event, stored, now }) {
    const row = stored || await db.AttendanceNotification.create({ ...event, status: 'unread', created_at: now });
    return { status: 'STORED', notification_id: row.id };
  },
};

// Not registered with the dispatcher in Phase 1. No outbound requests or subscriptions.
export const webPushAdapter = {
  channel: 'WEB_PUSH',
  async deliver() { return { status: 'SKIPPED', error: 'WEB_PUSH_DISABLED' }; },
};

const byKey = (items) => new Map(items.map((r) => [r.event_key, r]));

export async function dispatchInApp(db, events, now) {
  const journal = db.AttendanceNotificationDelivery;
  const notifications = db.AttendanceNotification;
  const channel = inAppAdapter.channel;
  const unfinished = await journal.filter({ channel, status: 'ATTEMPTED' }, 'attempted_at', 250);
  const interrupted = byKey(unfinished);
  const due = byKey(events);
  const keys = [...new Set([...due.keys(), ...interrupted.keys()])];
  let stored = 0, failed = 0;
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100);
    const existing = byKey(await notifications.filter({ event_key: { $in: batch } }, 'created_at', 100));
    for (let j = 0; j < batch.length; j += 4) {
      const results = await Promise.allSettled(batch.slice(j, j + 4).map(async (key) => {
        const previous = interrupted.get(key);
        const row = existing.get(key);
        const event = due.get(key);
        if (row && !previous) return false;
        if (previous) await journal.update(previous.id, {
          status: row ? 'STORED' : 'FAILED', ...(row ? { notification_id: row.id } : { error: 'INTERRUPTED_BEFORE_STORAGE' }), finished_at: now,
        });
        if (row || !event) return false;
        const attempt = await journal.create({ channel, event_key: key, status: 'ATTEMPTED', attempted_at: now });
        let outcome;
        try { outcome = await inAppAdapter.deliver(db, { event, now }); }
        catch (err) {
          // A write error may be ambiguous. Leave it ATTEMPTED so the next run checks for the row first.
          await journal.update(attempt.id, { error: String(err?.status || err?.response?.status || 'STORAGE_UNCONFIRMED') });
          throw err;
        }
        await journal.update(attempt.id, { ...outcome, finished_at: now });
        return true;
      }));
      for (const result of results) {
        if (result.status === 'rejected') {
          failed++;
          console.error('[attendance notifications] persistence failed', result.reason?.status || result.reason?.response?.status || 'STORAGE_ERROR');
          if ((result.reason?.status || result.reason?.response?.status) === 429) return { stored, failed, throttled: true };
        } else if (result.value) stored++;
      }
    }
  }
  return { stored, failed };
}