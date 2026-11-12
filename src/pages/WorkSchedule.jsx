import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useRoleContext } from "@/lib/RoleContext";
import { hasPermission } from "@/lib/roles";
import { useToast } from "@/components/ui/use-toast";
import { AlertTriangle, CalendarClock, FileText } from "lucide-react";
import { getWeekStart, addDays, dayNameOf, TEAM_FILTERS } from "@/lib/workScheduleConfig";
import { invokeWorkforce } from "@/lib/workforceApi";
import { Button } from "@/components/ui/button";
import WeekToolbar from "@/components/work-schedule/WeekToolbar";
import ScheduleGrid from "@/components/work-schedule/ScheduleGrid";
import ShiftFormModal from "@/components/work-schedule/ShiftFormModal";
import WeeklyScheduleReportModal from "@/components/work-schedule/WeeklyScheduleReportModal";
import AdminRequestsPanel from "@/components/work-schedule/AdminRequestsPanel";
import WorkerManagementPanel from "@/components/work-schedule/WorkerManagementPanel";
import CopyShiftModal from "@/components/work-schedule/CopyShiftModal";
import ScheduleReports from "@/components/work-schedule/reports/ScheduleReports";
import { usePendingWorkScheduleRequests } from "@/hooks/usePendingWorkScheduleRequests";


