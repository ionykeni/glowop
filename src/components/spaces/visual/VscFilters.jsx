import { SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import VscFilterMenu from "./VscFilterMenu";

// Wide container: three dropdowns. Narrow (< 800px): one "סינון" button with all filters as chips.
export default function VscFilters({ groups, filters, onChange }) {
  const sections = [
    { key: "space", label: "מרחב", options: groups.spaces },
    { key: "group", label: "קבוצה", options: groups.groups },
    { key: "type", label: "סוג קבוצה", options: groups.types },
  ];
  const active = sections.filter(s => filters[s.key] !== "all").length;
  const set = (key, value) => onChange({ ...filters, [key]: value });
  return (
    <>
      <div className="vsc-filters-wide items-center gap-2 flex-wrap">
        {sections.map(s => <VscFilterMenu key={s.key} label={s.label} options={s.options} value={filters[s.key]} onChange={v => set(s.key, v)} />)}
      </div>
      <div className="vsc-filters-compact">
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="vsc-chipbtn inline-flex items-center gap-2 h-9">
              <SlidersHorizontal className="w-4 h-4" /> סינון
              {active > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded bg-primary text-primary-foreground text-[11px] font-bold grid place-items-center">{active}</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(320px,92vw)] p-3 max-h-[70vh] overflow-y-auto" align="start" dir="rtl">
            {sections.map((s, i) => (
              <div key={s.key} className={i ? "mt-3 pt-3 border-t border-border" : ""}>
                <p className="text-[11px] font-semibold text-muted-foreground mb-2">{s.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {s.options.map(o => (
                    <button key={o.value} type="button" className="vsc-chipbtn" aria-pressed={filters[s.key] === o.value} onClick={() => set(s.key, o.value)}>{o.label}</button>
                  ))}
                </div>
              </div>
            ))}
            <button type="button" className="mt-3 text-xs font-semibold text-primary hover:underline" onClick={() => onChange({ space: "all", group: "all", type: "all" })}>נקה הכל</button>
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}