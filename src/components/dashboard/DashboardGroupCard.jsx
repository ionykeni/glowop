import { Link } from "react-router-dom";
import { Users, ChevronLeft, CheckCircle2, Clock, UtensilsCrossed, CalendarDays, StickyNote } from "lucide-react";

export default function DashboardGroupCard({ group, profile, mealsToday = 0, activitiesToday = 0, mode, sleepingPending = false }) {
  // mode: "arriving" | "sleeping" | "departing" | "dayuse"
  const isDayUse = group.group_type === "DAY_USE" || mode === "dayuse";
  const hasDepartureLunch = profile && mode === "departing" &&
    (() => { try { const mp = JSON.parse(profile.meal_plan || "[]"); return mp.some(m => m.sandwich_instead === false && m.meal_type === "LUNCH"); } catch { return false; } })();

  const internalNotes = group.internal_notes || profile?.general_notes || null;

  return (
    <Link
      to={`/groups/${group.id}`}
      className="flex items-center justify-between gap-3 bg-card border border-border rounded-xl px-4 py-3 hover:border-primary/40 hover:bg-muted/20 transition-colors"
    >
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">{group.group_name}</span>
          <span className="text-xs text-muted-foreground flex items-center gap-0.5">
            <Users className="w-3 h-3" /> {profile?.total_pax ?? group.total_pax ?? "—"}
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          {mode === "arriving" && <span>הגעה: {group.arrival_date}</span>}
          {mode === "departing" && <span>עזיבה: {group.departure_date}</span>}
          {mode === "sleeping" && (
            <span>{group.arrival_date} — {group.departure_date}</span>
          )}

          {mode === "sleeping" && mealsToday > 0 && (
            <span className="flex items-center gap-0.5 text-amber-600">
              <UtensilsCrossed className="w-3 h-3" /> {mealsToday} ארוחות
            </span>
          )}
          {mode === "sleeping" && activitiesToday > 0 && (
            <span className="flex items-center gap-0.5 text-violet-600">
              <CalendarDays className="w-3 h-3" /> {activitiesToday} פעילויות
            </span>
          )}

          {mode === "departing" && hasDepartureLunch && (
            <span className="bg-amber-50 border border-amber-200 text-amber-700 rounded-full px-2 py-0.5 text-[10px]">
              ארוחת צהריים לפני עזיבה
            </span>
          )}
        </div>

        {isDayUse ? (
          <span className="text-[10px] bg-amber-50 border border-amber-200 text-amber-700 rounded-full px-2 py-0.5">☀️ באי יום</span>
        ) : profile && (
          <div className="flex items-center gap-1">
            {profile.sleeping_requirements_completed ? (
              <span className="text-[10px] flex items-center gap-0.5 text-emerald-600">
                <CheckCircle2 className="w-3 h-3" /> דרישות לינה ✓
              </span>
            ) : (
              <span className="text-[10px] flex items-center gap-0.5 text-amber-600">
                <Clock className="w-3 h-3" /> ממתין לדרישות לינה
              </span>
            )}
          </div>
        )}

        {sleepingPending && <span className="inline-flex rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">לינה ממתינה לשיבוץ</span>}

        {internalNotes && (
          <div className="flex items-start gap-1 mt-1 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
            <StickyNote className="w-3 h-3 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-800 leading-snug">{internalNotes}</p>
          </div>
        )}
      </div>
      <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0" />
    </Link>
  );
}