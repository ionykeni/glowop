import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import RoleGate from '@/components/RoleGate';
const fmt = d => d?.slice(8,10) + '/' + d?.slice(5,7);
export default function PendingSleepingDecision({ groupId, periods, selectedPeriod, onSelect, onSaved }) {
  const [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const target = selectedPeriod && periods.some(p => p.id === selectedPeriod.id) ? selectedPeriod : periods[0];
  if (!target) return null;
  const call = async action => {
    setBusy(true); setError('');
    try {
      const { data } = await base44.functions.invoke('manageScopedSleepingRelease', { action, group_id: groupId, selected_period_id: target.id, ...(action === 'RETURN_COMMIT' ? { proposal_keys: preview.proposal_keys } : {}) });
      if (!data?.success) throw new Error(data?.error || 'לא ניתן להשלים את השיבוץ');
      if (action === 'RETURN_PREVIEW') setPreview(data);
      else { setPreview(null); await onSaved(); }
    } catch (e) { setError(e?.response?.data?.error || e.message); if (action === 'RETURN_COMMIT') setPreview(null); }
    finally { setBusy(false); }
  };
  return <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3 text-sm text-amber-900">
    <strong>לינה ממתינה לשיבוץ · {fmt(target.start_date)}–{fmt(target.end_date)}</strong>
    <p className="text-xs">תקופת השהייה השתנתה ועדיין אין שיבוץ לינה מאושר לכל התקופה. השיבוצים ההיסטוריים נשמרו.</p>
    {periods.length > 1 && <select className="rounded border border-amber-300 bg-card p-1 text-xs" value={target.id} onChange={e => { onSelect(e.target.value); setPreview(null); }}>{periods.map(p => <option key={p.id} value={p.id}>{fmt(p.start_date)}–{fmt(p.end_date)}</option>)}</select>}
    <RoleGate permission="MANAGE_ALLOCATION"><div className="flex gap-2 flex-wrap">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => { onSelect(target.id); setPreview(null); call('RETURN_PREVIEW'); }}>חזרה לאותם אוהלים</Button>
      <Button size="sm" variant="outline" onClick={() => { onSelect(target.id); setPreview(null); document.getElementById('sleeping-manual-add')?.scrollIntoView(); }}>שיבוץ מחדש — הוסף אוהל</Button>
    </div></RoleGate>
    {busy && <p className="text-xs">בודק זמינות ושיבוץ…</p>}{error && <p className="text-xs text-red-700">{error}</p>}
    {preview && <div className="rounded border border-amber-300 bg-card p-3 space-y-2"><strong>חזרה לשיבוץ הקודם · {fmt(preview.source_period.start_date)}–{fmt(preview.source_period.end_date)}</strong><p className="text-xs">תקופה חדשה: {fmt(preview.target_period.start_date)}–{fmt(preview.target_period.end_date)}</p>
      {preview.creates.map((r,i) => <p key={i} className="text-xs">אוהל {r.tent_code || r.tent_id} — {r.allocated_pax} · {r.allocation_type === 'STAFF' ? 'VIP/צוות' : 'חניכים'}</p>)}
      {preview.blocked.length > 0 ? <p className="text-red-700 text-xs font-semibold">אין אפשרות להחזיר את הקבוצה לכל השיבוץ הקודם: {preview.blocked.join(', ')}. ניתן להמשיך עם הוסף אוהל.</p> : <><p className="text-xs">האוהלים יישמרו כטיוטה לתקופה זו בלבד; לאחר מכן יש לאשר את השיבוץ.</p>{preview.warnings.length > 0 && <p className="text-xs">שכונה משותפת — יש לבדוק לפני אישור השיבוץ.</p>}<Button size="sm" disabled={busy} onClick={() => call('RETURN_COMMIT')}>שמור שיבוץ מוצע</Button></>}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => setPreview(null)}>ביטול</Button>
    </div>}
  </div>;
}