import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { CalendarClock } from 'lucide-react';
import RoleGate from '@/components/RoleGate';
import UpdatedDatesPreviewDialog from './UpdatedDatesPreviewDialog';

const fmt = d => d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '—';
const todayLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

// Same rule as the backend: rows made for this period whose dates no longer match it.
function staleRange(allocations, period) {
  const today = todayLocal();
  const stale = allocations.filter(r => r.stay_period_id === period.id && r.status !== 'CANCELLED' && r.departure_date > today
    && !r.segment_start_date && !r.segment_end_date && !r.series_action
    && (r.arrival_date !== period.start_date || r.departure_date !== period.end_date));
  if (!stale.length) return null;
  return { start: stale.map(r => r.arrival_date).sort()[0], end: stale.map(r => r.departure_date).sort().at(-1) };
}

export default function PendingSleepingDecision({ groupId, periods, allocations, selectedPeriod, onSelect, onSaved }) {
  const [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const target = selectedPeriod && periods.some(p => p.id === selectedPeriod.id) ? selectedPeriod : periods[0];
  if (!target) return null;
  const old = staleRange(allocations, target);
  const call = async action => {
    setBusy(true); setError('');
    try {
      const { data } = await base44.functions.invoke('manageScopedSleepingRelease', { action, group_id: groupId, selected_period_id: target.id, ...(action === 'RETURN_COMMIT' ? { proposal_keys: preview.proposal_keys } : {}) });
      if (!data?.success) throw new Error(data?.error || 'לא ניתן לעדכן את השיבוץ');
      if (action === 'RETURN_PREVIEW') setPreview(data);
      else { setPreview(null); await onSaved(); }
    } catch (e) { setError(e?.response?.data?.error || e.message); if (action === 'RETURN_COMMIT') setPreview(null); }
    finally { setBusy(false); }
  };
  return <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-2 text-sm text-amber-900">
    <strong className="flex items-center gap-1.5"><CalendarClock className="h-4 w-4" />תאריכי השהייה השתנו</strong>
    {old ? <p className="text-xs">השיבוץ הקיים הוכן לתאריכים: <strong dir="ltr">{fmt(old.start)}–{fmt(old.end)}</strong></p>
      : <p className="text-xs">לא נמצא שיבוץ שהוכן לתקופה זו; ניתן להציע את שיבוץ התקופה הקודמת.</p>}
    <p className="text-xs">התקופה המעודכנת: <strong dir="ltr">{fmt(target.start_date)}–{fmt(target.end_date)}</strong></p>
    <p className="text-xs">ניתן לשמור את אותו שיבוץ ולבדוק זמינות בתאריכים החדשים.</p>
    {periods.length > 1 && <select className="rounded border border-amber-300 bg-card p-1 text-xs" value={target.id} onChange={e => { onSelect(e.target.value); setPreview(null); }}>{periods.map(p => <option key={p.id} value={p.id}>{fmt(p.start_date)}–{fmt(p.end_date)}</option>)}</select>}
    <RoleGate permission="MANAGE_ALLOCATION"><div className="flex gap-2 flex-wrap pt-1">
      <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white" disabled={busy} onClick={() => call('RETURN_PREVIEW')}>{busy && !preview ? 'בודק זמינות…' : 'עדכן את השיבוץ לתאריכים החדשים'}</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => { onSelect(target.id); setPreview(null); document.getElementById('sleeping-manual-add')?.scrollIntoView({ behavior: 'smooth' }); }}>שיבוץ מחדש</Button>
    </div></RoleGate>
    {error && <p className="text-xs text-red-700">{error}</p>}
    {preview && <UpdatedDatesPreviewDialog preview={preview} busy={busy} onConfirm={() => call('RETURN_COMMIT')} onClose={() => setPreview(null)} />}
  </div>;
}