import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import AttendanceHeader from "@/components/attendance/AttendanceHeader";
import ClockPanel from "@/components/attendance/ClockPanel";
import MyAttendanceHistory from "@/components/attendance/MyAttendanceHistory";
import ManagerDayView from "@/components/attendance/ManagerDayView";
import AttendanceReport from "@/components/attendance/AttendanceReport";
import PayrollHoursReport from "@/components/attendance/PayrollHoursReport";
import ManagerRequests from "@/components/attendance/ManagerRequests";
import { useAttendanceStatus } from "@/hooks/useAttendance";

const TABS = [
  { id: "clock", label: "שעון", clock: true },
  { id: "history", label: "השעות שלי", clock: true },
  { id: "manage", label: "ניהול", manager: true },
  { id: "requests", label: "בקשות תיקון שעות", manager: true },
  { id: "report", label: "דוחות", manager: true },
  { id: "payroll", label: "דוח שעות לשכר", manager: true },
];

export default function Attendance() {
  const [tab, setTab] = useState(null);
  const { data, isLoading, error } = useAttendanceStatus();
  const caller = data?.caller;
  const tabs = caller ? TABS.filter((t) => (t.clock && caller.can_clock) || (t.manager && caller.is_manager))
    .map((t) => (t.id === "requests" ? { ...t, count: data.pending_requests || 0 } : t)) : [];
  const current = tabs.find((t) => t.id === tab)?.id || tabs[0]?.id;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-cream" dir="rtl">
    <div className={`${current === "payroll" ? "max-w-6xl" : current === "report" ? "max-w-5xl" : "max-w-2xl"} mx-auto px-4 py-6 sm:py-8 space-y-5`}>
      <AttendanceHeader tabs={tabs} tab={current} onTab={setTab} />
      {isLoading && <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
      {error && (
        <div className="rounded-3xl border border-red-200/70 bg-red-50/70 p-6 text-center space-y-2">
          <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
          <p className="text-sm">{error.message}</p>
        </div>
      )}
      {data && current === "clock" && <ClockPanel status={data} />}
      {data && current === "history" && <MyAttendanceHistory />}
      {data && current === "manage" && <ManagerDayView />}
      {data && current === "report" && <AttendanceReport />}
      {data && caller?.is_manager && current === "payroll" && <PayrollHoursReport />}
      {data && current === "requests" && <ManagerRequests />}
    </div>
    </div>
  );
}