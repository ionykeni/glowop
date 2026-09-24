import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const fmt = d => d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '—';
const kind = r => r.allocation_type === 'STAFF' ? (/__vip_req_\d+__/.test(r.notes || '') ? 'VIP ' : 'צוות ') : '';

export default function UpdatedDatesPreviewDialog({ preview, busy, onConfirm, onClose }) {
  const dated = preview.mode === 'UPDATE_DATES';
  const rows = dated ? preview.updates : preview.creates;
  const oldRange = dated ? preview.old_period : preview.source_period;
  const blocked = preview.blocked || [];
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader><DialogTitle>עדכון שיבוץ לתאריכים החדשים</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded border border-slate-200 bg-slate-50 p-2">{dated ? 'תקופה ישנה' : 'שיבוץ קודם (תקופה קודמת)'}:<br /><strong>{fmt(oldRange?.start_date)}–{fmt(oldRange?.end_date)}</strong></div>
            <div className="rounded border border-amber-300 bg-amber-50 p-2">תקופה חדשה:<br /><strong>{fmt(preview.target_period?.start_date)}–{fmt(preview.target_period?.end_date)}</strong></div>
          </div>
          <div className="max-h-60 overflow-y-auto rounded border border-slate-200 divide-y divide-slate-100">
            {rows.map((r, i) => (
              <div key={i} className="flex justify-between px-3 py-1.5 text-xs">
                <span>{kind(r)}אוהל {r.tent_code} — {r.allocated_pax}</span>
                {dated && <span className="text-slate-500">{fmt(r.new_arrival_date)}–{fmt(r.new_departure_date)}</span>}
              </div>
            ))}
          </div>
          {blocked.length > 0 ? (
            <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">
              <p className="font-semibold">אין אפשרות לשמור את כל השיבוץ בתאריכים החדשים</p>
              <p>אוהלים תפוסים: {blocked.map(b => b.tent_code || b).join(', ')}</p>
              <p className="mt-1">ניתן להמשיך עם "שיבוץ מחדש" או "הוסף אוהל".</p>
            </div>
          ) : (
            <p className="text-xs text-slate-600">{dated ? 'אותם אוהלים, אותה כמות ואותה חלוקה יעודכנו לתאריכי התקופה החדשה. לילות שכבר עברו לא ישתנו.' : 'לא נמצא שיבוץ קודם לתקופה זו; האוהלים מהתקופה הקודמת יישמרו כטיוטה ויש לאשר אותם לאחר מכן.'}</p>
          )}
          {preview.warnings?.length > 0 && <p className="text-xs text-amber-700">שכונה משותפת עם קבוצה אחרת בתאריכים אלו — אזהרה בלבד.</p>}
        </div>
        <DialogFooter className="flex-row-reverse gap-2 sm:justify-start">
          {blocked.length === 0 && <Button disabled={busy} onClick={onConfirm}>{busy ? 'מעדכן…' : 'אשר ועדכן'}</Button>}
          <Button variant="outline" disabled={busy} onClick={onClose}>ביטול</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}