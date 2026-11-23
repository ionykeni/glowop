import { ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PeriodNav({ label, onPrev, onNext, nextDisabled }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-2 py-1.5">
      <Button size="icon" variant="ghost" onClick={onPrev} aria-label="הקודם"><ChevronRight className="w-5 h-5" /></Button>
      <p className="text-sm font-bold">{label}</p>
      <Button size="icon" variant="ghost" onClick={onNext} disabled={nextDisabled} aria-label="הבא"><ChevronLeft className="w-5 h-5" /></Button>
    </div>
  );
}