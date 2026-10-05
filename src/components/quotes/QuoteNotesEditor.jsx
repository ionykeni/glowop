import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Compact preview of the client-facing Quote notes; opens a comfortable editor modal. */
export default function QuoteNotesEditor({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const openEditor = () => { setDraft(value || ""); setOpen(true); };
  return (
    <>
      <button type="button" onClick={openEditor}
        className="w-full min-h-[3.5rem] rounded-md border border-input bg-white px-3 py-2 text-sm text-right hover:border-primary/50 transition-colors">
        {value
          ? <span className="line-clamp-2 whitespace-pre-line text-slate-700">{value}</span>
          : <span className="text-slate-400">לחץ לכתיבת הערות שיופיעו בהצעת המחיר ללקוח</span>}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader><DialogTitle className="text-right">הערות להצעה</DialogTitle></DialogHeader>
          <Textarea dir="rtl" autoFocus value={draft} onChange={e => setDraft(e.target.value)}
            className="min-h-[50vh] text-sm leading-relaxed resize-y" placeholder="כתבו כאן את ההערות ללקוח..." />
          <div className="flex justify-start gap-2">
            <Button type="button" onClick={() => { onChange(draft); setOpen(false); }}>שמירה</Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>ביטול</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}