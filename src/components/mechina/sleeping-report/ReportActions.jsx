import { Button } from "@/components/ui/button";
import { Save, Send, Loader2 } from "lucide-react";
export default function ReportActions({ report: r }) {
  const hasReport = Object.values(r.entries).some(e => e.reported);
  return <div className="sticky bottom-0 z-10 rounded-xl border border-border bg-card p-3 space-y-2 shadow-sm">
    {r.invalid && <p role="alert" className="text-sm text-destructive">יש לתקן כמויות ולבחור מגדר בכל אוהל עם לנים לפני ההגשה.</p>}
    <div className="flex gap-2">
      <Button variant="outline" className="flex-1" disabled={!!r.busy} onClick={r.saveDraft}>{r.busy === "draft" ? <Loader2 className="animate-spin" /> : <Save />}שמור טיוטה</Button>
      <Button className="flex-1" disabled={!!r.busy || r.invalid || !hasReport} onClick={r.submit}>{r.busy === "submit" ? <Loader2 className="animate-spin" /> : <Send />}{r.ctx.versions.some(v => v.status === "SUBMITTED") ? "הגש גרסה חדשה" : "הגש דיווח"}</Button>
    </div>
  </div>;
}