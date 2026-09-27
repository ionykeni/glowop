// Read-only view of the accepted quote's internal notes. Communication only — no automatic actions.
export default function QuoteInternalNotesBox({ quotes = [], profile }) {
  const linked = profile?.quote_id ? quotes.find(q => q.id === profile.quote_id) : null;
  const quote = linked || quotes.find(q => q.status === "APPROVED");
  const notes = quote?.internal_notes?.trim();
  if (!notes) return null;
  return (
    <section className="bg-amber-50/40 border border-dashed border-amber-300 rounded-xl px-4 py-3">
      <p className="text-xs font-semibold text-amber-800">הערות מהצעת המחיר</p>
      <p className="text-[11px] text-amber-600 mb-1">מידע פנימי שהועבר מצוות הצעות המחיר</p>
      <p className="text-sm text-amber-900 whitespace-pre-wrap">{notes}</p>
    </section>
  );
}