import { useState, useMemo, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { sortActivitySpaces, getActivitySpaceDisplayName } from "@/lib/activitySpaceUtils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, RefreshCw, CalendarDays, UtensilsCrossed, GitBranch, X, Shuffle, Users } from "lucide-react";
import { ACTIVITY_CATALOG, catalogItemLabel } from "@/lib/activityCatalog.js";
import LogisticsFields, { LOGISTICS_DEFAULTS } from "./LogisticsFields";
import { toast } from "sonner";
import ScheduleItemRow from "./ScheduleItemRow";
import SplitActivityGroup from "./SplitActivityGroup";
import MealReservationRow from "./MealReservationRow";
import DuplicateMealModal from "./DuplicateMealModal";
import QuoteTalksPanel, { extractQuoteTalks } from "./QuoteTalksPanel";
import DietaryFields, { EMPTY_DIETS, parseDiets, mergeDiets } from "@/components/shared/DietaryFields";
import RoleGate from "@/components/RoleGate";
import SharedGroupSelector from "./SharedGroupSelector";
import { upsertReviewAlert } from "@/lib/reviewAlerts";

const MEAL_LABELS = { BREAKFAST: "ארוחת בוקר", LUNCH: "ארוחת צהריים", DINNER: "ארוחת ערב", OTHER: "אחר" };

const MEAL_DEFAULTS = {
  BREAKFAST: { start_time: "08:00", end_time: "10:00" },
  LUNCH:     { start_time: "12:45", end_time: "14:00" },
  DINNER:    { start_time: "18:30", end_time: "20:00" },
  OTHER:     { start_time: "12:00", end_time: "13:00" },
};

function autoDividePax(total, n) {
  if (!total || !n) return Array(n).fill("");
  const base = Math.floor(total / n);
  const remainder = total % n;
  return Array.from({ length: n }, (_, i) => (i < remainder ? base + 1 : base));
}

const EMPTY_MEAL = (type = "BREAKFAST") => ({
  date: "",
  meal_type: type,
  start_time: MEAL_DEFAULTS[type].start_time,
  end_time:   MEAL_DEFAULTS[type].end_time,
  pax: "", pax_sync_locked: false, sandwich_option: false, notes: ""
});

export default function ScheduleAndMealsTab({ groupId, profile, group, quotes = [], guestFormSubmission = null }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [addingSchedule, setAddingSchedule] = useState(false);
  const [sharedEnabled, setSharedEnabled] = useState(false);
  const [extraGroups, setExtraGroups] = useState([]);
  const [addingMeal, setAddingMeal] = useState(false);
  const [newMeal, setNewMeal] = useState(() => EMPTY_MEAL());
  const [newMealDiets, setNewMealDiets] = useState(() => mergeDiets(parseDiets(profile?.special_diets)));
  const [newMealError, setNewMealError] = useState(null);
  const [newScheduleError, setNewScheduleError] = useState(null);
  const [duplicateSourceMeal, setDuplicateSourceMeal] = useState(null);

  // Split state
  const [splitEnabled, setSplitEnabled] = useState(false);
  const emptySplitRow = () => ({ activity_space_id: "", pax: "", notes: "", ...LOGISTICS_DEFAULTS });
  const [splitRows, setSplitRows] = useState([emptySplitRow(), emptySplitRow()]);

  const profileId = profile?.id;
  const arrivalDate   = group?.arrival_date   || "";
  const departureDate = group?.departure_date || "";
  const groupType     = group?.group_type || "LODGING";

  // A group that already departed (today > departure_date) cannot get NEW activities —
  // protects analytics from backfilling a group that already left.
  const todayInJerusalem = () => {
    try { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }); }
    catch { return new Date().toISOString().slice(0, 10); }
  };
  const groupDeparted = !!(departureDate && todayInJerusalem() > departureDate);

  // Allowed meal date range by group type
  const mealMinDate = arrivalDate || undefined;
  const mealMaxDate = groupType === "DAY_USE" ? arrivalDate : (departureDate || undefined);

  // Default pax for meals: participant_count + staff_count (or total_pax fallback)
  const defaultMealPax = useMemo(() => {
    const participants = group?.participant_count ?? profile?.participant_count;
    const staff = group?.staff_count ?? profile?.staff_count;
    if (participants != null && staff != null) return participants + staff;
    if (participants != null) return participants;
    return group?.total_pax ?? profile?.total_pax ?? "";
  }, [group, profile]);

  // Resolved group participant count for pax auto-fill (for activities)
  const groupParticipantCount = useMemo(() =>
    group?.participant_count || group?.total_pax ||
    profile?.participant_count || profile?.total_pax || null,
    [group, profile]
  );

  // Default empty schedule with pax auto-filled
  const makeEmptySchedule = () => ({
    date: "", start_time: "09:00", end_time: "10:00",
    activity_name: "", requested_location: "", activity_space_id: null,
    quote_item_id: null, pax: groupParticipantCount ? String(groupParticipantCount) : "", notes: "",
    ...LOGISTICS_DEFAULTS,
  });

  const [newSchedule, setNewSchedule] = useState(makeEmptySchedule);

  // The approved quote (or first quote) for activity suggestions
  const activeQuote = quotes.find(q => q.status === "APPROVED") || quotes[0];
  const quoteTalks = extractQuoteTalks(activeQuote);

  // Parse client talk suggestions from GuestFormSubmission.schedule_notes
  const clientTalkSuggestions = useMemo(() => {
    if (!guestFormSubmission?.schedule_notes) return [];
    try {
      const rows = JSON.parse(guestFormSubmission.schedule_notes);
      return rows.filter(r => r.is_talk_suggestion && r.quote_item_id);
    } catch { return []; }
  }, [guestFormSubmission]);

  const { data: scheduleItems = [] } = useQuery({
    queryKey: ["groupScheduleItems", groupId],
    queryFn: () => base44.entities.GroupScheduleItem.filter({ group_id: groupId }),
    enabled: !!groupId,
    staleTime: 10_000,
  });

  const { data: mealItems = [] } = useQuery({
    queryKey: ["mealReservations", groupId],
    queryFn: () => base44.entities.MealReservation.filter({ group_id: groupId }),
    enabled: !!groupId,
  });

  const { data: activitySpaces = [] } = useQuery({
    queryKey: ["activitySpaces"],
    queryFn: () => base44.entities.ActivitySpace.list(),
  });

  const [lastSharedResult, setLastSharedResult] = useState(null);

  // ── Shared activity details: fetch linked items + group names for each unique shared_activity_id ──
  const [sharedDetailsMap, setSharedDetailsMap] = useState({}); // keyed by shared_activity_id

  useEffect(() => {
    const activeSharedItems = scheduleItems.filter(
      i => i.status === "ACTIVE" && i.shared_activity_id
    );
    const uniqueSharedIds = [...new Set(activeSharedItems.map(i => i.shared_activity_id))];
    if (uniqueSharedIds.length === 0) return;

    let cancelled = false;
    (async () => {
      const newMap = {};
      for (const sharedId of uniqueSharedIds) {
        try {
          const linked = await base44.entities.GroupScheduleItem.filter({
            shared_activity_id: sharedId,
            status: "ACTIVE",
          });

          // Resolve group names — fetch each group individually (no $in)
          const uniqueGroupIds = [...new Set(linked.map(l => l.group_id))];
          const groupNameMap = {};
          for (const gid of uniqueGroupIds) {
            try {
              const rows = await base44.entities.Group.filter({ id: gid });
              if (rows[0]) groupNameMap[gid] = rows[0].group_name;
            } catch {}
          }

          const totalPax = linked.reduce((sum, l) => sum + (Number(l.pax) || 0), 0);
          const linkedGroups = linked
            .filter(l => l.group_id !== groupId)
            .map(l => ({
              groupId: l.group_id,
              groupName: groupNameMap[l.group_id] || l.group_id,
              pax: Number(l.pax) || 0,
            }));

          newMap[sharedId] = { totalPax, linkedGroups };
        } catch {}
      }
      if (!cancelled) setSharedDetailsMap(newMap);
    })();

    return () => { cancelled = true; };
  }, [scheduleItems, groupId]);

  const invalidateMealCaches = () => {
    queryClient.invalidateQueries({ queryKey: ["mealReservations", groupId] });
    queryClient.invalidateQueries({ queryKey: ["mealReservations_kitchen"] });
    queryClient.invalidateQueries({ queryKey: ["mealReservations_kitchenReport"] });
    queryClient.invalidateQueries({ queryKey: ["kc-meals"] });
  };

  const invalidate = (extraGroupIds = []) => {
    queryClient.invalidateQueries({ queryKey: ["groupScheduleItems", groupId] });
    invalidateMealCaches();
    // Invalidate only the specific extra groups that received clones, not all schedule queries
    for (const gid of extraGroupIds) {
      queryClient.invalidateQueries({ queryKey: ["groupScheduleItems", gid] });
    }
  };

  // Duplicate an existing activity — opens the add form prefilled (date/time cleared)
  const handleDuplicateActivity = (item) => {
    if (groupDeparted) {
      toast.error("לא ניתן להוסיף פעילויות — הקבוצה עזבה את האתר");
      return;
    }
    setNewSchedule({
      ...makeEmptySchedule(),
      activity_name: item.activity_name,
      requested_location: item.requested_location || "",
      activity_space_id: item.activity_space_id || null,
      pax: item.pax ? String(item.pax) : (groupParticipantCount ? String(groupParticipantCount) : ""),
      notes: item.notes || "",
      needs_projector:    !!item.needs_projector,
      needs_screen:       !!item.needs_screen,
      needs_microphone:   !!item.needs_microphone,
      needs_sound:        !!item.needs_sound,
      needs_whiteboard:   !!item.needs_whiteboard,
      needs_chair_circle: !!item.needs_chair_circle,
      chairs_count:       item.chairs_count ?? "",
      logistics_other:    item.logistics_other || "",
      quote_item_id: null,
      // date/time intentionally left blank so admin must pick a new slot
      date: "",
      start_time: item.start_time || "09:00",
      end_time: item.end_time || "10:00",
    });
    setSplitEnabled(false);
    setSplitRows([
      { activity_space_id: "", pax: "" },
      { activity_space_id: "", pax: "" },
    ]);
    setNewScheduleError(null);
    setAddingSchedule(true);
    toast("שכפול פעילות — בחר תאריך חדש ושמור", { icon: "📋" });
    setTimeout(() => {
      document.getElementById("add-activity-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  // Open Add Activity form, optionally prefilled from a suggestion or quote talk
  const openActivityForm = (prefill = {}) => {
    if (groupDeparted) {
      toast.error("לא ניתן להוסיף פעילויות — הקבוצה עזבה את האתר");
      return;
    }
    const base = makeEmptySchedule();
    setNewSchedule({
      ...base,
      date: prefill.date || base.date,
      start_time: prefill.start_time || base.start_time,
      end_time: prefill.end_time || base.end_time,
      activity_name: prefill.activity_name || base.activity_name,
      quote_item_id: prefill.quote_item_id || null,
      notes: prefill.notes || base.notes,
      pax: groupParticipantCount ? String(groupParticipantCount) : base.pax,
      activity_space_id: null,
    });
    setSplitEnabled(false);
    setSplitRows([
      { ...emptySplitRow(), pax: groupParticipantCount ? String(Math.ceil(groupParticipantCount / 2)) : "" },
      { ...emptySplitRow(), pax: groupParticipantCount ? String(Math.floor(groupParticipantCount / 2)) : "" },
    ]);
    setNewScheduleError(null);
    setAddingSchedule(true);
    // Scroll to form
    setTimeout(() => {
      document.getElementById("add-activity-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  // ── Schedule handlers ──────────────────────────────────────────────────────
  const handleSaveScheduleItem = async (form) => {
    setSaving(true);
    try {
      const res = await base44.functions.invoke("saveGroupScheduleItem", { ...form });
      const data = res.data;
      if (!data?.success || data?.error) {
        invalidate();
        return data?.error || "השמירה נכשלה. נסה שוב.";
      }
      if (data?.converted_to_shared) {
        const extraIds = form.extra_group_ids || [];
        invalidate(extraIds);
        toast.success(`נוצרה פעילות משותפת ל-${data.group_count} קבוצות`);
      } else if (data?.updated_all) {
        invalidate();
        toast.success("הפעילות עודכנה בכל הקבוצות המשויכות");
      } else if (data?.unlinked) {
        invalidate();
        toast.success("הפעילות עודכנה ונותקה מהפעילות המשותפת");
      } else {
        invalidate();
        toast.success("פעילות נשמרה");
      }
      return null;
    } catch (err) {
      invalidate();
      return err?.response?.data?.error || err?.message || "השמירה נכשלה. הנתונים רועננו, נסה שוב.";
    } finally {
      setSaving(false);
    }
  };

  const handleCancelScheduleItem = async (id, scope = "one") => {
    const isSharedDelete = scope === "all";
    const msg = isSharedDelete
      ? "לבטל פעילות זו מכל הקבוצות המשויכות?"
      : "לבטל פעילות זו?";
    if (!window.confirm(msg)) return;

    if (isSharedDelete) {
      // Use deleteGroupScheduleItem backend function for all-scope
      const res = await base44.functions.invoke("deleteGroupScheduleItem", { id, delete_scope: "all" });
      if (res.data?.success) {
        toast.success("הפעילות נמחקה מכל הקבוצות המשויכות");
      } else {
        toast.error(res.data?.error || "שגיאה בביטול");
      }
    } else {
      // Check if this item has a shared_activity_id — need backend recompute
      const items = await base44.entities.GroupScheduleItem.filter({ id });
      const item = items[0];
      if (item?.shared_activity_id) {
        const res = await base44.functions.invoke("deleteGroupScheduleItem", { id, delete_scope: "one" });
        if (res.data?.success) {
          toast.success("הפעילות נמחקה מהקבוצה הזו בלבד");
        } else {
          toast.error(res.data?.error || "שגיאה בביטול");
        }
      } else {
        await base44.entities.GroupScheduleItem.update(id, { status: "CANCELLED" });
        toast.success("פעילות בוטלה");
      }
    }
    invalidate();
  };

  // Save edits for a split activity group — update each row via saveGroupScheduleItem
  const handleEditSplitGroup = async (updatedRows) => {
    setSaving(true);
    try {
      for (const row of updatedRows) {
        const res = await base44.functions.invoke("saveGroupScheduleItem", { ...row });
        if (res.data?.error) {
          invalidate();
          setSaving(false);
          return res.data.error;
        }
      }
      invalidate();
      toast.success("פעילות עודכנה");
      setSaving(false);
      return null;
    } catch (err) {
      invalidate();
      setSaving(false);
      return err?.response?.data?.error || err?.message || "השמירה נכשלה";
    }
  };

  const validateScheduleDate = (date) => {
    if (!date) return "יש למלא תאריך";
    if (arrivalDate && departureDate) {
      if (date < arrivalDate || date > departureDate) {
        return "לא ניתן לקבוע פעילות מחוץ לתאריכי הקבוצה";
      }
    }
    return null;
  };

  const resetAddActivityForm = () => {
    setAddingSchedule(false);
    setNewScheduleError(null);
    setSplitEnabled(false);
    setSplitRows([emptySplitRow(), emptySplitRow()]);
    setSharedEnabled(false);
    setExtraGroups([]);
    setNewSchedule(makeEmptySchedule());
    // Keep lastSharedResult visible after form closes
  };

  // Single-space save (with optional shared groups)
  const handleAddSchedule = async () => {
    setNewScheduleError(null);
    if (!newSchedule.activity_name.trim()) {
      setNewScheduleError("יש למלא שם פעילות");
      return;
    }
    const dateErr = validateScheduleDate(newSchedule.date);
    if (dateErr) { setNewScheduleError(dateErr); return; }
    if (!newSchedule.start_time || !newSchedule.end_time || newSchedule.start_time >= newSchedule.end_time) {
      setNewScheduleError("שעת הסיום חייבת להיות אחרי שעת ההתחלה");
      return;
    }
    // Validate shared: checkbox on but no group selected
    if (sharedEnabled && extraGroups.length === 0) {
      setNewScheduleError("יש לבחור לפחות קבוצה אחת לשיוך");
      return;
    }

    setSaving(true);
    setLastSharedResult(null);
    try {
      const isShared = sharedEnabled && extraGroups.length > 0;
      const payload = {
        ...newSchedule,
        group_id: groupId,
        operational_group_profile_id: profileId,
        source: "manual",
        status: "ACTIVE",
      };
      if (isShared) {
        payload.extra_group_ids = extraGroups.map(g => g.id);
      }

      const res = await base44.functions.invoke("saveGroupScheduleItem", payload);
      const data = res.data;

      // Surface any backend error — success:false or explicit error field
      if (!data?.success || data?.error) {
        setNewScheduleError(data?.error || "השמירה נכשלה. נסה שוב.");
        return;
      }

      if (data?.group_count > 1) {
        toast.success(`נוצרה פעילות משותפת ל-${data.group_count} קבוצות`);
        setLastSharedResult({
          groupCount: data.group_count,
          createdCount: data.created_count,
          sharedActivityId: data.shared_activity_id,
        });
        // Invalidate only the specific extra groups that received clones
        invalidate(extraGroups.map(g => g.id));
      } else {
        toast.success("פעילות נוספה");
        invalidate();
      }
      resetAddActivityForm();
    } catch (err) {
      const errMsg = err?.response?.data?.error || err?.message || "השמירה נכשלה. הנתונים רועננו, נסה שוב.";
      setNewScheduleError(errMsg);
      invalidate();
    } finally {
      setSaving(false);
    }
  };

  // Split save with rollback
  const handleAddSplitSchedule = async () => {
    setNewScheduleError(null);
    if (!newSchedule.activity_name.trim()) {
      setNewScheduleError("יש למלא שם פעילות");
      return;
    }
    const dateErr = validateScheduleDate(newSchedule.date);
    if (dateErr) { setNewScheduleError(dateErr); return; }
    if (!newSchedule.start_time || !newSchedule.end_time || newSchedule.start_time >= newSchedule.end_time) {
      setNewScheduleError("שעת הסיום חייבת להיות אחרי שעת ההתחלה");
      return;
    }
    if (splitRows.length < 2) { setNewScheduleError("יש לבחור לפחות שני מרחבים לפיצול"); return; }
    for (let i = 0; i < splitRows.length; i++) {
      if (!splitRows[i].activity_space_id) {
        setNewScheduleError(`יש לבחור מרחב פעילות (שורה ${i + 1})`);
        return;
      }
    }
    const ids = splitRows.map(r => r.activity_space_id);
    if (new Set(ids).size !== ids.length) {
      setNewScheduleError("לא ניתן לבחור את אותו מרחב פעמיים");
      return;
    }
    if (sharedEnabled && extraGroups.length === 0) {
      setNewScheduleError("יש לבחור לפחות קבוצה אחת לשיוך");
      return;
    }
    const isSharedSplit = sharedEnabled && extraGroups.length > 0;

    setSaving(true);
    const splitGroupId = crypto.randomUUID();
    const createdIds = [];
    try {
      for (let i = 0; i < splitRows.length; i++) {
        const row = splitRows[i];
        const res = await base44.functions.invoke("saveGroupScheduleItem", {
          group_id: groupId,
          operational_group_profile_id: profileId,
          date: newSchedule.date,
          start_time: newSchedule.start_time,
          end_time: newSchedule.end_time,
          activity_name: newSchedule.activity_name,
          activity_space_id: row.activity_space_id || null,
          quote_item_id: newSchedule.quote_item_id || null,
          pax: row.pax ? Number(row.pax) : null,
          notes: row.notes || null,
          needs_projector:    !!row.needs_projector,
          needs_screen:       !!row.needs_screen,
          needs_microphone:   !!row.needs_microphone,
          needs_sound:        !!row.needs_sound,
          needs_whiteboard:   !!row.needs_whiteboard,
          needs_chair_circle: !!row.needs_chair_circle,
          chairs_count:       row.chairs_count ? Number(row.chairs_count) : null,
          logistics_other:    row.logistics_other || null,
          split_group_id: splitGroupId,
          split_index: i + 1,
          split_total: splitRows.length,
          ...(isSharedSplit ? { extra_group_ids: extraGroups.map(g => g.id) } : {}),
          source: "manual",
          status: "ACTIVE",
        });
        if (!res.data?.success || res.data?.error) {
          // Rollback
          for (const cid of createdIds) {
            await base44.entities.GroupScheduleItem.update(cid, { status: "CANCELLED" }).catch(() => {});
          }
          invalidate();
          setNewScheduleError(res.data?.error || "השמירה נכשלה. נסה שוב.");
          setSaving(false);
          return;
        }
        createdIds.push(...(res.data.created_ids || (res.data.item ? [res.data.item.id] : [])));
      }
      if (isSharedSplit) {
        toast.success(`שיבוץ מפוצל ומשותף נשמר — ${splitRows.length} מרחבים, ${extraGroups.length + 1} קבוצות`);
        invalidate(extraGroups.map(g => g.id));
      } else {
        toast.success(`שיבוץ מפוצל נשמר — ${splitRows.length} מרחבים`);
        invalidate();
      }
      resetAddActivityForm();
    } catch (err) {
      for (const cid of createdIds) {
        await base44.entities.GroupScheduleItem.update(cid, { status: "CANCELLED" }).catch(() => {});
      }
      invalidate();
      setNewScheduleError(err?.response?.data?.error || err?.message || "השמירה נכשלה. הנתונים רועננו, נסה שוב.");
    } finally {
      setSaving(false);
    }
  };

  // ── Meal handlers ──────────────────────────────────────────────────────────
  const handleSaveMealItem = async (form, item) => {
    setSaving(true);
    try {
      if (form.id) {
        const oldSandwich = !!item?.sandwich_option;
        const newSandwich = !!form.sandwich_option;
        await base44.entities.MealReservation.update(form.id, form);

        if (oldSandwich !== newSandwich) {
          const direction = newSandwich
            ? {
                title: "🍽️ → 🥪 שינוי סוג ארוחה",
                message: "מארוחה רגילה לסנדוויצ'ים",
              }
            : {
                title: "🥪 → 🍽️ שינוי סוג ארוחה",
                message: "מסנדוויצ'ים לארוחה רגילה",
              };
          const mealLabel = MEAL_LABELS[form.meal_type] || form.meal_type || "אחר";
          const timeLabel = form.start_time
            ? `${form.start_time}${form.end_time ? `–${form.end_time}` : ""}`
            : "לא צוינה";
          const details = `סוג ארוחה: ${mealLabel} · תאריך: ${form.date} · שעה: ${timeLabel} · מנות: ${form.pax}`;
          const previousValues = {
            sandwich_option: oldSandwich,
            meal_type: item.meal_type,
            date: item.date,
            start_time: item.start_time,
            end_time: item.end_time,
            pax: item.pax,
          };
          const newValues = {
            sandwich_option: newSandwich,
            meal_type: form.meal_type,
            date: form.date,
            start_time: form.start_time,
            end_time: form.end_time,
            pax: form.pax,
          };
          await upsertReviewAlert(
            groupId,
            "KITCHEN",
            "MEAL_CHANGED",
            direction.title,
            `${direction.message} · ${details}`,
            previousValues,
            newValues,
            form.id
          );
          queryClient.invalidateQueries({ queryKey: ["reviewAlerts"] });
          queryClient.invalidateQueries({ queryKey: ["openAlertCounts"] });
        }
      } else {
        await base44.entities.MealReservation.create(form);
      }
      invalidateMealCaches();
      toast.success("ארוחה נשמרה");
    } catch (err) {
      toast.error(err?.message || "שמירת הארוחה נכשלה");
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleToggleMealPaxLock = async (item, locked) => {
    if (saving) return;
    setSaving(true);
    try {
      const update = locked
        ? { pax_sync_locked: true }
        : { pax_sync_locked: false, pax: Number(group.total_pax) };
      await base44.entities.MealReservation.update(item.id, update);
      invalidateMealCaches();
      toast.success(locked ? "מספר הסועדים ננעל" : "הנעילה בוטלה ומספר הסועדים עודכן לפי הקבוצה");
    } catch (err) {
      toast.error(err?.message || "עדכון נעילת מספר הסועדים נכשל");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelMealItem = async (id) => {
    if (!window.confirm("לבטל ארוחה זו?")) return;
    await base44.entities.MealReservation.update(id, { status: "CANCELLED" });
    invalidate();
    toast.success("ארוחה בוטלה");
  };

  const handleAddMeal = async () => {
    setNewMealError(null);
    // Validation
    if (!newMeal.meal_type) { setNewMealError("יש לבחור סוג ארוחה"); return; }
    if (!newMeal.date) { setNewMealError("תאריך הארוחה חייב להיות בטווח שהות הקבוצה"); return; }
    if (mealMinDate && newMeal.date < mealMinDate) { setNewMealError("תאריך הארוחה חייב להיות בטווח שהות הקבוצה"); return; }
    if (mealMaxDate && newMeal.date > mealMaxDate) { setNewMealError("תאריך הארוחה חייב להיות בטווח שהות הקבוצה"); return; }
    if (!newMeal.pax || Number(newMeal.pax) <= 0) { setNewMealError("חסרה כמות משתתפים"); return; }
    setSaving(true);
    const createdMeal = await base44.entities.MealReservation.create({
      ...newMeal,
      pax: Number(newMeal.pax),
      special_diets_summary: JSON.stringify(newMealDiets),
      group_id: groupId,
      operational_group_profile_id: profileId,
      source: "manual",
      status: "ACTIVE",
    });
    setSaving(false);
    setNewMeal(EMPTY_MEAL());
    setNewMealDiets(mergeDiets(parseDiets(profile?.special_diets)));
    setNewMealError(null);
    setAddingMeal(false);
    invalidate();
    toast.success("ארוחה נוספה");
    // Offer to duplicate this manual meal to other stay dates —
    // excluded for COFFEE_CORNER (handled by the separate Coffee Corner module)
    if (createdMeal.meal_type !== "COFFEE_CORNER") {
      setDuplicateSourceMeal(createdMeal);
    }
  };

  const setNewMealType = (v) => {
    const defaults = MEAL_DEFAULTS[v] || MEAL_DEFAULTS.OTHER;
    setNewMeal(m => ({ ...m, meal_type: v, start_time: defaults.start_time, end_time: defaults.end_time }));
  };

  // ── Sync from GuestForm ─────────────────────────────────────────────────────
  const handleSync = async () => {
    if (!profileId) { toast.error("אין פרופיל תפעולי"); return; }
    if (!window.confirm("לסנכרן לוח זמנים וארוחות מהשאלון? שורות קיימות מסנכרון קודם יעודכנו. שורות ידניות לא יושפעו.")) return;
    setSyncing(true);
    console.log("[Sync Profile LIVE] clicked", { groupId, profileId, submissionId: guestFormSubmission?.id });
    console.log("[Sync Profile LIVE] sources", {
      hasGroup: !!group,
      hasProfile: !!profile,
      hasSubmission: !!guestFormSubmission,
    });
    try {
      console.log("[Sync Profile LIVE] before function call");
      const res = await base44.functions.invoke("prefillGroupScheduleAndMeals", {
        operational_group_profile_id: profileId,
      });
      console.log("[Sync Profile LIVE] response", res);
      if (res.data?.success) {
        if (res.data.partial) {
          toast.success("סנכרון חלקי בוצע — שאלון לקוח עדיין לא התקבל. הנתונים סונכרנו מתוך הקבוצה וההצעה.");
        } else {
          const { schedule, meals } = res.data;
          toast.success(`סנכרון הושלם: ${schedule.created} פעילויות חדשות, ${meals.created} ארוחות חדשות`);
        }
        invalidate();
      } else {
        toast.error(res.data?.error || "שגיאה בסנכרון");
      }
    } catch (err) {
      console.error("[Sync Profile LIVE] error", err);
      console.error("[Sync Profile LIVE] backend error", err?.response?.data);
      toast.error(err?.response?.data?.error || err?.message || "סנכרון נכשל");
    } finally {
      setSyncing(false);
    }
  };

  const MEAL_ORDER = { BREAKFAST: 0, LUNCH: 1, DINNER: 2, OTHER: 3 };
  const sortChron = (arr, isMeals = false) =>
    [...arr].sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      if (isMeals) {
        const mealCmp = (MEAL_ORDER[a.meal_type] ?? 99) - (MEAL_ORDER[b.meal_type] ?? 99);
        if (mealCmp !== 0) return mealCmp;
      }
      return (a.start_time || "").localeCompare(b.start_time || "");
    });

  // Quote-linked talks are managed/displayed in QuoteTalksPanel — exclude from the regular list.
  const activeScheduleRaw = sortChron(scheduleItems.filter(i => i.status === "ACTIVE" && !i.quote_item_id), false);

  // Group split activities together; single activities remain as-is
  const activeScheduleGrouped = useMemo(() => {
    const groups = [];
    const splitMap = {};
    for (const item of activeScheduleRaw) {
      if (item.split_group_id) {
        if (!splitMap[item.split_group_id]) {
          splitMap[item.split_group_id] = [];
          groups.push({ type: "split", key: item.split_group_id, items: splitMap[item.split_group_id] });
        }
        splitMap[item.split_group_id].push(item);
      } else {
        groups.push({ type: "single", key: item.id, item });
      }
    }
    return groups;
  }, [activeScheduleRaw]);

  const cancelledSchedule = scheduleItems.filter(i => i.status === "CANCELLED");
  const activeMeals = sortChron(mealItems.filter(i => i.status === "ACTIVE"), true);
  const cancelledMeals = mealItems.filter(i => i.status === "CANCELLED");

  // Resolved pax for split: use what admin typed, fallback to group count
  const splitTotalPax = Number(newSchedule.pax) || groupParticipantCount || null;

  // Helpers for split toggle pax auto-divide
  const handleSplitToggle = (enabled) => {
    setSplitEnabled(enabled);
    if (enabled) {
      const divided = autoDividePax(splitTotalPax, 2);
      setSplitRows([
        { ...emptySplitRow(), pax: divided[0] !== "" ? String(divided[0]) : "" },
        { ...emptySplitRow(), pax: divided[1] !== "" ? String(divided[1]) : "" },
      ]);
    }
  };

  const handleAutoDivide = () => {
    const divided = autoDividePax(splitTotalPax, splitRows.length);
    setSplitRows(rows => rows.map((r, i) => ({ ...r, pax: divided[i] !== "" ? String(divided[i]) : "" })));
  };

  const addSplitRow = () => {
    setSplitRows(rows => [...rows, emptySplitRow()]);
  };

  const removeSplitRow = (idx) => {
    if (splitRows.length <= 2) return;
    setSplitRows(rows => rows.filter((_, i) => i !== idx));
  };

  if (!profile) {
    return (
      <div className="text-center py-12 text-slate-400 text-sm">
        <p>אין פרופיל תפעולי מאושר לקבוצה זו.</p>
        <p className="text-xs mt-1">יש לאשר טופס קבלה כפרופיל תפעולי תחילה.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8" dir="rtl">

      {/* Sync button */}
      <RoleGate permission="MANAGE_ACTIVITIES">
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} className="gap-1.5 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "מסנכרן..." : "סנכרן מחדש מהשאלון"}
          </Button>
        </div>
      </RoleGate>

      {/* ── Quote Talks Panel ────────────────────────────────────────────────── */}
      {quoteTalks.length > 0 && (
        <QuoteTalksPanel
          quote={activeQuote}
          scheduleItems={scheduleItems}
          clientSuggestions={clientTalkSuggestions}
          groupId={groupId}
          profileId={profileId}
          group={group}
          activitySpaces={activitySpaces}
          onScheduleChanged={invalidate}
          onOpenActivityForm={openActivityForm}
        />
      )}

      {/* ── Shared activity result panel (temporary debug info) ─────────────── */}
      {lastSharedResult && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 text-xs text-violet-800 space-y-1 relative">
          <button
            type="button"
            onClick={() => setLastSharedResult(null)}
            className="absolute top-2 left-2 text-violet-400 hover:text-violet-700"
          ><X className="w-3.5 h-3.5" /></button>
          <p className="font-semibold">✓ פעילות משותפת נוצרה:</p>
          <p>• קבוצות: {lastSharedResult.groupCount}</p>
          <p>• רשומות שנוצרו: {lastSharedResult.createdCount}</p>
          <p className="font-mono text-[10px] text-violet-500">מזהה שיתוף: {lastSharedResult.sharedActivityId}</p>
        </div>
      )}

      {/* ── Schedule Section ─────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2 text-slate-800">
            <CalendarDays className="w-4 h-4" /> לוח פעילויות
          </h3>
          <RoleGate permission="MANAGE_ACTIVITIES">
            <Button size="sm" variant="outline" onClick={() => addingSchedule ? resetAddActivityForm() : openActivityForm()} disabled={groupDeparted} className="gap-1">
              <Plus className="w-3.5 h-3.5" /> הוסף פעילות
            </Button>
          </RoleGate>
        </div>
        {groupDeparted && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-3">
            הקבוצה עזבה את האתר — לא ניתן להוסיף פעילויות חדשות
          </p>
        )}

        {/* ── Unified Add Activity Form ─────────────────────────────────────── */}
        {addingSchedule && (
          <div id="add-activity-form" className="bg-slate-50 border border-primary/30 rounded-xl p-4 space-y-3 mb-3">
            <p className="text-xs font-semibold text-primary">פעילות חדשה</p>
            {arrivalDate && departureDate && (
              <p className="text-xs text-slate-400">תאריכים מותרים: {arrivalDate} עד {departureDate}</p>
            )}

            {/* Catalog prefill dropdown */}
            <div className="space-y-1">
              <label className="text-xs text-slate-500">בחר סדנה / הרצאה</label>
              <Select
                value="none"
                onValueChange={v => {
                  if (v === "none") return;
                  const item = ACTIVITY_CATALOG.find((_, i) => String(i) === v);
                  if (!item) return;
                  setNewSchedule(s => ({
                    ...s,
                    activity_name: item.name,
                    notes: item.lecturer
                      ? item.lecturer + (s.notes ? " | " + s.notes : "")
                      : s.notes,
                  }));
                }}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="בחרו מתוך המאגר או הזינו פעילות ידנית" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— בחרו מתוך המאגר או הזינו פעילות ידנית —</SelectItem>
                  {ACTIVITY_CATALOG.map((item, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {catalogItemLabel(item)}
                      {item.audience ? ` (${item.audience})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">

              {/* Quote talk selector — always shown if quote has talks */}
              {quoteTalks.length > 0 && (
                <div className="space-y-1 col-span-2">
                  <label className="text-xs text-slate-500">פעילות מתוך הצעת המחיר</label>
                  <Select
                    value={newSchedule.quote_item_id || "none"}
                    onValueChange={v => {
                      if (v === "none") {
                        setNewSchedule(s => ({ ...s, quote_item_id: null }));
                      } else {
                        const talk = quoteTalks.find(t => t.quote_item_id === v);
                        setNewSchedule(s => ({ ...s, quote_item_id: v, activity_name: talk?.name || s.activity_name }));
                      }
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="— פעילות בהזנה ידנית —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— פעילות בהזנה ידנית —</SelectItem>
                      {quoteTalks.map(t => (
                        <SelectItem key={t.quote_item_id} value={t.quote_item_id}>
                          {t.type}: {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Activity name */}
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">
                  {newSchedule.quote_item_id ? "שם הפעילות" : "שם / סוג פעילות *"}
                </label>
                <Input
                  value={newSchedule.activity_name}
                  onChange={e => setNewSchedule(s => ({ ...s, activity_name: e.target.value }))}
                  placeholder="שם הפעילות"
                />
                {newSchedule.quote_item_id && (
                  <p className="text-[11px] text-slate-400">נמלא אוטומטית לפי ההצעה, ניתן לערוך</p>
                )}
              </div>

              {/* Date */}
              <div className="space-y-1">
                <label className="text-xs text-slate-500">תאריך *</label>
                <Input
                  type="date"
                  value={newSchedule.date}
                  min={arrivalDate || undefined}
                  max={departureDate || undefined}
                  onChange={e => setNewSchedule(s => ({ ...s, date: e.target.value }))}
                />
              </div>

              {/* Pax — always visible; in split mode it's the total for auto-divide */}
              <div className="space-y-1">
                <label className="text-xs text-slate-500">
                  {splitEnabled ? "סה״כ משתתפים לפיצול" : "מספר משתתפים"}
                </label>
                <Input
                  type="number" min="0"
                  value={newSchedule.pax}
                  onChange={e => setNewSchedule(s => ({ ...s, pax: e.target.value }))}
                  placeholder="0"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-500">שעת התחלה</label>
                <Input type="time" value={newSchedule.start_time} onChange={e => setNewSchedule(s => ({ ...s, start_time: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">שעת סיום</label>
                <Input type="time" value={newSchedule.end_time} onChange={e => setNewSchedule(s => ({ ...s, end_time: e.target.value }))} />
              </div>

              {/* Single-space selector — only when NOT split */}
              {!splitEnabled && (
                <div className="space-y-1 col-span-2">
                  <label className="text-xs text-slate-500">מרחב פעילות</label>
                  <Select
                    value={newSchedule.activity_space_id || "none"}
                    onValueChange={v => setNewSchedule(s => ({ ...s, activity_space_id: v === "none" ? null : v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="לא הוקצה (אופציונלי)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— לא הוקצה —</SelectItem>
                      {sortActivitySpaces(activitySpaces).map(sp => (
                        <SelectItem key={sp.id} value={sp.id}>{getActivitySpaceDisplayName(sp)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">הערות</label>
                <Input value={newSchedule.notes} onChange={e => setNewSchedule(s => ({ ...s, notes: e.target.value }))} placeholder="הערות..." />
              </div>

              {/* Logistics — shown for single mode (split mode has logistics per row) */}
              {!splitEnabled && (
                <div className="col-span-2 border border-blue-100 rounded-lg p-3 bg-blue-50/30">
                  <LogisticsFields
                    value={newSchedule}
                    onChange={patch => setNewSchedule(s => ({ ...s, ...patch }))}
                  />
                </div>
              )}

              {/* ── Split toggle — ALWAYS visible ── */}
              <div className="col-span-2">
                <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                  <input
                    type="checkbox"
                    checked={splitEnabled}
                    onChange={e => handleSplitToggle(e.target.checked)}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <span className="flex items-center gap-1 text-xs text-blue-700 font-medium">
                    <GitBranch className="w-3 h-3" /> פיצול למספר מרחבים
                  </span>
                </label>
              </div>

              {/* ── Shared activity toggle — independent of split ── */}
              {(
                <div className="col-span-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                    <input
                      type="checkbox"
                      checked={sharedEnabled}
                      onChange={e => { setSharedEnabled(e.target.checked); if (!e.target.checked) setExtraGroups([]); }}
                      className="w-4 h-4 accent-violet-600"
                    />
                    <span className="flex items-center gap-1 text-xs text-violet-700 font-medium">
                      <Users className="w-3 h-3" /> לשייך לעוד קבוצות?
                    </span>
                  </label>
                </div>
              )}
            </div>

            {/* Split rows */}
            {splitEnabled && (
              <div className="space-y-2 border border-blue-200 rounded-lg p-3 bg-blue-50/40">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-blue-700">בחר מרחבים</p>
                  <button
                    type="button"
                    onClick={handleAutoDivide}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    <Shuffle className="w-3 h-3" /> פיצול אוטומטי לפי המספר שהוזן
                    {splitTotalPax ? ` (${splitTotalPax})` : ""}
                  </button>
                </div>
                {splitRows.map((row, idx) => (
                  <div key={idx} className="bg-white rounded-lg px-3 py-2 border border-blue-100 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-400 w-5 shrink-0">{idx + 1}.</span>
                      <div className="flex-1">
                        <Select
                          value={row.activity_space_id || "none"}
                          onValueChange={v => setSplitRows(rows => rows.map((r, i) => i === idx ? { ...r, activity_space_id: v === "none" ? "" : v } : r))}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="בחר מרחב..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— בחר מרחב —</SelectItem>
                            {sortActivitySpaces(activitySpaces)
                              .filter(sp => !splitRows.some((r, i) => i !== idx && r.activity_space_id === sp.id))
                              .map(sp => (
                                <SelectItem key={sp.id} value={sp.id}>{getActivitySpaceDisplayName(sp)}</SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="w-24 shrink-0">
                        <Input
                          type="number" min="0"
                          value={row.pax}
                          onChange={e => setSplitRows(rows => rows.map((r, i) => i === idx ? { ...r, pax: e.target.value } : r))}
                          placeholder="משתתפים"
                          className="h-8 text-xs"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSplitRow(idx)}
                        disabled={splitRows.length <= 2}
                        className="text-slate-300 hover:text-red-500 disabled:opacity-30 shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <Input
                      value={row.notes || ""}
                      onChange={e => setSplitRows(rows => rows.map((r, i) => i === idx ? { ...r, notes: e.target.value } : r))}
                      placeholder="הערות למרחב זה..."
                      className="h-7 text-xs"
                    />
                    <LogisticsFields
                      value={row}
                      onChange={patch => setSplitRows(rows => rows.map((r, i) => i === idx ? { ...r, ...patch } : r))}
                      compact
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addSplitRow}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
                >
                  <Plus className="w-3 h-3" /> הוסף מרחב נוסף
                </button>
                <p className="text-xs text-slate-400">
                  סה״כ משתתפים:{" "}
                  <span className="font-semibold text-slate-600">
                    {splitRows.reduce((s, r) => s + (Number(r.pax) || 0), 0)}
                  </span>
                  {groupParticipantCount && ` / ${groupParticipantCount} בקבוצה`}
                </p>
              </div>
            )}

            {/* Shared group selector */}
            {sharedEnabled && (
              <div className="border border-violet-200 rounded-lg p-3 bg-violet-50/40 space-y-2">
                <p className="text-xs font-semibold text-violet-700 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" /> שיוך לקבוצות נוספות
                </p>
                {splitEnabled && (
                  <p className="text-[11px] text-violet-500">
                    הפעילות המפוצלת תשותף במלואה — כל מרחב ישויך לקבוצות שנבחרו
                  </p>
                )}
                <SharedGroupSelector
                  currentGroupId={groupId}
                  selectedGroups={extraGroups}
                  onChange={setExtraGroups}
                />
              </div>
            )}

            {newScheduleError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{newScheduleError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={resetAddActivityForm}>ביטול</Button>
              {splitEnabled ? (
                <Button size="sm" onClick={handleAddSplitSchedule} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
                  {saving ? "שומר..." : "שמור שיבוץ מפוצל"}
                </Button>
              ) : (
                <Button size="sm" onClick={handleAddSchedule} disabled={saving}>
                  {saving
                    ? (sharedEnabled && extraGroups.length > 0 ? "שומר פעילות משותפת..." : "שומר...")
                    : "הוסף"}
                </Button>
              )}
            </div>
          </div>
        )}

        {activeScheduleGrouped.length === 0 && !addingSchedule ? (
          <p className="text-sm text-muted-foreground text-center py-6 border-2 border-dashed border-slate-200 rounded-xl">
            אין פעילויות עדיין — הוסף ידנית או סנכרן מהשאלון
          </p>
        ) : (
          <div className="space-y-2">
            {activeScheduleGrouped.map(entry =>
              entry.type === "split" ? (
                <SplitActivityGroup
                  key={entry.key}
                  items={entry.items}
                  activitySpaces={activitySpaces}
                  onCancel={handleCancelScheduleItem}
                  onLinkSave={handleSaveScheduleItem}
                  onDuplicate={handleDuplicateActivity}
                  onEditSave={handleEditSplitGroup}
                  groupDateRange={{ arrivalDate, departureDate }}
                  saving={saving}
                />
              ) : (
                <ScheduleItemRow
                  key={entry.key}
                  item={entry.item}
                  activitySpaces={activitySpaces}
                  quoteActivities={[]}
                  groupDateRange={{ arrivalDate, departureDate }}
                  groupName={group?.group_name || ""}
                  sharedDetails={entry.item.shared_activity_id ? sharedDetailsMap[entry.item.shared_activity_id] : undefined}
                  onSave={handleSaveScheduleItem}
                  onCancel={handleCancelScheduleItem}
                  onDuplicate={handleDuplicateActivity}
                  saving={saving}
                />
              )
            )}
          </div>
        )}

        {cancelledSchedule.length > 0 && (
          <details className="mt-3">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
              {cancelledSchedule.length} פעילויות מבוטלות
            </summary>
            <div className="space-y-2 mt-2">
              {cancelledSchedule.map(item => (
                <ScheduleItemRow
                  key={item.id}
                  item={item}
                  activitySpaces={activitySpaces}
                  quoteActivities={[]}
                  groupDateRange={{ arrivalDate, departureDate }}
                  groupName={group?.group_name || ""}
                  onSave={handleSaveScheduleItem}
                  onCancel={() => {}}
                  saving={saving}
                />
              ))}
            </div>
          </details>
        )}
      </section>

      {/* ── Meals Section ────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2 text-slate-800">
            <UtensilsCrossed className="w-4 h-4" /> ארוחות
          </h3>
          <RoleGate permission="MANAGE_MEALS">
            <Button size="sm" variant="outline" onClick={() => {
              if (addingMeal) {
                setAddingMeal(false);
                setNewMealError(null);
              } else {
                setNewMeal(m => ({ ...m, pax: String(defaultMealPax ?? "") }));
                setNewMealDiets(mergeDiets(parseDiets(profile?.special_diets)));
                setNewMealError(null);
                setAddingMeal(true);
              }
            }} className="gap-1">
              <Plus className="w-3.5 h-3.5" /> הוסף ארוחה
            </Button>
          </RoleGate>
        </div>

        {addingMeal && (
          <div className="bg-slate-50 border border-primary/30 rounded-xl p-4 space-y-3 mb-3">
            <p className="text-xs font-semibold text-primary">ארוחה חדשה (ידנית)</p>

            {/* No date warning */}
            {!mealMinDate ? (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                חסר תאריך לקבוצה — לא ניתן להוסיף ארוחה
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">תאריך *</label>
                <Input
                  type="date"
                  value={newMeal.date}
                  min={mealMinDate}
                  max={mealMaxDate}
                  onChange={e => setNewMeal(m => ({ ...m, date: e.target.value }))}
                />
                <p className="text-[10px] text-slate-400">תאריכים זמינים לפי שהות הקבוצה</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">סוג ארוחה *</label>
                <Select value={newMeal.meal_type} onValueChange={setNewMealType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(MEAL_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">שעת התחלה</label>
                <Input type="time" value={newMeal.start_time} onChange={e => setNewMeal(m => ({ ...m, start_time: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">שעת סיום</label>
                <Input type="time" value={newMeal.end_time} onChange={e => setNewMeal(m => ({ ...m, end_time: e.target.value }))} />
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">מספר משתתפים *</label>
                <Input type="number" min="1" value={newMeal.pax} onChange={e => setNewMeal(m => ({ ...m, pax: e.target.value }))} />
                {defaultMealPax && (
                  <p className="text-[10px] text-slate-400">כמות משתתפים הוגדרה אוטומטית לפי פרטי הקבוצה</p>
                )}
              </div>
              <div className="flex items-center gap-2 pt-1 col-span-2">
                <input
                  type="checkbox"
                  checked={!!newMeal.sandwich_option}
                  onChange={e => setNewMeal(m => ({ ...m, sandwich_option: e.target.checked }))}
                  className="w-4 h-4"
                />
                <label className="text-xs text-slate-600">כריכים במקום ארוחה חמה</label>
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-500">הערות למטבח</label>
                <Input value={newMeal.notes} onChange={e => setNewMeal(m => ({ ...m, notes: e.target.value }))} placeholder="הערות..." />
              </div>
            </div>

            {/* Dietary section */}
            <div className="border border-amber-200 rounded-xl px-3 py-3 bg-amber-50/40 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-amber-800">🍽️ צרכים תזונתיים ואלרגיות</p>
                {profile?.special_diets && (
                  <button
                    type="button"
                    onClick={() => setNewMealDiets(mergeDiets(parseDiets(profile.special_diets)))}
                    className="text-[10px] text-primary hover:underline"
                  >
                    טען מהפרופיל
                  </button>
                )}
              </div>
              <DietaryFields value={newMealDiets} onChange={setNewMealDiets} compact />
            </div>

            {newMealError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{newMealError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => { setAddingMeal(false); setNewMealError(null); }}>ביטול</Button>
              <Button size="sm" onClick={handleAddMeal} disabled={saving || !mealMinDate}>הוסף</Button>
            </div>
          </div>
        )}

        {activeMeals.length === 0 && !addingMeal ? (
          <p className="text-sm text-muted-foreground text-center py-6 border-2 border-dashed border-slate-200 rounded-xl">
            אין ארוחות עדיין — הוסף ידנית או סנכרן מהשאלון
          </p>
        ) : (
          <div className="space-y-2">
            {activeMeals.map(item => (
              <MealReservationRow
                key={item.id}
                item={item}
                onSave={handleSaveMealItem}
                onCancel={handleCancelMealItem}
                onToggleLock={handleToggleMealPaxLock}
                saving={saving}
                profileDiets={profile?.special_diets || null}
              />
            ))}
          </div>
        )}

        {cancelledMeals.length > 0 && (
          <details className="mt-3">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
              {cancelledMeals.length} ארוחות מבוטלות
            </summary>
            <div className="space-y-2 mt-2">
              {cancelledMeals.map(item => (
                <MealReservationRow
                  key={item.id}
                  item={item}
                  onSave={handleSaveMealItem}
                  onCancel={() => {}}
                  onToggleLock={handleToggleMealPaxLock}
                  saving={saving}
                  profileDiets={profile?.special_diets || null}
                />
              ))}
            </div>
          </details>
        )}
      </section>

      {/* Duplicate manual meal to other stay dates */}
      <DuplicateMealModal
        open={!!duplicateSourceMeal}
        sourceMeal={duplicateSourceMeal}
        arrivalDate={arrivalDate}
        departureDate={departureDate}
        group={group}
        existingMeals={mealItems}
        onClose={() => setDuplicateSourceMeal(null)}
        onDone={invalidate}
      />
    </div>
  );
}