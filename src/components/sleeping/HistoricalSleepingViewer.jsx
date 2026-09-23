import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { buildHistoricalSleepingSnapshot, historicalDateRange } from '@/lib/historicalSleepingSnapshot';
import HistoricalSleepingRow from './HistoricalSleepingRow';

export default function HistoricalSleepingViewer({ group, periods, allocations, tents, neighborhoods, today, onClose }) {
  const range = useMemo(() => historicalDateRange(group, periods, today), [group, periods, today]);
  const [date, setDate] = useState(range.initial);
  const snapshot = useMemo(() => buildHistoricalSleepingSnapshot({ group, date, periods, allocations, tents, neighborhoods, today }), [group, date, periods, allocations, tents, neighborhoods, today]);
  return <section className="space-y-4 rounded-xl border border-slate-300 bg-white p-4" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-base font-semibold text-slate-800">היסטוריית שיבוץ</h3>
      <Button variant="outline" size="sm" onClick={onClose}>חזרה לשיבוץ הנוכחי</Button>
    </div>
    <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800">תצוגה היסטורית — לקריאה בלבד</p>
    {range.initial ? <label className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
      תאריך היסטורי
      <input type="date" aria-label="תאריך היסטורי" value={date} min={range.min} max={range.max} onChange={e => setDate(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm" />
    </label> : <p className="text-sm text-slate-500">אין עדיין תאריך שהייה היסטורי לצפייה.</p>}
    {range.initial && snapshot.state === 'absent' && <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">הקבוצה לא שהתה במתחם בתאריך זה</p>}
    {range.initial && snapshot.state === 'invalid' && <p className="text-sm text-slate-600">יש לבחור תאריך היסטורי בטווח השהייה.</p>}
    {range.initial && snapshot.state === 'present' && <>
      {snapshot.warnings.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <p className="font-semibold">מידע היסטורי חלקי</p>
        {snapshot.warnings.map(warning => <p key={warning}>{warning}</p>)}
      </div>}
      {snapshot.sections.map(section => section.rows.length > 0 && <div key={section.key} className="space-y-2 rounded-xl border border-slate-200 p-3">
        <h4 className="text-sm font-semibold text-slate-800">{section.label}</h4>
        {section.rows.map(row => <HistoricalSleepingRow key={row.id} row={row} />)}
      </div>)}
      {snapshot.sections.every(section => section.rows.length === 0) && <p className="text-sm text-slate-500">אין שיבוצי אוהלים מתועדים לתאריך זה.</p>}
    </>}
  </section>;
}