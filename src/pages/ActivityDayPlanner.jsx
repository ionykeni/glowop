import { Link } from "react-router-dom";
import { ChevronRight, Loader2, ClipboardList } from "lucide-react";
import useActivityDayPlan from "@/hooks/useActivityDayPlan";
import PreviewOnlyBanner from "@/components/activity-planning/PreviewOnlyBanner";
import PlanTemplateSection from "@/components/activity-planning/PlanTemplateSection";
import EligibleGroupsSection from "@/components/activity-planning/EligibleGroupsSection";
import PlanStationCard from "@/components/activity-planning/PlanStationCard";
import PlanPreviewSection from "@/components/activity-planning/PlanPreviewSection";

export default function ActivityDayPlanner() {
  const templateId = new URLSearchParams(window.location.search).get("template");
  const plan = useActivityDayPlan(templateId);
  const { tplQuery, template } = plan;

  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-bold text-slate-800">תכנון יום מהתבנית</h1>
          </div>
          <Link to={template ? `/activity-day-templates?family=${template.family_id}` : "/activity-day-templates"} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ChevronRight className="w-4 h-4" /> לתבנית
          </Link>
        </div>
        <PreviewOnlyBanner />
        {!templateId ? (
          <p className="text-sm text-red-600 text-center py-10">לא נבחרה תבנית</p>
        ) : tplQuery.isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
        ) : !template ? (
          <p className="text-sm text-red-600 text-center py-10">{tplQuery.data?.error || "טעינת התבנית נכשלה"}</p>
        ) : (
          <>
            <PlanTemplateSection template={template} date={plan.date} onDateChange={plan.setDate} />
            <EligibleGroupsSection plan={plan} />
            <section className="space-y-2">
              <h2 className="text-sm font-bold text-slate-500">ג. תחנות</h2>
              {plan.stations.map((s, i) => (
                <PlanStationCard key={s.station_id} station={s} index={i} spaces={plan.spaces} groups={plan.groups}
                  defaultCount={plan.defaultCount} onChange={patch => plan.updateStation(s.station_id, patch)} />
              ))}
            </section>
            <PlanPreviewSection plan={plan} />
          </>
        )}
      </div>
    </div>
  );
}