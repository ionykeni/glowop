import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { usePmVoid } from "@/hooks/usePreventiveMaintenance";

export default function VoidCompletionDialog({ target, onClose }) {
  const [reason, setReason] = useState("");
  const voidMut = usePmVoid();
  const { toast } = useToast();

  const close = () => { setReason(""); voidMut.reset(); onClose(); };
  const submit = () => voidMut.mutate(
    { event_id: target.event_id, reason: reason.trim() },
    { onSuccess: () => { toast({ title: "הסימון בוטל ונשמר בהיסטוריה" }); close(); } },
  );

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && close()}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-right">תיקון סימון שגוי</DialogTitle>
        </DialogHeader>
        <p className="text-sm font-semibold">{target?.title}</p>
        <p className="text-xs text-muted-foreground">
          הסימון המקורי יישמר בהיסטוריה ויסומן כמבוטל, יחד עם שמך ושעת התיקון. המצב הנוכחי יחושב מחדש.
        </p>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="סיבת התיקון (חובה)" rows={3} maxLength={300} />
        {voidMut.error && <p className="text-xs text-red-600">{voidMut.error.message}</p>}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={close}>ביטול</Button>
          <Button variant="destructive" disabled={!reason.trim() || voidMut.isPending} onClick={submit}>
            {voidMut.isPending ? "שומר..." : "בטל סימון"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}