import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, Printer, Loader2 } from "lucide-react";
import { fetchReportPdf, downloadBlob, errorText } from "@/lib/scheduleReportClient";

export default function ReportPdfActions({ range, workerId }) {
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const worker = workerId !== "ALL";
  const params = (kind) => ({ kind, start: range.start, end: range.end, worker_id: kind === "worker" ? workerId : undefined, include_drafts: includeDrafts });

  const run = async (key, kind, print) => {
    setBusy(key); setError("");
    const win = print ? window.open("", "_blank") : null; // opened before the request so it is not blocked
    try {
      const { blob, filename } = await fetchReportPdf(params(kind));
      if (win) win.location.href = URL.createObjectURL(blob); else downloadBlob(blob, filename);
    } catch (err) {
      win?.close();
      setError(errorText(err, "הפקת ה-PDF נכשלה"));
    } finally { setBusy(null); }
  };
  const kind = worker ? "worker" : "team";
  const icon = (key, Icon) => busy === key ? <Loader2 className="animate-spin" /> : <Icon />;

  return <div className="flex flex-wrap items-center gap-2">
    <Button type="button" size="sm" onClick={() => run("team", "team")} disabled={!!busy}>{icon("team", Download)} PDF צוות</Button>
    <Button type="button" size="sm" variant="outline" onClick={() => run("worker", "worker")} disabled={!!busy || !worker} title={worker ? "" : "יש לבחור עובד"}>{icon("worker", Download)} PDF לעובד</Button>
    <Button type="button" size="sm" variant="outline" onClick={() => run("print", kind, true)} disabled={!!busy}>{icon("print", Printer)} הדפסה</Button>
    <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer"><Checkbox checked={includeDrafts} onCheckedChange={(v) => setIncludeDrafts(v === true)} /> לכלול טיוטות במסמך (תצוגה מקדימה למנהל)</label>
    {error && <span className="text-xs text-destructive w-full">{error}</span>}
  </div>;
}