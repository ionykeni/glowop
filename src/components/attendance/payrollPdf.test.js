import test from 'node:test';
import assert from 'node:assert/strict';
import { payrollPrintHtml, printPayrollHours } from './printPayrollHours.js';

const summary = { worked_days: 1, pending_count: 1, hours: { verified: 3600000, active: 0, pending: 0, unverified: 0 },
  legal: { regular: 0, overtime125: 0, overtime150: 0, weekly_rest: 0, holiday: 0, unresolved: 3600000 } };
const worker = { ...summary, full_name: 'עובד <בדיקה>', review_weeks: [{ week: '2026-11-08', reasons: ['ARRANGEMENT'] }],
  days: [{ date: '2026-11-08', hours: summary.hours, rows: [{ kind: 'verified', start_at: '2026-11-08T06:00:00Z', end_at: '2026-11-08T07:00:00Z', session_ms: 3600000, counted_ms: 3600000 }] }],
  pending: [{ date: '2026-11-08', type: 'ADD', start_at: null, end_at: null, status: 'PENDING' }] };
const report = { workers: [worker], worker_id: 'worker1', team: summary, generated_at: '2026-11-29T08:00:00Z' };

test('single-worker PDF markup is escaped, right-to-left Hebrew, A4, and repeats table headers', () => {
  const html = payrollPrintHtml(report, 'נובמבר 2026');
  assert.match(html, /<html lang="he" dir="rtl">/);
  assert.match(html, /@page\s*\{\s*size: A4 portrait/);
  assert.match(html, /thead \{ display: table-header-group; \}/);
  assert.match(html, /<bdi dir="ltr">01:00:00<\/bdi>/);
  assert.match(html, /עובד &lt;בדיקה&gt;/);
  assert.doesNotMatch(html, /<בדיקה>/);
  for (const name of ['נדרש בירור', 'רשומות יומיות', 'כניסה בפועל', 'יציאה בפועל', 'סה״כ ליום', 'לא דוח סופי לשכר', 'בקשות תיקון ממתינות']) assert.ok(html.includes(name), name);
  assert.doesNotMatch(html, /סיכום חודשי לכל העובדים/);
});

test('all-workers PDF opens a print-only document and starts a new page per worker', async () => {
  const all = { ...report, worker_id: null, workers: [worker, { ...worker, full_name: 'עובדת נוספת' }] };
  let printed = false, written;
  const popup = { opener: {}, focus() {}, print() { printed = true; }, document: { open() {}, write(html) { written = html; }, close() {}, fonts: { ready: Promise.resolve() } } };
  globalThis.window = { open: () => popup };
  try {
    assert.equal(printPayrollHours(all, 'נובמבר 2026'), true);
    await popup.document.fonts.ready;
    assert.equal(printed, true);
    assert.equal(popup.opener, null);
    assert.match(written, /סיכום חודשי לכל העובדים/);
    assert.match(written, /class="next-worker"><h2>עובדת נוספת/);
    assert.match(written, /\.next-worker \{ break-before: page; \}/);
    window.open = () => null;
    assert.equal(printPayrollHours(all, 'נובמבר 2026'), false);
  } finally { delete globalThis.window; }
});