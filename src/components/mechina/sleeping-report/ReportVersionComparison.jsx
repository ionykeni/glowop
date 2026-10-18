export default function ReportVersionComparison({ comparison: c }) {
  if (!c) return <p className="text-xs text-muted-foreground">גרסה ראשונה, אין גרסה קודמת להשוואה.</p>;
  return <section className="rounded-xl border border-border bg-muted/40 p-3 space-y-2 text-sm">
    <h3 className="font-semibold">השוואה לגרסה {c.prev_version_number}</h3>
    <p>סה״כ: {c.prev_total} ← {c.total} · בנים: {c.prev_boys} ← {c.boys} · בנות: {c.prev_girls} ← {c.girls}</p>
    {!c.changed_tents.length && <p className="text-muted-foreground">לא השתנו כמויות או הערות באוהלים.</p>}
    {c.changed_tents.map(t => <div key={t.tent_id} className="border-t border-border pt-2">
      <p className="font-semibold">אוהל {t.tent_code}</p>
      <p>קודם: {t.prev_boys || 0} בנים, {t.prev_girls || 0} בנות · חדש: {t.boys || 0} בנים, {t.girls || 0} בנות</p>
      {t.prev_note !== t.note && <p className="text-xs whitespace-pre-wrap">הערה קודמת: {t.prev_note || "ללא"} · הערה חדשה: {t.note || "ללא"}</p>}
    </div>)}
    {c.notes_changed && <p>ההערות הכלליות השתנו.</p>}
  </section>;
}