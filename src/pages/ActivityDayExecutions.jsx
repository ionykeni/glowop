import "@/components/activity-templates/activity-day-ui.css";
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, ChevronRight, Loader2 } from "lucide-react";
import { callManage } from "@/lib/activityDayManageApi";
import ExecutionListItem from "@/components/activity-day-manage/ExecutionListItem";

const FILTERS = [["upcoming", "קרובים"], ["past", "עברו"], ["all", "הכול"]];

export default function ActivityDayExecutions() {
  const [filter, setFilter] = useState("upcoming");
  const { data, isLoading } = useQuery({
    queryKey: ["activity-day-executions"],
    queryFn: async () => {
      const r = await callManage("list");
      if (!r.success) throw new Error(r.error || "שגיאה בטעינה");
      return r;
    },
  });
  const today = data?.today;
  const rows = (data?.executions || []).filter(e => filter === "all" || (filter === "past" ? e.date < today : e.date >= today));
  if (filter === "upcoming") rows.sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="activity-day-ui activity-day-page min-h-screen bg-background" dir="rtl">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div className="activity-day-header flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarCheck className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-bold text-slate-800">ימי פעילות שאושרו</h1>
          </div>
          <Link to="/activity-day-templates" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ChevronRight className="w-4 h-4" /> לתבניות
          </Link>
        </div>
        <div className="flex gap-2">
          {FILTERS.map(([k, label]) => (
            <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)} className={`text-sm font-medium px-4 py-2 rounded-md border ${filter === k ? "bg-primary text-primary-foreground border-primary" : "bg-white text-slate-600 border-slate-200"}`}>{label}</button>
          ))}
        </div>
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center text-sm text-slate-500 py-12 bg-white border border-slate-200 rounded-lg">אין ימי פעילות להצגה</div>
        ) : (
          <div className="space-y-2">{rows.map(ex => <ExecutionListItem key={ex.id} ex={ex} today={today} />)}</div>
        )}
      </div>
    </div>
  );
}