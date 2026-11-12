// A4 PDF documents for planned Tiful shifts. jsPDF constructor and fonts are injected (Deno function / node tests).
// Every Hebrew string is drawn through toVisual() and right-aligned; cells never mix Latin words with Hebrew.
import { toVisual } from './hebrewPdfText.js';
import { addDays, weekStartOf, dayNameOf, fmtMinutes, fmtDate, localDateOf, localTimeOf } from './workScheduleReport.js';

const BRAND = 'Hador Haba / Glow Glamping';
const M = 12;
const NOTE = 'המסמך מציג משמרות מתוכננות בלבד. אינו דוח נוכחות בפועל ואינו מסמך שכר.';
const DRAFT_LABEL = 'טיוטה – לא פורסם';

export function createDoc(JsPDF, fonts, orientation) {
  const doc = new JsPDF({ orientation, unit: 'mm', format: 'a4' });
  doc.addFileToVFS('Alef-Regular.ttf', fonts.regular);
  doc.addFont('Alef-Regular.ttf', 'Alef', 'normal');
  doc.addFileToVFS('Alef-Bold.ttf', fonts.bold);
  doc.addFont('Alef-Bold.ttf', 'Alef', 'bold');
  doc.setFont('Alef', 'normal');
  return doc;
}

const W = (doc) => doc.internal.pageSize.getWidth();
const H = (doc) => doc.internal.pageSize.getHeight();
const font = (doc, size, bold = false) => { doc.setFont('Alef', bold ? 'bold' : 'normal'); doc.setFontSize(size); };
const rtl = (doc, text, xRight, y) => doc.text(toVisual(text), xRight, y, { align: 'right' });

// Word wrap on the logical string, then each line is converted to visual order.
export function wrap(doc, text, maxW) {
  const lines = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && doc.getTextWidth(toVisual(next)) > maxW) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

const generatedLabel = (iso) => { const ms = Date.parse(iso); return `${fmtDate(localDateOf(ms))} ${localTimeOf(ms)}`; };

function pageHeader(doc, title) {
  font(doc, 9, true); doc.setTextColor(30, 64, 175);
  doc.text(BRAND, M, M + 2);
  font(doc, 13, true); doc.setTextColor(23, 32, 51);
  rtl(doc, title, W(doc) - M, M + 3);
  doc.setDrawColor(29, 78, 216); doc.setLineWidth(0.5);
  doc.line(M, M + 6, W(doc) - M, M + 6);
  doc.setLineWidth(0.2);
  return M + 12;
}

function footers(doc, report) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); font(doc, 7.5); doc.setTextColor(100, 116, 139);
    rtl(doc, `הופק ${generatedLabel(report.generated_at)} (שעון ישראל) · עמוד ${i} מתוך ${n}`, W(doc) - M, H(doc) - 6);
    doc.text(BRAND, M, H(doc) - 6);
  }
  doc.setTextColor(0, 0, 0);
}

function infoBlock(doc, y, lines, notes) {
  font(doc, 10);
  for (const l of lines) { rtl(doc, l, W(doc) - M, y); y += 5.5; }
  font(doc, 8.5); doc.setFillColor(255, 247, 237); doc.setDrawColor(254, 215, 170);
  const noteLines = notes.flatMap((n) => wrap(doc, n, W(doc) - 2 * M - 6));
  doc.roundedRect(M, y - 2, W(doc) - 2 * M, noteLines.length * 4.4 + 3, 1.5, 1.5, 'FD');
  doc.setTextColor(124, 45, 18);
  for (const l of noteLines) { rtl(doc, l, W(doc) - M - 3, y + 2.2); y += 4.4; }
  doc.setTextColor(0, 0, 0);
  return y + 6;
}

