import React, { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OP_LABELS } from "@/lib/activityDayManageApi";

// Shown when a management operation did not finish. New edits are blocked until it is completed or reverted.
export default function PendingOperationBanner({ execution, run, onMessage }) {
  const [busy, setBusy] = useState(null);
  const op = execution.operation;
  if (!op) return null;
  const go = async (direction) => {
    setBusy(direction);
    const r = await run("resume", { op_id: op.op_id, direction });
    setBusy(null);
    onMessage(r.ok ? { type: "ok", text: direction === "revert" ? "המצב הקודם שוחזר" : "הפעולה הושלמה" } : { type: "error", text: r.message, blockers: r.result?.blockers });
  };
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
      <div className="flex items-start gap-2 text-sm text-red-800">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold">הפעולה "{OP_LABELS[op.type] || op.type}" לא הושלמה</div>
          <div className="text-red-700">חלק מהשינויים נשמרו. אין לבצע שינויים נוספים לפני השלמה או שחזור.{execution.last_error ? ` (${execution.last_error})` : ""}</div>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" disabled={!!busy} onClick={() => go("forward")}>{busy === "forward" && <Loader2 className="animate-spin" />} השלמת הפעולה</Button>
        {op.type === "EDIT" && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => go("revert")}>{busy === "revert" && <Loader2 className="animate-spin" />} שחזור המצב הקודם</Button>}
      </div>
    </div>
  );
}