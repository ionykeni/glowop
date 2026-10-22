import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { opWrite } from "@/lib/operationalWrites";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Coffee, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { sortActivitySpaces, getActivitySpaceDisplayName } from "@/lib/activitySpaceUtils";
import RoleGate from "@/components/RoleGate";

const COFFEE_TYPES = [
  { value: "פינת קפה רגילה", label: "פינת קפה רגילה" },
  { value: "פינת קפה ועוגיות", label: "פינת קפה ועוגיות" },
  { value: "פינת קפה ומאפה", label: "פינת קפה ומאפה" },
  { value: "HOT_WATER_THERMOCAN_ONLY", label: "מיחם וטרמוקן בלבד" },
];
const coffeeTypeLabel = (value) => value === "HOT_WATER_THERMOCAN_ONLY" ? "מיחם וטרמוקן בלבד" : value || "פינת קפה רגילה";

const EMPTY_FORM = () => ({
  date: "",
  start_time: "10:00",
  end_time: "11:00",
  pax: "",
  coffee_corner_type: "פינת קפה רגילה",
  location_id: "",
  location_name_snapshot: "",
  notes: "",
});

export default function CoffeeCornerTab({ groupId, profile, group }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM());
  const [formError, setFormError] = useState(null);

  const profileId = profile?.id;
  const arrivalDate = group?.arrival_date || "";
  const departureDate = group?.departure_date || "";
  const groupType = group?.group_type || "LODGING";

  // Date range: DAY_USE = arrival date only; LODGING = arrival through departure
  const minDate = arrivalDate;
  const maxDate = groupType === "DAY_USE" ? arrivalDate : (departureDate || arrivalDate);

  // Default pax
  const defaultPax = useMemo(() => {
    const p = group?.participant_count ?? profile?.participant_count;
    const s = group?.staff_count ?? profile?.staff_count;
    if (p != null && s != null) return p + s;
    return group?.total_pax ?? profile?.total_pax ?? "";
  }, [group, profile]);

  const { data: requests = [] } = useQuery({
    queryKey: ["coffeeCornerRequests", groupId],
    queryFn: () => base44.entities.CoffeeCornerRequest.filter({ group_id: groupId }),
    enabled: !!groupId,
  });

  const { data: activitySpaces = [] } = useQuery({
    queryKey: ["activitySpaces"],
    queryFn: () => base44.entities.ActivitySpace.list(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["coffeeCornerRequests", groupId] });

  const activeRequests = requests
    .filter(r => r.status === "ACTIVE")
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.start_time || "").localeCompare(b.start_time || "");
    });

  const openAdd = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM(), pax: defaultPax ? String(defaultPax) : "" });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (req) => {
    setEditingId(req.id);
    setForm({
      date: req.date || "",
      start_time: req.start_time || "10:00",
      end_time: req.end_time || "11:00",
      pax: req.pax != null ? String(req.pax) : "",
      coffee_corner_type: req.coffee_corner_type || "פינת קפה רגילה",
      location_id: req.location_id || "",
      location_name_snapshot: req.location_name_snapshot || "",
      notes: req.notes || "",
    });
    setFormError(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setFormError(null);
  };

  const handleLocationChange = (spaceId) => {
    if (!spaceId || spaceId === "none") {
      setForm(f => ({ ...f, location_id: "", location_name_snapshot: "" }));
    } else {
      const space = activitySpaces.find(s => s.id === spaceId);
      setForm(f => ({
        ...f,
        location_id: spaceId,
        location_name_snapshot: space?.name || "",
      }));
    }
  };

  const validate = () => {
    if (!form.date) return "יש לבחור תאריך";
    if (minDate && form.date < minDate) return "התאריך מחוץ לטווח שהות הקבוצה";
    if (maxDate && form.date > maxDate) return "התאריך מחוץ לטווח שהות הקבוצה";
    if (!form.start_time) return "יש למלא שעת התחלה";
    if (!form.end_time) return "יש למלא שעת סיום";
    if (form.start_time >= form.end_time) return "שעת הסיום חייבת להיות אחרי שעת ההתחלה";
    if (!form.pax || Number(form.pax) <= 0) return "יש למלא כמות אנשים";
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { setFormError(err); return; }
    setSaving(true);
    const payload = {
      group_id: groupId,
      operational_group_profile_id: profileId,
      date: form.date,
      start_time: form.start_time,
      end_time: form.end_time,
      pax: Number(form.pax),
      coffee_corner_type: form.coffee_corner_type || "פינת קפה רגילה",
      location_id: form.location_id || null,
      location_name_snapshot: form.location_name_snapshot || null,
      notes: form.notes || null,
      source: "manual",
      status: "ACTIVE",
    };
    try {
      const { data } = await base44.functions.invoke("saveCoffeeCornerRequest", { ...payload, id: editingId || undefined });
      if (!data?.success) { setFormError(data?.error || "שמירת פינת הקפה נכשלה"); return; }
      toast.success(editingId ? "פינת קפה עודכנה" : "פינת קפה נוספה");
      closeForm();
      invalidate();
    } catch (error) {
      setFormError(error?.response?.data?.error || error?.message || "שמירת פינת הקפה נכשלה");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (req) => {
    if (!window.confirm("לבטל פינת קפה זו?")) return;
    // 1. Cancel the CoffeeCornerRequest
    await opWrite.CoffeeCornerRequest.update(req.id, { status: "CANCELLED" });
    // 2. Cancel any matching MealReservation (meal_type COFFEE_CORNER, same group_id + date)
    try {
      const relatedMeals = await base44.entities.MealReservation.filter({
        group_id: req.group_id,
        meal_type: "COFFEE_CORNER",
      });
      const toCancel = relatedMeals.filter(m => m.status !== "CANCELLED" && m.date === req.date);
      await Promise.all(toCancel.map(m =>
        opWrite.MealReservation.update(m.id, { status: "CANCELLED" })
      ));
    } catch {
      // non-fatal — CoffeeCornerRequest already cancelled
    }
    toast.success("פינת קפה בוטלה");
    invalidate();
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
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2 text-slate-800">
          <Coffee className="w-4 h-4 text-amber-600" /> פינת קפה
        </h3>
        <RoleGate permission="MANAGE_ACTIVITIES">
          <Button size="sm" variant="outline" onClick={formOpen ? closeForm : openAdd} className="gap-1">
            <Plus className="w-3.5 h-3.5" /> הוסף פינת קפה
          </Button>
        </RoleGate>
      </div>

      {/* Add / Edit Form */}
      {formOpen && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-amber-800">{editingId ? "ערוך פינת קפה" : "פינת קפה חדשה"}</p>

          {minDate && (
            <p className="text-xs text-slate-400">
              תאריכים מותרים: {minDate}{maxDate && maxDate !== minDate ? ` עד ${maxDate}` : ""}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            {/* Date */}
            <div className="space-y-1 col-span-2">
              <label className="text-xs text-slate-500">תאריך *</label>
              <Input
                type="date"
                value={form.date}
                min={minDate || undefined}
                max={maxDate || undefined}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              />
            </div>

            {/* Start time */}
            <div className="space-y-1">
              <label className="text-xs text-slate-500">משעה *</label>
              <Input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
            </div>

            {/* End time */}
            <div className="space-y-1">
              <label className="text-xs text-slate-500">עד שעה *</label>
              <Input type="time" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
            </div>

            {/* Coffee type */}
            <div className="space-y-1 col-span-2">
              <label className="text-xs text-slate-500">סוג פינת קפה *</label>
              <Select value={form.coffee_corner_type} onValueChange={v => setForm(f => ({ ...f, coffee_corner_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COFFEE_TYPES.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Location */}
            <div className="space-y-1 col-span-2">
              <label className="text-xs text-slate-500">מיקום</label>
              <Select
                value={form.location_id || "none"}
                onValueChange={handleLocationChange}
              >
                <SelectTrigger><SelectValue placeholder="בחר מיקום (אופציונלי)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— לא הוגדר —</SelectItem>
                  {sortActivitySpaces(activitySpaces).map(sp => (
                    <SelectItem key={sp.id} value={sp.id}>{getActivitySpaceDisplayName(sp)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!form.location_id && (
                <p className="text-[11px] text-amber-600">מומלץ לבחור מיקום כדי שהמטבח ידע היכן להכין</p>
              )}
            </div>

            {/* Pax */}
            <div className="space-y-1 col-span-2">
              <label className="text-xs text-slate-500">כמות אנשים *</label>
              <Input
                type="number"
                min="1"
                value={form.pax}
                onChange={e => setForm(f => ({ ...f, pax: e.target.value }))}
                placeholder="0"
              />
              {defaultPax && (
                <p className="text-[10px] text-slate-400">ברירת מחדל: {defaultPax} (ניתן לשנות)</p>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-1 col-span-2">
              <label className="text-xs text-slate-500">הערות</label>
              <Input
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="הערות למטבח / לוגיסטיקה..."
              />
            </div>
          </div>

          {formError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</p>
          )}

          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={closeForm}>ביטול</Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="bg-amber-600 hover:bg-amber-700 text-white">
              {saving ? "שומר..." : editingId ? "עדכן" : "הוסף"}
            </Button>
          </div>
        </div>
      )}

      {/* List */}
      {activeRequests.length === 0 && !formOpen ? (
        <p className="text-sm text-muted-foreground text-center py-6 border-2 border-dashed border-amber-100 rounded-xl">
          אין בקשות פינת קפה עדיין — הוסף ידנית
        </p>
      ) : (
        <div className="space-y-3">
          {activeRequests.map(req => (
            <div key={req.id} className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Coffee className="w-4 h-4 text-amber-600 shrink-0" />
                    <span className="font-semibold text-amber-800 text-sm">פינת קפה</span>
                  </div>
                  <p className="text-xs text-amber-700 font-medium">
                    סוג: {coffeeTypeLabel(req.coffee_corner_type)}
                  </p>
                  <p className="text-sm text-slate-700 font-medium">
                    {req.date?.split("-").reverse().join("/")}
                  </p>
                  <p className="text-sm text-slate-600">
                    {req.start_time}–{req.end_time}
                  </p>
                  {req.location_name_snapshot && (
                    <p className="text-sm text-slate-600">📍 מיקום: {req.location_name_snapshot}</p>
                  )}
                  <p className="text-sm text-slate-600">👥 כמות: {req.pax}</p>
                  {req.notes && (
                    <p className="text-xs text-slate-500 mt-1">💬 {req.notes}</p>
                  )}
                </div>
                <RoleGate permission="MANAGE_ACTIVITIES">
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(req)} className="h-8 w-8 p-0">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleCancel(req)} className="h-8 w-8 p-0 text-red-400 hover:text-red-600">
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </RoleGate>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}