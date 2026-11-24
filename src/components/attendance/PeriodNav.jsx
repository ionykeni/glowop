import { ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const nav = "rounded-full text-muted-foreground hover:bg-sage hover:text-sage-foreground";

export default function PeriodNav({ label, onPrev, onNext, nextDisabled }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-full border border-warm-line/70 bg-card px-1.5 py-1 shadow-sm shadow-warm-line/30">
      <Button size="icon" variant="ghost" className={nav} onClick={onPrev} aria-label="הקודם"><ChevronRight className="h-5 w-5" /></Button>
      <p className="text-sm font-semibold">{label}</p>
      <Button size="icon" variant="ghost" className={nav} onClick={onNext} disabled={nextDisabled} aria-label="הבא"><ChevronLeft className="h-5 w-5" /></Button>
    </div>
  );
}