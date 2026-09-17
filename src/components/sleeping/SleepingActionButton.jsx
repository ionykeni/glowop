import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const toneClasses = {
  neutral: "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900",
  constructive: "border-blue-200 bg-white text-blue-700 hover:bg-blue-50",
  destructive: "border-red-200 bg-white text-red-600 hover:border-red-300 hover:bg-red-50",
};

export default function SleepingActionButton({ tone = "neutral", className, children, ...props }) {
  return <Button type="button" size="sm" variant="outline" className={cn("h-7 gap-1 px-2.5 text-[11px] font-semibold shadow-none", toneClasses[tone], className)} {...props}>{children}</Button>;
}