export default function WorkSchedule() {
  const { role, internalUser } = useRoleContext();
  const canManage = hasPermission(role, "MANAGE_WORK_SCHEDULE");
  const canView = canManage || hasPermission(role, "VIEW_WORK_SCHEDULE");
  const pendingRequestCount = usePendingWorkScheduleRequests(role);
  const userEmail = internalUser?.email || "";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [weekStart, setWeekStart] = useState(() => getWeekStart());
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [modal, setModal] = useState(null); // { shift } | { defaults }
  const [reportOpen, setReportOpen] = useState(false);
  const [copyShift, setCopyShift] = useState(null);
  const [activeTab, setActiveTab] = useState("schedule");
  const [busy, setBusy] = useState(false);

  const { data: schedules = [] } = useQuery({
    queryKey: ["workSchedule", weekStart],
    queryFn: () => base44.entities.WorkSchedule.filter(canManage ? { week_start_date: weekStart } : { week_start_date: weekStart, status: "PUBLISHED" }),
  });
  const schedule = schedules[0] || null;

  const { data: shifts = [] } = useQuery({
    queryKey: ["workShifts", schedule?.id],
    queryFn: () => base44.entities.WorkShift.filter({ work_schedule_id: schedule.id }, "date", 500),
    enabled: !!schedule,
  });

  const { data: workers = [] } = useQuery({
    queryKey: ["workerProfiles"], enabled: canManage,
    queryFn: async () => (await invokeWorkforce("getWorkerDirectory", { action: "scheduling" })).workers,
  });
  const { data: assignmentRequests = [] } = useQuery({
    queryKey: ["workScheduleRequests"], enabled: canManage,
    queryFn: async () => (await base44.functions.invoke("manageWorkScheduleRequests", { action: "admin_list" })).data.requests || [],
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["workSchedule", weekStart] });
    queryClient.invalidateQueries({ queryKey: ["workShifts"] });
    queryClient.invalidateQueries({ queryKey: ["workerProfiles"] });
  };

  // All schedule/shift writes go through the secured manageWorkSchedule backend function
  const schedulePost = (action, payload = {}) => invokeWorkforce("manageWorkSchedule", { action, ...payload });
  const showError = (err) => toast({ description: err.message || "שגיאה", variant: "destructive" });

  const handleCreateDraft = async () => {
    if (!canManage) return;
    setBusy(true);
    try {
      await schedulePost("ensure_schedule", { week_start_date: weekStart });
      invalidate();
      toast({ description: "נוצרה טיוטת סידור לשבוע זה" });
    } catch (err) { showError(err); }
    setBusy(false);
  };

  // Errors propagate to ShiftFormModal, which shows them inline
  const handleSaveShift = async (payload) => {
    if (!canManage) return;
    await schedulePost("save_shift", { shift_id: modal?.shift?.id || "", week_start_date: weekStart, shift: payload });
    invalidate();
  };

  const runShiftAction = async (action, payload) => {
    try { await schedulePost(action, payload); } catch (err) { showError(err); }
    invalidate();
  };
  const handleCancelShift = (shift) => canManage && runShiftAction("cancel_shift", { shift_id: shift.id });
  // Already-deleted shifts succeed on the server, so stale cards are cleared by the refresh
  const handleDeleteShift = (shift) => canManage && runShiftAction("delete_shift", { shift_id: shift.id });

  const handleCopyShift = async (targetDates) => {
    if (!canManage || !copyShift) return;
    const response = await base44.functions.invoke("copyWorkShiftToDays", { shift_id: copyShift.id, target_dates: targetDates });
    invalidate();
    toast({ description: `נוצרו ${response.data.created_count} משמרות · דולגו ${response.data.skipped_count} משמרות שכבר קיימות` });
    setCopyShift(null);
    return response.data;
  };

  const handleCreateOpsMorning = async (shift) => {
    if (!canManage || shift.row_type !== "NIGHT_ON_CALL") return;
    try {
      const res = await base44.functions.invoke("createOpsMorningFromNightOnCall", { night_shift_id: shift.id });
      const d = res.data;
      if (d.status === "created") {
        invalidate();
        toast({ description: `נוצרה משמרת תפעול בוקר ל${dayNameOf(addDays(shift.date, 1))} · ${d.worker_name}` });
        return;
      }
      if (d.status === "next_week_missing") {
        toast({ description: d.message, variant: "destructive" });
        return;
      }
      if (d.status === "duplicate") {
        toast({ description: d.message });
        return;
      }
      if (d.status === "warning") {
        const lines = [];
        if (d.other_workers?.length) lines.push(`כבר קיימת משמרת תפעול בוקר ביום זה: ${d.other_workers.join(", ")}`);
        if (d.requests?.length) lines.push("לעובד קיימת בקשה / אי זמינות ביום זה");
        const ok = window.confirm(`${lines.join("\n")}\n\nליצור בכל זאת?`);
        if (!ok) return;
        const res2 = await base44.functions.invoke("createOpsMorningFromNightOnCall", { night_shift_id: shift.id, force: true });
        if (res2.data.status === "created") {
          invalidate();
          toast({ description: `נוצרה משמרת תפעול בוקר ל${dayNameOf(addDays(shift.date, 1))}` });
        } else {
          toast({ description: res2.data.message || res2.data.error || "שגיאה", variant: "destructive" });
        }
        return;
      }
      toast({ description: d.message || d.error || "שגיאה", variant: "destructive" });
    } catch (err) {
      toast({ description: err.message || "שגיאה ביצירת תפעול בוקר", variant: "destructive" });
    }
  };

  const handleToggleNightOnCall = (shift, shouldCreate) => {
    if (!canManage || shift.row_type !== "OPERATIONS_EVENING") return;
    return runShiftAction("toggle_night_on_call", { shift_id: shift.id, enabled: shouldCreate });
  };

  const handleCopyPrev = async () => {
    if (!canManage) return;
    if (shifts.length > 0 && !window.confirm("כבר קיימים משמרות בשבוע זה. להעתיק בכל זאת? (המשמרות הקיימות יישארו)")) return;
    setBusy(true);
    try {
      const res = await schedulePost("copy_previous_week", { week_start_date: weekStart });
      if (res.status === "no_previous") toast({ description: "לא נמצא סידור בשבוע הקודם", variant: "destructive" });
      else if (res.status === "no_shifts") toast({ description: "אין משמרות להעתקה בשבוע הקודם" });
      else {
        invalidate();
        toast({ description: `הועתקו ${res.count} משמרות מהשבוע הקודם (טיוטה)` });
      }
    } catch (err) { showError(err); }
    setBusy(false);
  };

  const handlePublish = async () => {
    if (!canManage || !schedule) return;
    setBusy(true);
    try {
      await schedulePost("publish", { schedule_id: schedule.id });
      invalidate();
      toast({ description: "הסידור פורסם — העובדים יכולים לראות את המשמרות שלהם" });
    } catch (err) { showError(err); }
    setBusy(false);
  };

  if (!canView) {
    return (
      <div className="max-w-screen-xl mx-auto px-4 py-12 text-center text-slate-400 text-sm" dir="rtl">
        אין לך הרשאה לצפות בסידור העבודה
      </div>
    );
  }

  return (
    <div className="max-w-screen-xl mx-auto px-4 lg:px-6 py-6 space-y-4" dir="rtl">
      <div className="flex items-center gap-2">
        <CalendarClock className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-bold text-slate-800">סידור עבודה שבועי</h1>
      </div>

      {canManage && pendingRequestCount > 0 && <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"><span>יש {pendingRequestCount} בקשות ממתינות לאישור</span><Button size="sm" variant="outline" onClick={() => setActiveTab("requests")}>מעבר לבקשות</Button></div>}

      {canManage && <div className="flex gap-2 border-b border-slate-200 pb-2">
        <Button type="button" size="sm" variant={activeTab === "schedule" ? "default" : "ghost"} onClick={() => setActiveTab("schedule")}>סידור עבודה</Button>
        <Button type="button" size="sm" variant={activeTab === "requests" ? "default" : "ghost"} onClick={() => setActiveTab("requests")}>בקשות{pendingRequestCount > 0 && <span className="mr-1 inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">{pendingRequestCount}</span>}</Button>
        <Button type="button" size="sm" variant={activeTab === "workers" ? "default" : "ghost"} onClick={() => setActiveTab("workers")}>ניהול עובדים</Button>
        <Button type="button" size="sm" variant={activeTab === "monthly" ? "default" : "ghost"} onClick={() => setActiveTab("monthly")}>דוחות סידור עבודה</Button>
      </div>}

      {activeTab === "monthly" && canManage ? <ScheduleReports /> : activeTab === "workers" && canManage ? <WorkerManagementPanel /> : activeTab === "requests" && canManage ? <AdminRequestsPanel weekStart={weekStart} setWeekStart={setWeekStart} /> : <>
      <WeekToolbar
        weekStart={weekStart}
        setWeekStart={setWeekStart}
        schedule={schedule}
        onCopyPrev={handleCopyPrev}
        onCreateDraft={handleCreateDraft}
        onPublish={handlePublish}
        busy={busy}
        canManage={canManage}
      />

      {canManage && schedule?.status === "PUBLISHED" && (
        <div className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          הסידור כבר פורסם. כל שינוי ישפיע על מה שהעובדים רואים.
        </div>
      )}

      {/* Team filter + weekly report */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {TEAM_FILTERS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTeamFilter(t.id)}
              className={`px-3.5 py-1 rounded-full text-xs font-medium border transition-all ${
                teamFilter === t.id
                  ? "bg-primary text-white border-primary"
                  : "bg-white text-slate-600 border-slate-200 hover:border-primary/50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {canManage && (
          <Button type="button" variant="outline" size="sm" disabled={!schedule} onClick={() => setReportOpen(true)}>
            <FileText className="w-4 h-4" />
            דוח שבועי
          </Button>
        )}
      </div>

      <ScheduleGrid
        weekStart={weekStart}
        shifts={shifts}
        teamFilter={teamFilter}
        canManage={canManage}
        onAddShift={(date, rowType) => canManage && setModal({ defaults: { date, row_type: rowType } })}
        onEditShift={(shift) => canManage && setModal({ shift })}
        onCopyShift={(shift) => canManage && setCopyShift(shift)}
        onToggleNightOnCall={handleToggleNightOnCall}
        onCreateOpsMorning={handleCreateOpsMorning}
      />

      {copyShift && canManage && (
        <CopyShiftModal shift={copyShift} weekStart={weekStart} shifts={shifts} onCopy={handleCopyShift} onClose={() => setCopyShift(null)} />
      )}

      {modal && canManage && (
        <ShiftFormModal
          shift={modal.shift || null}
          defaults={modal.defaults || null}
          workers={workers}
          requests={assignmentRequests}
          isPublished={schedule?.status === "PUBLISHED"}
          userEmail={userEmail}
          onSave={handleSaveShift}
          onDelete={handleDeleteShift}
          onCancelShift={handleCancelShift}
          onClose={() => setModal(null)}
        />
      )}

      {reportOpen && canManage && (
        <WeeklyScheduleReportModal
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          schedule={schedule}
          shifts={shifts}
          weekStart={weekStart}
          workers={workers}
        />
      )}
      </>}
    </div>
  );
}