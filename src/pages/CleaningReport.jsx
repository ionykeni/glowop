/**
 * Dedicated monthly housekeeping HOURS report page (דוח שעות — חישוב 150%).
 * Opened only when the user clicks "הצג דוח" on the operational screen.
 * Hours only — no money. The 150% calculation logic is untouched.
 */
import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useRoleContext } from "@/lib/RoleContext";
import { Button } from "@/components/ui/button";
import { ArrowRight, Printer } from "lucide-react";
import ReactDOM from "react-dom";
import CleaningPayrollReport from "@/components/cleaning/CleaningPayrollReport";
import HousekeepingHolidayManager from "@/components/cleaning/HousekeepingHolidayManager";
import CleaningHoursPrintTemplate from "@/components/cleaning/CleaningHoursPrintTemplate";

const CAN_EDIT_ROLES = ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "HOUSEKEEPING_MANAGER"];

function getMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${last}` };
}

const fmtDisplay = (d) => {
  if (!d) return "";
  const [y, mo, day] = d.split("-");
  return `${day}/${mo}/${y}`;
};

export default function CleaningReport() {
  const navigate = useNavigate();
  const def = getMonthRange();
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [applied, setApplied] = useState(def);

  const { data: user } = useQuery({ queryKey: ["me"], queryFn: () => base44.auth.me() });
  // Role resolved on the server for the signed-in identity (no direct InternalUser read)
  const { role } = useRoleContext();
  const myRole = role || "VIEWER";
  const canEdit = CAN_EDIT_ROLES.includes(myRole);

  const { data: shifts = [] } = useQuery({
    queryKey: ["cleaningWorkShifts"],
    queryFn: () => base44.entities.CleaningWorkShift.list("-date", 500),
  });
  const { data: holidays = [] } = useQuery({
    queryKey: ["housekeepingHolidays"],
    queryFn: () => base44.entities.HousekeepingHoliday.list("-date", 200),
  });

  const periodLabel = useMemo(
    () => `${fmtDisplay(applied.from)} – ${fmtDisplay(applied.to)}`,
    [applied]
  );

  const handlePrint = () => {
    const container = document.createElement("div");
    container.id = "cleaning-print-container";
    document.body.appendChild(container);
    ReactDOM.render(
      <CleaningHoursPrintTemplate shifts={shifts} holidays={holidays} from={applied.from} to={applied.to} />,
      container,
      () => {
        const style = document.createElement("style");
        style.id = "cleaning-print-style";
        style.innerHTML = `
          @media print {
            body > *:not(#cleaning-print-container) { display: none !important; }
            #cleaning-print-container { display: block !important; }
          }
        `;
        document.head.appendChild(style);
        window.print();
        setTimeout(() => {
          document.body.removeChild(container);
          document.head.removeChild(style);
        }, 600);
      }
    );
  };

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Header */}
      <div className="border-b border-border bg-card sticky top-12 sm:top-0 z-10 print:hidden">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button size="sm" variant="ghost" onClick={() => navigate("/cleaning-hours")} className="gap-1">
              <ArrowRight className="w-4 h-4" /> חזרה למשמרות
            </Button>
            <div>
              <h1 className="text-xl font-bold">דוח שעות — חישוב 150%</h1>
              <p className="text-xs text-muted-foreground mt-0.5">תקופה: {periodLabel}</p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={handlePrint} className="gap-1">
            <Printer className="w-4 h-4" /> הדפס / יצוא PDF
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Period selector */}
        <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs text-slate-500">מתאריך</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="block border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-500">עד תאריך</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="block border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <Button size="sm" onClick={() => setApplied({ from, to })}>עדכן תקופה</Button>
        </div>

        {/* Holiday manager — editors only (affects the 150% report) */}
        {canEdit && <HousekeepingHolidayManager user={user} />}

        <CleaningPayrollReport shifts={shifts} holidays={holidays} from={applied.from} to={applied.to} />
      </div>
    </div>
  );
}