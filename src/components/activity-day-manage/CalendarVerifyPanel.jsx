import React, { useState } from "react";
import { Loader2, CalendarSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { callManage } from "@/lib/activityDayManageApi";

const LABELS = { OK: "תואם", REMOVED: "הוסר כנדרש", MISSING_IN_GOOGLE: "חסר ביומן", MISMATCH: "לא תואם", STALE_EVENT: "אירוע מבוטל עדיין ביומן", NOT_SYNCED: "טרם סונכרן", GOOGLE_ERROR: "שגיאת יומן" };

// Read-only evidence: compares each activity with its Google Calendar event. Never writes anything.
export default function CalendarVerifyPanel({ executionId }) {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    setRes(await callManage("verify_calendar", { execution_id: executionId }));
    setBusy(false);
  };
  const problems = (res?.items || []).filter(i => i.state !== "OK" && i.state !== "REMOVED");
  return (
    <div className="activity-day-section space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-800">בדיקת התאמה ליומן Google</div>
        <Button size="sm" variant="outline" disabled={busy} onClick={check}>{busy ? <Loader2 className="animate-spin" /> : <CalendarSearch />} בדיקה</Button>
      </div>
      {res && !res.success && <div className="text-sm text-red-700">{res.error}</div>}
      {res?.success && (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            {Object.entries(res.counts).map(([k, n]) => <span key={k} className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">{LABELS[k] || k}: {n}</span>)}
          </div>
          {res.all_ok ? <div className="text-green-700">היומן תואם לכל הפעילויות</div> : (
            <ul className="space-y-1">
              {problems.map(p => <li key={p.item_id} className="text-xs text-slate-700">{p.station_title} · {p.group_name} — <span className="text-red-700">{LABELS[p.state] || p.state}</span>{p.details ? ` (${p.details})` : ""}</li>)}
            </ul>
          )}
          <div className="text-xs text-slate-400">הסנכרון ליומן מתבצע ברקע ועשוי להימשך מספר שניות לאחר שינוי.</div>
        </div>
      )}
    </div>
  );
}