// columns: [{ label, w }] laid out from the right edge.
function drawRow(doc, y, cols, cells, h, { header = false, fill = null } = {}) {
  let x = W(doc) - M;
  cols.forEach((c, i) => {
    if (fill) { doc.setFillColor(...fill); doc.rect(x - c.w, y, c.w, h, 'F'); }
    doc.setDrawColor(203, 213, 225); doc.rect(x - c.w, y, c.w, h);
    const lines = Array.isArray(cells[i]) ? cells[i] : [cells[i]];
    lines.forEach((ln, k) => {
      const t = typeof ln === 'object' ? ln : { text: ln };
      font(doc, t.size || (header ? 8 : 8.5), header || t.bold);
      if (t.color) doc.setTextColor(...t.color);
      rtl(doc, t.text ?? '', x - 1.5, y + 4.2 + k * 3.7);
      doc.setTextColor(0, 0, 0);
    });
    x -= c.w;
  });
}

function shiftHours(it) {
  if (it.is_on_call) return 'כוננות';
  if (it.invalid_times) return 'לא תקין';
  return it.period_minutes !== it.minutes ? `${fmtMinutes(it.period_minutes)}*` : fmtMinutes(it.minutes);
}

const rangeLabel = (report) => `${fmtDate(report.period.start)} – ${fmtDate(report.period.end)}`;

export function buildWorkerPdf(JsPDF, fonts, report, worker, { includeDrafts = false } = {}) {
  const doc = createDoc(JsPDF, fonts, 'portrait');
  const title = 'סידור עבודה אישי – משמרות מתוכננות';
  const items = worker.items.filter((it) => includeDrafts || it.status === 'published');
  let y = pageHeader(doc, title);
  const notes = [NOTE];
  if (includeDrafts) notes.push('תצוגה מקדימה למנהל: כולל משמרות בסידור שטרם פורסם, מסומנות "טיוטה – לא פורסם".');
  if (items.some((it) => it.period_minutes !== it.minutes)) notes.push('* משמרת שחלקה מחוץ לטווח: נספר רק החלק שבתוך הטווח.');
  y = infoBlock(doc, y, [`עובד/ת: ${worker.worker_name}`, `טווח: ${rangeLabel(report)}`, `הופק: ${generatedLabel(report.generated_at)} (שעון ישראל)`], notes);

  const cols = [{ w: 24 }, { w: 16 }, { w: 46 }, { w: 18 }, { w: 22 }, { w: 24 }, { w: 36 }];
  const head = ['תאריך', 'יום', 'משמרת', 'התחלה', 'סיום', 'שעות מתוכננות', 'סטטוס'];
  const header = () => { drawRow(doc, y, cols, head, 7, { header: true, fill: [239, 246, 255] }); y += 7; };
  header();
  if (!items.length) { font(doc, 9); rtl(doc, 'אין משמרות בטווח שנבחר.', W(doc) - M - 2, y + 6); y += 10; }
  for (const it of items) {
    if (y + 7 > H(doc) - 16) { doc.addPage(); y = pageHeader(doc, title); header(); }
    const status = it.status === 'draft' ? { text: DRAFT_LABEL, color: [180, 83, 9], bold: true } : 'פורסם';
    const label = it.is_on_call ? { text: 'כונן לילה', bold: true, color: [14, 116, 144] } : it.row_label;
    const endTxt = it.end_time ? (it.overnight ? `${it.end_time} (+1)` : it.end_time) : '—';
    drawRow(doc, y, cols, [fmtDate(it.date), it.weekday, label, it.start_time || '—', endTxt, shiftHours(it), status], 7, { fill: it.is_on_call ? [236, 254, 255] : it.status === 'draft' ? [255, 251, 235] : null });
    y += 7;
  }

  const sum = [
    `סה״כ שעות מתוכננות שפורסמו: ${fmtMinutes(worker.published.planned_minutes)}`,
    `מספר משמרות שפורסמו: ${worker.published.shift_count}`,
    `משמרות כונן לילה שפורסמו: ${worker.published.on_call_count} (אינן נכללות בשעות)`,
  ];
  if (worker.published.overlap_minutes) sum.push(`חפיפה בין משמרות: ${fmtMinutes(worker.published.overlap_minutes)} – נספרה פעם אחת`);
  if (includeDrafts) sum.push(`שעות מתוכננות בטיוטה (לא פורסם): ${fmtMinutes(worker.draft.planned_minutes)} · משמרות: ${worker.draft.shift_count} · כונן לילה: ${worker.draft.on_call_count}`);
  if (y + sum.length * 5.5 + 8 > H(doc) - 16) { doc.addPage(); y = pageHeader(doc, title); }
  y += 6; font(doc, 11, true); rtl(doc, 'סיכום', W(doc) - M, y); y += 6;
  font(doc, 10);
  for (const l of sum) { rtl(doc, l, W(doc) - M, y); y += 5.5; }
  footers(doc, report);
  return doc;
}

