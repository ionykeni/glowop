import "@/components/activity-templates/activity-day-ui.css";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronRight, CalendarRange } from "lucide-react";
import TemplateOnlyNotice from "@/components/activity-templates/TemplateOnlyNotice";
import TemplateList from "@/components/activity-templates/TemplateList";
import TemplateFamilyView from "@/components/activity-templates/TemplateFamilyView";

export default function ActivityDayTemplates() {
  const [params, setParams] = useSearchParams();
  const family = params.get("family");
  const open = (id) => setParams({ family: id });

  return (
    <div className="activity-day-ui activity-day-page min-h-screen bg-background" dir="rtl">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div className="activity-day-header flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarRange className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-bold text-slate-800">תבניות ימי פעילות</h1>
          </div>
          {family ? (
            <button onClick={() => setParams({})} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
              <ChevronRight className="w-4 h-4" /> לרשימת התבניות
            </button>
          ) : (
            <div className="flex items-center gap-4">
              <Link to="/activity-day-templates/executions" className="text-sm text-primary hover:underline">ימי פעילות שאושרו</Link>
              <Link to="/admin" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
                <ChevronRight className="w-4 h-4" /> לניהול
              </Link>
            </div>
          )}
        </div>
        <TemplateOnlyNotice />
        {family
          ? <TemplateFamilyView key={family} familyId={family} onFamilyCreated={open} />
          : <TemplateList onOpen={open} onCreate={() => open("new")} />}
      </div>
    </div>
  );
}