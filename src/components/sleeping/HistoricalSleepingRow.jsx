const genderLabels = { BOYS: 'בנים', GIRLS: 'בנות', MEN: 'גברים', WOMEN: 'נשים', MIXED: 'מעורב' };
const typeLabels = { STUDENT: 'חניכים', STAFF: 'צוות' };
export default function HistoricalSleepingRow({ row }) {
  return <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
    <strong className="text-slate-800">{row.tent ? `אוהל ${row.tent}` : 'אוהל לא מזוהה'}</strong>
    <span className="text-slate-600">{row.neighborhood || 'שכונה לא מזוהה'}</span>
    <span className="text-slate-700">{row.pax == null ? 'כמות לא ידועה' : `${row.pax} איש`}</span>
    {row.gender && <span className="text-slate-500">{genderLabels[row.gender] || row.gender}</span>}
    {row.type && <span className="text-slate-500">{typeLabels[row.type] || row.type}</span>}
    <span className="text-xs text-slate-500" dir="ltr">{row.start} – {row.end}</span>
  </div>;
}