function weekCellLines(items, includeDrafts) {
  const lines = [];
  for (const it of items) {
    if (!includeDrafts && it.status !== 'published') continue;
    const prefix = it.status === 'draft' ? 'טיוטה: ' : '';
    lines.push({ text: prefix + (it.is_on_call ? 'כונן לילה' : it.row_label), bold: true, size: 7, color: it.status === 'draft' ? [180, 83, 9] : it.is_on_call ? [14, 116, 144] : null });
    if (!it.is_on_call || it.start_time) lines.push({ text: it.start_time ? `${it.start_time}–${it.end_time}` : 'ללא שעות', size: 7 });
  }
  return lines;
}

export function buildTeamPdf(JsPDF, fonts, report, { includeDrafts = false } = {}) {
  const doc = createDoc(JsPDF, fonts, 'landscape');
  const title = 'סידור עבודה – צוות תפעול – משמרות מתוכננות';
  let y = pageHeader(doc, title);
  const notes = [NOTE];
  if (includeDrafts) notes.push('תצוגה מקדימה למנהל: כולל משמרות בסידור שטרם פורסם, מסומנות "טיוטה".');
  const unpublished = report.unpublished_weeks.map((w) => `${fmtDate(w.week_start)} (${w.status === 'DRAFT' ? 'טיוטה' : 'אין סידור'})`);
  if (unpublished.length) notes.push(`שבועות שלא פורסמו בטווח: ${unpublished.join(', ')}`);
  y = infoBlock(doc, y, [`טווח: ${rangeLabel(report)}`, `עובדים: ${report.workers.length}`], notes);

  const nameW = 34, totalW = 24, dayW = (W(doc) - 2 * M - nameW - totalW) / 7;
  const cols = [{ w: nameW }, ...Array.from({ length: 7 }, () => ({ w: dayW })), { w: totalW }];
  for (let wk = weekStartOf(report.period.start); wk <= report.period.end; wk = addDays(wk, 7)) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(wk, i));
    const weekTitle = `שבוע ${fmtDate(wk)} – ${fmtDate(addDays(wk, 6))}`;
    const head = ['עובד/ת', ...days.map((d) => [`${dayNameOf(d)}`, d.slice(8, 10) + '/' + d.slice(5, 7)]), 'סה״כ שבוע'];
    const drawHead = (cont) => {
      font(doc, 10, true); rtl(doc, cont ? `${weekTitle} (המשך)` : weekTitle, W(doc) - M, y + 4); y += 6;
      drawRow(doc, y, cols, head, 9, { header: true, fill: [239, 246, 255] }); y += 9;
    };
    if (y + 30 > H(doc) - 14) { doc.addPage(); y = pageHeader(doc, title); }
    drawHead(false);
    const rows = report.workers.filter((w) => w.items.some((it) => days.includes(it.date) && (includeDrafts || it.status === 'published')));
    if (!rows.length) { font(doc, 8.5); rtl(doc, 'אין משמרות בשבוע זה.', W(doc) - M - 2, y + 5); y += 9; }
    for (const w of rows) {
      const wkTotals = w.weeks.find((x) => x.week_start === wk) || { published_minutes: 0, draft_minutes: 0 };
      const cells = [[{ text: w.worker_name, bold: true }], ...days.map((d) => (d < report.period.start || d > report.period.end) ? [] : weekCellLines(w.items.filter((it) => it.date === d), includeDrafts))];
      const total = [fmtMinutes(wkTotals.published_minutes)];
      if (includeDrafts && wkTotals.draft_minutes) total.push({ text: `טיוטה ${fmtMinutes(wkTotals.draft_minutes)}`, size: 7, color: [180, 83, 9] });
      cells.push(total);
      const h = Math.max(8, Math.max(...cells.map((c) => c.length)) * 3.7 + 2.5);
      if (y + h > H(doc) - 14) { doc.addPage(); y = pageHeader(doc, title); drawHead(true); }
      drawRow(doc, y, cols, cells, h);
      days.forEach((d, i) => {
        if (d >= report.period.start && d <= report.period.end) return;
        const x = W(doc) - M - nameW - (i + 1) * dayW;
        doc.setFillColor(241, 245, 249); doc.rect(x, y, dayW, h, 'F'); doc.rect(x, y, dayW, h);
      });
      y += h;
    }
    y += 5;
  }

  // Period summary table
  const sCols = [{ w: 50 }, { w: 30 }, { w: 40 }, { w: 40 }, { w: 30 }, { w: 34 }];
  const sHead = ['עובד/ת', 'משמרות שפורסמו', 'שעות מתוכננות (פורסם)', includeDrafts ? 'שעות בטיוטה' : 'שבועות לא פורסמו', 'כונן לילה', 'חפיפות (נספרו פעם אחת)'];
  const drawSHead = () => { font(doc, 11, true); rtl(doc, 'סיכום לתקופה', W(doc) - M, y + 4); y += 6; drawRow(doc, y, sCols, sHead, 7, { header: true, fill: [239, 246, 255] }); y += 7; };
  if (y + 30 > H(doc) - 14) { doc.addPage(); y = pageHeader(doc, title); }
  drawSHead();
  const sRow = (name, b, d, bold) => {
    if (y + 7 > H(doc) - 14) { doc.addPage(); y = pageHeader(doc, title); drawSHead(); }
    drawRow(doc, y, sCols, [{ text: name, bold }, String(b.shift_count), fmtMinutes(b.planned_minutes), includeDrafts ? fmtMinutes(d.planned_minutes) : String(report.unpublished_weeks.length), String(b.on_call_count + (includeDrafts ? d.on_call_count : 0)), b.overlap_minutes ? fmtMinutes(b.overlap_minutes) : '—'], 7, { fill: bold ? [248, 250, 252] : null });
    y += 7;
  };
  for (const w of report.workers) sRow(w.worker_name, w.published, w.draft, false);
  sRow('סה״כ צוות', report.team.published, report.team.draft, true);

  if (report.warnings.length) {
    y += 6;
    if (y + 12 > H(doc) - 14) { doc.addPage(); y = pageHeader(doc, title); }
    font(doc, 11, true); rtl(doc, `אזהרות (${report.warnings.length})`, W(doc) - M, y); y += 6;
    font(doc, 8.5);
    for (const wn of report.warnings) {
      for (const l of wrap(doc, `${wn.date ? fmtDate(wn.date) + ' · ' : ''}${wn.worker_name ? wn.worker_name + ' · ' : ''}${wn.message}`, W(doc) - 2 * M)) {
        if (y + 5 > H(doc) - 14) { doc.addPage(); y = pageHeader(doc, title); font(doc, 8.5); }
        rtl(doc, l, W(doc) - M, y); y += 4.5;
      }
    }
  }
  footers(doc, report);
  return doc;
}