import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useRoleContext } from "@/lib/RoleContext";
import { hasPermission } from "@/lib/roles";
import { useToast } from "@/components/ui/use-toast";
import { AlertTriangle, CalendarClock, FileText } from "lucide-react";
import { getWeekStart, addDays, dayNameOf, TEAM_FILTERS, ROW_BY_TYPE } from "@/lib/workScheduleConfig";
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

const NIGHT_ON_CALL_SOURCE = "OPERATIONS_EVENING_TO_NIGHT_ON_CALL";
const OPS_MORNING_SOURCE = "NIGHT_ON_CALL_TO_OPERATIONS_MORNING";

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
    queryKey: ["workerProfiles"],
    queryFn: () => base44.entities.WorkerProfile.filter({ is_active: true }, "full_name", 500),
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

  const ensureSchedule = async () => {
    if (schedule) return schedule;
    const created = await base44.entities.WorkSchedule.create({
      week_start_date: weekStart, status: "DRAFT", created_by: userEmail || undefined,
    });
    invalidate();
    return created;
  };

  const getLinkedNightOnCallShifts = (sourceShift) => base44.entities.WorkShift.filter({
    work_schedule_id: sourceShift.work_schedule_id,
    linked_source_shift_id: sourceShift.id,
    auto_created_from: NIGHT_ON_CALL_SOURCE,
  }, "-created_date", 50);

  const deleteLinkedNightOnCallShifts = async (sourceShift) => {
    const linked = await getLinkedNightOnCallShifts(sourceShift);
    await Promise.all(linked.map((s) => base44.entities.WorkShift.delete(s.id)));
  };

  const handleCreateDraft = async () => {
    if (!canManage) return;
    setBusy(true);
    await ensureSchedule();
    toast({ description: "נוצרה טיוטת סידור לשבוע זה" });
    setBusy(false);
  };

  const handleSaveShift = async (payload) => {
    if (!canManage) return;
    const s = await ensureSchedule();
    if (modal?.shift) {
      await base44.entities.WorkShift.update(modal.shift.id, { ...payload, updated_by: userEmail || undefined });
      if (modal.shift.row_type === "OPERATIONS_EVENING") {
        const linked = await getLinkedNightOnCallShifts(modal.shift);
        if (payload.row_type === "OPERATIONS_EVENING") {
          await Promise.all(linked.map((nightShift) => base44.entities.WorkShift.update(nightShift.id, {
            date: payload.date,
            worker_id: payload.worker_id,
            worker_name: payload.worker_name,
            updated_by: userEmail || undefined,
          })));
        } else {
          await Promise.all(linked.map((nightShift) => base44.entities.WorkShift.delete(nightShift.id)));
        }
      }
    } else {
      await base44.entities.WorkShift.create({ ...payload, work_schedule_id: s.id, created_by: userEmail || undefined });
    }
    invalidate();
  };

  const handleCancelShift = async (shift) => {
    if (!canManage) return;
    await base44.entities.WorkShift.update(shift.id, { status: "CANCELLED", updated_by: userEmail || undefined });
    if (shift.row_type === "OPERATIONS_EVENING") await deleteLinkedNightOnCallShifts(shift);
    invalidate();
  };

  const handleDeleteShift = async (shift) => {
    if (!canManage) return;
    if (shift.row_type === "OPERATIONS_EVENING") await deleteLinkedNightOnCallShifts(shift);
    try {
      await base44.entities.WorkShift.delete(shift.id);
    } catch {
      // Shift already removed (stale cache or deleted elsewhere) — refresh to clear the ghost card
    }
    invalidate();
  };

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

  const handleToggleNightOnCall = async (shift, shouldCreate) => {
    if (!canManage || shift.row_type !== "OPERATIONS_EVENING") return;
    const linked = await getLinkedNightOnCallShifts(shift);
    if (shouldCreate) {
      if (linked.some((s) => s.status === "PLANNED")) return;
      const nightRow = ROW_BY_TYPE.NIGHT_ON_CALL;
      await base44.entities.WorkShift.create({
        work_schedule_id: shift.work_schedule_id,
        date: shift.date,
        row_type: "NIGHT_ON_CALL",
        row_label: nightRow.label,
        row_order: nightRow.order,
        worker_id: shift.worker_id,
        worker_name: shift.worker_name,
        notes: "נוצר מתפעול ערב",
        status: "PLANNED",
        linked_source_shift_id: shift.id,
        auto_created_from: NIGHT_ON_CALL_SOURCE,
        created_by: userEmail || undefined,
      });
    } else {
      await Promise.all(linked.map((s) => base44.entities.WorkShift.delete(s.id)));
    }
    invalidate();
  };

  const handleCopyPrev = async () => {
    if (!canManage) return;
    setBusy(true);
    try {
      const prevStart = addDays(weekStart, -7);
      const prevScheds = await base44.entities.WorkSchedule.filter({ week_start_date: prevStart });
      if (!prevScheds[0]) {
        toast({ description: "לא נמצא סידור בשבוע הקודם", variant: "destructive" });
        setBusy(false);
        return;
      }
      if (shifts.length > 0) {
        const ok = window.confirm("כבר קיימים משמרות בשבוע זה. להעתיק בכל זאת? (המשמרות הקיימות יישארו)");
        if (!ok) { setBusy(false); return; }
      }
      const prevShifts = await base44.entities.WorkShift.filter(
        { work_schedule_id: prevScheds[0].id, status: "PLANNED" }, "date", 500
      );
      if (prevShifts.length === 0) {
        toast({ description: "אין משמרות להעתקה בשבוע הקודם" });
        setBusy(false);
        return;
      }
      const target = await ensureSchedule();
      await base44.entities.WorkShift.bulkCreate(prevShifts.map((s) => {
        const isCleaning = s.row_type === "HOUSEKEEPING_MORNING" || s.row_type === "HOUSEKEEPING_EVENING";
        return {
          work_schedule_id: target.id,
          date: addDays(s.date, 7),
          row_type: s.row_type,
          row_label: s.row_label,
          row_order: s.row_order,
          worker_id: isCleaning ? "" : (s.worker_id || undefined),
          worker_name: isCleaning ? "" : (s.worker_name || undefined),
          start_time: isCleaning ? "" : (s.start_time || undefined),
          end_time: isCleaning ? "" : (s.end_time || undefined),
          worker_count: s.worker_count || undefined,
          notes: s.notes || undefined,
          status: "PLANNED",
          created_by: userEmail || undefined,
        };
      }));
      invalidate();
      toast({ description: `הועתקו ${prevShifts.length} משמרות מהשבוע הקודם (טיוטה)` });
    } catch (err) {
      toast({ description: err.message || "שגיאה בהעתקה", variant: "destructive" });
    }
    setBusy(false);
  };

  const handlePublish = async () => {
    if (!canManage || !schedule) return;
    setBusy(true);
    await base44.entities.WorkSchedule.update(schedule.id, {
      status: "PUBLISHED",
      published_at: new Date().toISOString(),
      updated_by: userEmail || undefined,
    });
    invalidate();
    toast({ description: "הסידור פורסם — העובדים יכולים לראות את המשמרות שלהם" });
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