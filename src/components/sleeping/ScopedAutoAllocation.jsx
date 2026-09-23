import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import RoleGate from '@/components/RoleGate';
import { toast } from 'sonner';

const fmt = date => date?.slice(8, 10) + '/' + date?.slice(5, 7);
export default function ScopedAutoAllocation({ groupId, selectedPeriod, hasLaterPeriods, tents, neighborhoods, onSaved }) {
  const [scope, setScope] = useState('SELECTED_ONLY');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const edit_scope = selectedPeriod ? { mode: hasLaterPeriods && scope === 'SELECTED_AND_FUTURE' ? scope : 'SELECTED_ONLY', selected_period_id: selectedPeriod.id } : { mode: 'ALL' };
  const call = async action => {
    setBusy(true); setError('');
    try {
      const { data } = await base44.functions.invoke('manageScopedSleepingRelease', { action, group_id: groupId, edit_scope, ...(action === 'AUTO_COMMIT' ? { proposal_keys: preview.proposal_keys } : {}) });
      if (!data?.success) throw new Error(data?.error || 'לא ניתן לבצע שיבוץ אוטומטי');
      if (action === 'AUTO_PREVIEW') setPreview(data);
      else { setPreview(null); await onSaved?.(); toast.success(`שובצו אוטומטית: ${data.allocated} · נותרו ללא שיבוץ: ${data.remaining}`); }
    } catch (e) { setError(e?.response?.data?.error || e.message); if (action === 'AUTO_COMMIT') setPreview(null); }
    finally { setBusy(false); }
  };
  return <RoleGate permission="MANAGE_ALLOCATION"><div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3 text-xs">
    <div className="flex flex-wrap items-center gap-3"><strong className="text-slate-700">שיבוץ אוטומטי — השלמת מקומות חסרים לחניכים</strong>
      {selectedPeriod && hasLaterPeriods && <div className="flex flex-wrap gap-3 text-blue-700">{[['SELECTED_ONLY','רק לתקופה הזו'],['SELECTED_AND_FUTURE','לתקופה הזו ולכל התקופות הבאות']].map(([value, label]) => <label key={value} className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={scope === value} onChange={() => { setScope(value); setPreview(null); setError(''); }} />{label}</label>)}</div>}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => { setPreview(null); call('AUTO_PREVIEW'); }}>{busy ? 'בודק זמינות…' : 'הצג הצעה'}</Button>
    </div>
    {!selectedPeriod && <p className="text-blue-700">כל התקופות הנוכחיות והעתידיות בלבד; שיבוצים קיימים נשמרים.</p>}
    {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-red-700">{error}</p>}
    {preview && <div className="space-y-2 border-t border-slate-200 pt-3"><strong className="text-emerald-700">שיבוץ אוטומטי מוצע</strong>{!preview.allocated && !preview.remaining && <p className="text-slate-600">כל החניכים כבר שובצו בתקופות שנבחרו.</p>}
      {preview.results.filter(r => r.missing > 0).map((r, i) => <div key={i} className="rounded border border-slate-200 p-2"><strong>תקופה {fmt(r.start_date)}–{fmt(r.end_date)} · {r.gender === 'BOYS' ? 'בנים' : r.gender === 'GIRLS' ? 'בנות' : 'כללי'}</strong><div className="mt-1 flex flex-wrap gap-2">{r.rows.map(row => <span key={row.tent_id} className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1">{neighborhoods.find(n => n.id === row.neighborhood_id)?.name} · {tents.find(t => t.id === row.tent_id)?.code} — {row.pax}</span>)}</div>{r.remaining > 0 && <p className="mt-1 text-amber-700">נותרו ללא שיבוץ: {r.remaining}</p>}</div>)}
      <p className="font-semibold text-emerald-700">שובצו אוטומטית: {preview.allocated}</p><p className={preview.remaining ? 'text-amber-700' : 'text-emerald-700'}>נותרו ללא שיבוץ: {preview.remaining}{preview.remaining ? ' · לא נמצאה קיבולת פנויה ובטוחה מספקת' : ''}</p>
      {preview.warnings?.length > 0 && <p className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">שכונה משותפת: {preview.warnings.map(id => neighborhoods.find(n => n.id === id)?.name || id).join(', ')}. אוהלים תפוסים לא נבחרו; אישור שיבוץ הלינה עשוי לדרוש סיבה לשיתוף.</p>}
      <div className="flex gap-2"><Button size="sm" disabled={busy || !preview.allocated} onClick={() => call('AUTO_COMMIT')}>{busy ? 'שומר…' : 'אישור שיבוץ'}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setPreview(null)}>ביטול</Button></div>
    </div>}
  </div></RoleGate>;
}