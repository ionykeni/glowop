import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Themed dropdown (button + styled list) — no native select.
export default function VscFilterMenu({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.value === value) || options[0];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="vsc-chipbtn inline-flex items-center gap-2 h-9" aria-label={label}>
          <span className="text-muted-foreground text-xs">{label}:</span>
          <span className="max-w-[160px] truncate font-semibold">{current.label}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-1 max-h-72 overflow-y-auto" align="start" dir="rtl">
        <div role="menu">
          {options.map(o => (
            <button key={o.value} type="button" role="menuitemradio" aria-checked={o.value === value} className="vsc-opt"
              onClick={() => { onChange(o.value); setOpen(false); }}>
              <Check className={`w-3.5 h-3.5 shrink-0 ${o.value === value ? "visible" : "invisible"}`} />
              <span className="truncate">{o.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}