import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Search, Loader2, ChevronLeft } from "lucide-react";
import { callTemplates } from "@/lib/activityDayTemplatesApi";
import TemplateStatusBadge from "./TemplateStatusBadge";

export default function TemplateList({ onOpen, onCreate }) {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["activity-day-templates", search],
    queryFn: () => callTemplates("list", { search }),
  });
  const families = data?.families || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="חיפוש לפי שם תבנית..." className="pr-9 bg-white" />
        </div>
        <Button onClick={onCreate} className="gap-1.5"><Plus className="w-4 h-4" /> תבנית חדשה</Button>
      </div>
      {data?.success === false && <p className="text-sm text-red-600">{data.error}</p>}
      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : families.length === 0 ? (
        <p className="text-center text-sm text-slate-500 py-10">{search ? "לא נמצאו תבניות" : "עדיין לא נוצרו תבניות"}</p>
      ) : (
        <div className="space-y-2">
          {families.map(f => (
            <button key={f.family_id} onClick={() => onOpen(f.family_id)}
              className="w-full text-right bg-white border border-slate-200 rounded-xl px-4 py-3 hover:border-primary/40 transition-colors flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 truncate">{f.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  גרסה {f.latest_version} · {f.station_count} תחנות
                  {f.ready_version && f.latest_status !== "READY" ? ` · גרסה מוכנה אחרונה: ${f.ready_version}` : ""}
                </p>
              </div>
              <TemplateStatusBadge status={f.latest_status} />
              <ChevronLeft className="w-4 h-4 text-slate-400" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}