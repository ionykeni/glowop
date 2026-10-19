import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import MechinaEligibilityConfirmDialog from '@/components/mechina/MechinaEligibilityConfirmDialog';

export default function MechinaEligibilityControl({ space, onChanged }) {
  const [busy, setBusy] = useState(false), [preview, setPreview] = useState(null), [error, setError] = useState('');
  const enabled = space.mechina_requests_effective_enabled === true;
  const invoke = async payload => (await base44.functions.invoke('manageMechinaSpaceEligibility', payload)).data;
  const save = async (value, confirmation = null) => {
    setBusy(true); setError('');
    try {
      const result = await invoke({ action: 'set', space_id: space.id, enabled: value, confirm_disable: !value, pending_count: confirmation?.pending_count });
      if (result.needs_confirmation) { setPreview(result); setError(result.error); return; }
      if (result.space) await onChanged(result.space);
      if (!result.success) { setError(result.error || 'השינוי לא הושלם. יש לנסות שוב.'); return; }
      setPreview(null);
    } catch (err) { setError(err.response?.data?.error || 'השינוי לא אומת. יש לרענן ולנסות שוב; המרחב עשוי להיות כבר חסום.'); }
    finally { setBusy(false); }
  };
  const confirmDisable = async () => {
    setBusy(true); setError('');
    try {
      const result = await invoke({ action: 'preview', space_id: space.id });
      if (!result.success) throw new Error(result.error);
      setPreview(result);
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setBusy(false); }
  };
  return <div className="rounded-lg border border-border bg-card p-3 space-y-2">
    <p className="text-sm font-semibold">{space.name}</p>
    <p className={`text-xs ${enabled ? 'text-primary' : 'text-destructive'}`}>בקשות מכינה — {enabled ? 'פעיל' : 'חסום'}</p>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => enabled ? confirmDisable() : save(true)}>
      {busy ? 'טוען...' : enabled ? 'חסום בקשות' : 'הפעל בקשות'}</Button>
      {!enabled && <Button size="sm" variant="ghost" disabled={busy} onClick={confirmDisable}>השלמת דחייה</Button>}</div>
    {!preview && error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <MechinaEligibilityConfirmDialog preview={preview} busy={busy} error={error} onClose={() => { setPreview(null); setError(''); }} onConfirm={() => save(false, preview)} />
  </div>;
}