import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useRoleContext } from "@/lib/RoleContext";
import { Button } from "@/components/ui/button";
import { CalendarClock, Download } from "lucide-react";
import { addDays, getWeekStart } from "@/lib/workScheduleConfig";
import { downloadIcsCalendar } from "@/lib/shiftCalendarExport";
import WeeklyShiftDays from "@/components/work-schedule/WeeklyShiftDays";
import WorkerShiftRequestModal from "@/components/work-schedule/WorkerShiftRequestModal";
import WorkerRequestsList from "@/components/work-schedule/WorkerRequestsList";

export default function MyShifts() {
  const { internalUser } = useRoleContext();
  const [weekStart, setWeekStart] = useState(() => getWeekStart());
  const [tab, setTab] = useState("shifts");
  const [requestOpen, setRequestOpen] = useState(false);
  const queryClient = useQueryClient();
  const internalUserId = internalUser?.id || "";
  const email = (internalUser?.email || "").trim().toLowerCase();
  const { data: profile = null, isLoading: loadingProfile } = useQuery({ queryKey: ["myWorkerProfile", internalUserId, email], enabled: !!internalUserId || !!email, queryFn: async () => {
    if (internalUserId) { const byId = await base44.entities.WorkerProfile.filter({ internal_user_id: internalUserId }); if (byId[0]) return byId[0]; }
    const byEmail = await base44.entities.WorkerProfile.filter({ internal_user_email: email }); return byEmail[0] || null;
  }});
  const { data: schedule = null, isLoading: loadingSchedule } = useQuery({ queryKey: ["myPublishedSchedule", weekStart], queryFn: async () => (await base44.entities.WorkSchedule.filter({ week_start_date: weekStart, status: "PUBLISHED" }))[0] || null });
  const { data: shifts = [], isLoading: loadingShifts } = useQuery({ queryKey: ["myWeeklyShifts", schedule?.id, profile?.id], enabled: !!schedule && !!profile, queryFn: async () => (await base44.entities.WorkShift.filter({ work_schedule_id: schedule.id, worker_id: profile.id, status: "PLANNED" }, "date", 100)).filter((shift) => shift.status !== "CANCELLED") });
  const { data: requests = [] } = useQuery({ queryKey: ["myWorkScheduleRequests", profile?.id], enabled: !!profile, queryFn: async () => (await base44.functions.invoke("manageWorkScheduleRequests", { action: "mine" })).data.requests || [] });
  const refreshRequests = () => { queryClient.invalidateQueries({ queryKey: ["myWorkScheduleRequests", profile?.id] }); queryClient.invalidateQueries({ queryKey: ["workScheduleRequests"] }); queryClient.invalidateQueries({ queryKey: ["workScheduleRequestsPendingCount"] }); };
  const cancelRequest = async (request) => { await base44.functions.invoke("manageWorkScheduleRequests", { action: "cancel", request_id: request.id }); refreshRequests(); };
  const loading = loadingProfile || loadingSchedule || loadingShifts;

  return <div className="max-w-screen-xl mx-auto px-4 py-6 space-y-4" dir="rtl">
    <div className="flex items-center gap-2"><CalendarClock className="w-5 h-5 text-primary" /><h1 className="text-xl font-bold">המשמרות שלי</h1></div>
    <div className="flex gap-2 border-b pb-2"><Button size="sm" variant={tab === "shifts" ? "default" : "ghost"} onClick={() => setTab("shifts")}>המשמרות שלי</Button><Button size="sm" variant={tab === "requests" ? "default" : "ghost"} onClick={() => setTab("requests")}>הבקשות שלי</Button></div>
    {tab === "shifts" ? <>
      <div className="flex gap-2 flex-wrap"><Button size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, -7))}>שבוע קודם</Button><Button size="sm" variant="outline" onClick={() => setWeekStart(getWeekStart())}>השבוע</Button><Button size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, 7))}>שבוע הבא</Button><Button size="sm" variant="secondary" onClick={() => downloadIcsCalendar(shifts)} disabled={!shifts.length}><Download className="w-4 h-4" /> ייצוא המשמרות שלי</Button></div>
      <p className="text-[11px] text-slate-400">הוספת משמרת ליומן היא ייצוא חד-פעמי — שינויים עתידיים במשמרות לא יתעדכנו אוטומטית ביומן.</p>
      {loading ? <div className="text-center py-10 text-slate-400">טוען...</div> : !profile ? <div className="rounded-xl border bg-slate-50 p-6 text-center text-sm">לא נמצא פרופיל עובד מקושר למשתמש שלך</div> : !schedule ? <div className="rounded-xl border bg-slate-50 p-6 text-center text-sm">אין סידור עבודה מפורסם לשבוע זה</div> : <WeeklyShiftDays weekStart={weekStart} shifts={shifts} />}
    </> : <>
      {!profile ? <div className="rounded-xl border bg-slate-50 p-6 text-center text-sm">לא נמצא פרופיל עובד מקושר למשתמש שלך</div> : <><div className="flex justify-end"><Button onClick={() => setRequestOpen(true)}>בקשה חדשה</Button></div><WorkerRequestsList requests={requests} onCancel={cancelRequest} /></>}
    </>}
    {requestOpen && profile && <WorkerShiftRequestModal open={requestOpen} onClose={() => setRequestOpen(false)} shifts={shifts} onCreated={refreshRequests} />}
  </div>;
}