import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useRoleContext } from "@/lib/RoleContext";
import SleepingReportTab from "@/components/mechina/sleeping-report/SleepingReportTab";
import AdminSleepingReports from "@/components/mechina/sleeping-report/AdminSleepingReports";

export default function MechinaSleepingReport() {
  const { role } = useRoleContext();
  const [chosen, setChosen] = useState("");
  const isMechina = role === "MECHINA_USER";
  const { data, isLoading, error } = useQuery({
    queryKey: ["sleepingReportOwnGroups"], enabled: isMechina,
    queryFn: async () => {
      const r = await base44.functions.invoke("mechinaSleepingReport", { action: "my_groups" });
      if (!r.data.success) throw new Error(r.data.error);
      return r.data.groups;
    },
  });
  const groups = data || [];
  const groupId = groups.some(g => g.id === chosen) ? chosen : groups[0]?.id;
  return (
    <main className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5 text-foreground" dir="rtl">
      <header className="space-y-2">
        <h1 className="text-2xl font-heading">דיווח לינה בפועל</h1>
        <p className="text-sm text-muted-foreground">דיווח מידע לאחר ההגעה בלבד. אינו משנה שיבוצים, מספר משתתפים, ארוחות או נתונים תפעוליים.</p>
      </header>
      {!isMechina ? <AdminSleepingReports /> : isLoading ? <p>טוען מכינות...</p> : error ? <p role="alert" className="text-destructive">{error.message}</p> : !groupId ? <p>לא נמצאה מכינה מקושרת לחשבון זה.</p> : <>
        {groups.length > 1 && <label className="block text-sm">מכינה
          <select className="block w-full rounded-lg border border-border bg-card p-2" value={groupId} onChange={e => setChosen(e.target.value)}>
            {groups.map(g => <option key={g.id} value={g.id}>{g.group_name}</option>)}
          </select>
        </label>}
        <SleepingReportTab key={groupId} groupId={groupId} />
      </>}
    </main>
  );
}