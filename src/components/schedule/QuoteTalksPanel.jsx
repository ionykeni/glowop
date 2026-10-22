import { useMemo, useState } from "react";
import { CheckCircle2, Clock, GitBranch, Plus, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { opWrite } from "@/lib/operationalWrites";
import { toast } from "sonner";

/**
 * Parses lecture_lines and workshop_lines from a quote into a stable talks array.
 * Returns [{ quote_item_id, name, type }]
 */
export function extractQuoteTalks(quote) {
  if (!quote) return [];
  const talks = [];
  const parseSafe = (field) => { try { return JSON.parse(field || "[]") || []; } catch { return []; } };
  parseSafe(quote.lecture_lines).forEach((l, i) => {
    if (l.name) talks.push({ quote_item_id: `lecture__${i}`, name: l.name, type: "הרצאה" });
  });
  parseSafe(quote.workshop_lines).forEach((l, i) => {
    if (l.name) talks.push({ quote_item_id: `workshop__${i}`, name: l.name, type: "סדנה" });
  });
  return talks;
}

/**
 * Shows quote talks (lectures + workshops) with scheduled/unscheduled status.
 * Buttons open the unified Add Activity form via onOpenActivityForm prop.
 *
 * Props:
 *   onOpenActivityForm(prefillData) — opens Add Activity form in ScheduleAndMealsTab
 */
export default function QuoteTalksPanel({
  quote,
  scheduleItems = [],
  clientSuggestions = [],
  groupId,
  profileId,
  group,
  activitySpaces = [],
  onScheduleChanged,
  onOpenActivityForm,
}) {
  const [showUnscheduledOnly, setShowUnscheduledOnly] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);

  const handleCancelSingle = async (itemId) => {
    if (!window.confirm("לבטל שיבוץ זה?")) return;
    setCancellingId(itemId);
    await opWrite.GroupScheduleItem.update(itemId, { status: "CANCELLED" });
    setCancellingId(null);
    toast.success("שיבוץ בוטל");
    onScheduleChanged?.();
  };

  const handleCancelSplit = async (items) => {
    if (!window.confirm(`לבטל את כל ${items.length} השיבוצים המפוצלים?`)) return;
    setCancellingId("split");
    for (const item of items) {
      await opWrite.GroupScheduleItem.update(item.id, { status: "CANCELLED" }).catch(() => {});
    }
    setCancellingId(null);
    toast.success("שיבוץ מפוצל בוטל");
    onScheduleChanged?.();
  };

  const talks = useMemo(() => extractQuoteTalks(quote), [quote]);

  // All ACTIVE schedule items with this quote_item_id, grouped by quote_item_id
  const scheduledByQuoteItem = useMemo(() => {
    const map = {};
    scheduleItems
      .filter(i => i.quote_item_id && i.status === "ACTIVE")
      .forEach(i => {
        if (!map[i.quote_item_id]) map[i.quote_item_id] = [];
        map[i.quote_item_id].push(i);
      });
    return map;
  }, [scheduleItems]);

  const suggestionMap = useMemo(() => {
    const map = {};
    clientSuggestions.forEach(s => { if (s.quote_item_id) map[s.quote_item_id] = s; });
    return map;
  }, [clientSuggestions]);

  if (talks.length === 0) return null;

  const unscheduledCount = talks.filter(t => !scheduledByQuoteItem[t.quote_item_id]).length;
  const visible = showUnscheduledOnly ? talks.filter(t => !scheduledByQuoteItem[t.quote_item_id]) : talks;

  const handleOpenForm = (talk, suggestion) => {
    onOpenActivityForm?.({
      date: suggestion?.date || group?.arrival_date || "",
      start_time: suggestion?.start_time || "09:00",
      end_time: suggestion?.end_time || "10:00",
      activity_name: talk.name,
      quote_item_id: talk.quote_item_id,
      notes: suggestion?.notes || "",
    });
  };

  return (
    <section dir="rtl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2 text-slate-800 text-sm">
          🎤 הרצאות וסדנאות מההצעה
          {unscheduledCount > 0 && (
            <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-300 rounded-full px-2 py-0.5 font-bold">
              {unscheduledCount} טרם שובצו
            </span>
          )}
        </h3>
        {talks.length > 1 && (
          <button
            type="button"
            onClick={() => setShowUnscheduledOnly(v => !v)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full border transition-colors",
              showUnscheduledOnly
                ? "bg-amber-50 border-amber-300 text-amber-700 font-semibold"
                : "border-slate-200 text-slate-500 hover:border-slate-300"
            )}
          >
            {showUnscheduledOnly ? "הצג הכל" : "הצג רק טרם שובצו"}
          </button>
        )}
      </div>

      <div className="space-y-2">
        {visible.map(talk => {
          const scheduledItems = scheduledByQuoteItem[talk.quote_item_id] || [];
          const isScheduled = scheduledItems.length > 0;
          const isSplit = scheduledItems.length > 1;
          const suggestion = suggestionMap[talk.quote_item_id];

          return (
            <div
              key={talk.quote_item_id}
              className={cn(
                "rounded-xl border px-4 py-3 flex items-start justify-between gap-3",
                isScheduled ? "bg-emerald-50 border-emerald-200" : "bg-amber-50/60 border-amber-200"
              )}
            >
              <div className="flex-1 space-y-1 min-w-0">
                {/* Talk title */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0",
                    talk.type === "הרצאה"
                      ? "bg-blue-100 text-blue-700 border-blue-200"
                      : "bg-purple-100 text-purple-700 border-purple-200"
                  )}>
                    {talk.type}
                  </span>
                  <span className="font-semibold text-sm text-slate-800">{talk.name}</span>
                </div>

                {/* Scheduled: show actual details */}
                {isScheduled && (
                  <div className="space-y-0.5">
                    {isSplit ? (
                      <div className="space-y-1">
                        <p className="text-xs text-emerald-700 font-semibold">
                          📅 {scheduledItems[0].date} · {scheduledItems[0].start_time}–{scheduledItems[0].end_time}
                        </p>
                        {scheduledItems.map((item, idx) => (
                          <p key={item.id} className="text-xs text-emerald-600 mr-4">
                            {idx + 1}. {item.activity_space_code || "ללא מרחב"} · {item.pax || "—"} משתתפים
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-emerald-700">
                        📅 {scheduledItems[0].date} · {scheduledItems[0].start_time}–{scheduledItems[0].end_time}
                        {scheduledItems[0].activity_space_code && ` · ${scheduledItems[0].activity_space_code}`}
                      </p>
                    )}
                  </div>
                )}

                {/* Unscheduled: show client suggestion if any */}
                {!isScheduled && suggestion && (
                  <div className="text-xs text-slate-500 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 mt-1 space-y-0.5">
                    <p className="font-semibold text-slate-600">💬 הצעת לקוח:</p>
                    {suggestion.date && <p>תאריך מועדף: {suggestion.date}</p>}
                    {(suggestion.start_time || suggestion.end_time) && (
                      <p>שעות: {suggestion.start_time || "—"}–{suggestion.end_time || "—"}</p>
                    )}
                    {suggestion.notes && <p>הערה: {suggestion.notes}</p>}
                  </div>
                )}

                {!isScheduled && !suggestion && (
                  <p className="text-xs text-slate-400 mt-0.5">לא נשלחה הצעת מועד</p>
                )}
              </div>

              {/* Right side: status badge + action buttons */}
              <div className="shrink-0 flex flex-col items-end gap-2 mt-0.5">
                {isScheduled ? (
                  isSplit ? (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 rounded-full px-2.5 py-1">
                      <GitBranch className="w-3 h-3" /> שובץ מפוצל ({scheduledItems.length})
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 rounded-full px-2.5 py-1">
                      <CheckCircle2 className="w-3 h-3" /> שובץ
                    </span>
                  )
                ) : (
                  <span className="flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded-full px-2.5 py-1">
                    <Clock className="w-3 h-3" /> טרם שובץ
                  </span>
                )}

                {/* Scheduled: edit / cancel buttons */}
                {isScheduled && (
                  <div className="flex flex-col gap-1.5 items-end mt-1">
                    {!isSplit && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 px-2 gap-1"
                        onClick={() => handleOpenForm(talk, null)}
                      >
                        <Pencil className="w-3 h-3" /> ערוך שיבוץ
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={cancellingId !== null}
                      className="text-xs h-7 px-2 gap-1 text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => isSplit
                        ? handleCancelSplit(scheduledItems)
                        : handleCancelSingle(scheduledItems[0].id)
                      }
                    >
                      <Trash2 className="w-3 h-3" />
                      {isSplit ? "ביטול שיבוץ מפוצל" : "ביטול שיבוץ"}
                    </Button>
                  </div>
                )}

                {/* Unscheduled: schedule buttons — all open the unified form */}
                {!isScheduled && (
                  <div className="flex flex-col gap-1.5 items-end">
                    <div className="flex gap-1.5">
                      {suggestion ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7 px-2 gap-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                            onClick={() => handleOpenForm(talk, suggestion)}
                          >
                            <Pencil className="w-3 h-3" /> ערוך ושבץ
                          </Button>
                          <Button
                            size="sm"
                            className="text-xs h-7 px-2 gap-1 bg-amber-500 hover:bg-amber-600 text-white"
                            onClick={() => handleOpenForm(talk, suggestion)}
                          >
                            <Plus className="w-3 h-3" /> שבץ לפי ההצעה
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 px-2 gap-1"
                          onClick={() => handleOpenForm(talk, null)}
                        >
                          <Plus className="w-3 h-3" /> שבץ ידנית
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {visible.length === 0 && showUnscheduledOnly && (
          <p className="text-sm text-emerald-600 text-center py-4 bg-emerald-50 border border-emerald-200 rounded-xl">
            ✅ כל ההרצאות והסדנאות שובצו!
          </p>
        )}
      </div>
    </section>
  );
}