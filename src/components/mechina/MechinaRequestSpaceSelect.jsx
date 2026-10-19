export default function MechinaRequestSpaceSelect({ spaces, value, onChange, isBlocked, loading }) {
  const selected = spaces.find(space => space.id === value);
  const reason = space => space.mechina_requests_effective_enabled !== true ? 'חסום לבקשות מכינה חדשות' : space.is_bookable === false ? 'אינו זמין להזמנה כללית' : isBlocked(space.id) ? 'לא זמין בזמן שנבחר עקב חסימה זמנית' : '';
  return <div className="space-y-1">
    <label className="text-sm font-medium">מרחב *</label>
    <select value={value} disabled={loading} onChange={event => onChange(event.target.value)} required className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm">
      <option value="">{loading ? 'טוען זמינות...' : 'בחר מרחב...'}</option>
      {spaces.map(space => <option key={space.id} value={space.id} disabled={!!reason(space)}>{space.name}{space.capacity ? ` (${space.capacity} איש)` : ''}{reason(space) ? ` — ${reason(space)}` : ''}</option>)}
    </select>
    {selected && reason(selected) && <p role="alert" className="text-sm text-destructive">{reason(selected)}. לא ניתן לשלוח בקשה למרחב זה.</p>}
    <p className="text-xs text-muted-foreground">מרחב המסומן כחסום לבקשות מכינה אינו מקבל בקשות חדשות. להפעלה יש לפנות למנהל המערכת.</p>
  </div>;
}