import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export default function MechinaEligibilityConfirmDialog({ preview, busy, error, onClose, onConfirm }) {
  return <Dialog open={!!preview} onOpenChange={open => !open && !busy && onClose()}>
    <DialogContent dir="rtl" className="max-w-md">
      <DialogHeader><DialogTitle className="text-right">חסימת בקשות מכינה</DialogTitle>
        <DialogDescription className="text-right">{preview?.space?.name}</DialogDescription></DialogHeader>
      <p className="text-sm">המרחב ייחסם לבקשות מכינה חדשות. {preview?.pending_count ?? 0} בקשות ממתינות לאישור יידחו אוטומטית, בכל התאריכים.</p>
      <p className="text-sm text-muted-foreground">הזמנות שכבר אושרו וחסימות זמניות לפי תאריך לא ישתנו.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>ביטול</Button>
        <Button variant="destructive" disabled={busy} onClick={onConfirm}>{busy ? 'שומר...' : 'אשר חסימה ודחיית בקשות'}</Button></div>
    </DialogContent>
  </Dialog>;
}