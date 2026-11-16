/**
 * Housekeeping hours — DEFAULT operational screen.
 * Simple daily shift management only: add shift, unified chronological list,
 * per-day totals. The monthly report opens separately via "הצג דוח".
 */
import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useRoleContext } from "@/lib/RoleContext";
import { Button } from "@/components/ui/button";
import { Plus, Clock, FileBarChart } from "lucide-react";
import { format, parseISO } from "date-fns";
import { he } from "date-fns/locale";
import CleaningShiftForm from "@/components/cleaning/CleaningShiftForm";
import CleaningShiftRow from "@/components/cleaning/CleaningShiftRow";

const CAN_EDIT_ROLES = ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "HOUSEKEEPING_MANAGER"];

function fmtMins(mins) {
  if (!mins || mins <= 0) return "0:00";
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
}

function formatDateHebrew(dateStr) {
  try { return format(parseISO(dateStr), "EEEE, d בMMMM yyyy", { locale: he }); }
  catch { return dateStr; }
}

export default function CleaningHours() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => base44.auth.me(),
  });

  // Role resolved on the server for the signed-in identity (no direct InternalUser read)
  const { role } = useRoleContext();
  const myRole = role || "VIEWER";
  const canEdit = CAN_EDIT_ROLES.includes(myRole);

  const { data: shifts = [] } = useQuery({
    queryKey: ["cleaningWorkShifts"],
    queryFn: () => base44.entities.CleaningWorkShift.list("-date", 500),
  });

  const refetch = () => queryClient.invalidateQueries({ queryKey: ["cleaningWorkShifts"] });

  const activeShifts = useMemo(() => shifts.filter(s => s.status === "ACTIVE"), [shifts]);

  // One unified chronological list, grouped by date (newest first) with per-day totals.
  // Within a day, rows are sorted by start time — never split by named/unnamed/extra worker.
  const byDate = useMemo(() => {
    const map = {};
    activeShifts.forEach(s => {
      if (!map[s.date]) map[s.date] = [];
      map[s.date].push(s);
    });
    Object.values(map).forEach(rows => rows.sort((a, b) =>
      a.start_time.localeCompare(b.start_time)
    ));
    return map;
  }, [activeShifts]);

  const sortedDates = useMemo(() =>
    Object.keys(byDate).sort((a, b) => b.localeCompare(a)),
    [byDate]
  );

  const handleSave = async (data) => {
    await base44.entities.CleaningWorkShift.create({
      ...data,
      created_by: user?.email || "",
    });
    setShowForm(false);
    refetch();
  };

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Header */}
      <div className="border-b border-border bg-card sticky top-12 sm:top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-primary" />
            <div>
              <h1 className="text-xl font-bold">שעות עובדות ניקיון</h1>
              <p className="text-xs text-muted-foreground mt-0.5">רישום וניהול משמרות ניקיון לפי תאריך</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate("/cleaning-report")} className="gap-1">
              <FileBarChart className="w-4 h-4" /> הצג דוח
            </Button>
            {canEdit && (
              <Button size="sm" onClick={() => setShowForm(v => !v)} className="gap-1">
                <Plus className="w-4 h-4" /> הוסף משמרת
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Add form */}
        {showForm && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h2 className="text-sm font-bold text-slate-700 mb-4">רישום כניסת עובדת</h2>
            <CleaningShiftForm onSave={handleSave} onCancel={() => setShowForm(false)} />
          </div>
        )}

        {/* Daily operational log — unified chronological list */}
        {sortedDates.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Clock className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm">אין רישומים עדיין</p>
          </div>
        ) : (
          <div className="space-y-6">
            {sortedDates.map(date => {
              const rows = byDate[date];
              const dayTotal = rows.filter(r => r.end_time).reduce((s, r) => s + (r.total_worker_minutes || 0), 0);
              return (
                <section key={date} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-700">{formatDateHebrew(date)}</h3>
                    <span className="text-xs bg-primary/10 text-primary font-semibold px-2 py-0.5 rounded-full">
                      סה״כ יום: {dayTotal > 0 ? fmtMins(dayTotal) : "—"}
                    </span>
                  </div>
                  <div className="p-3 space-y-2">
                    {rows.map(s => (
                      <CleaningShiftRow key={s.id} shift={s} canEdit={canEdit} onRefresh={refetch} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}