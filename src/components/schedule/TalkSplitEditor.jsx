import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { opWrite } from "@/lib/operationalWrites";
import { toast } from "sonner";
import { X, Plus, Shuffle } from "lucide-react";

/**
 * Auto-divide `total` pax across `n` spaces.
 * First `remainder` slots get base+1, rest get base.
 */
function autoDivide(total, n) {
  if (!total || !n) return Array(n).fill("");
  const base = Math.floor(total / n);
  const remainder = total % n;
  return Array.from({ length: n }, (_, i) => (i < remainder ? base + 1 : base));
}

/**
 * Inline split editor — admin selects 2+ spaces, pax auto-divided, all editable.
 * Saves sequentially with rollback on failure.
 */
export default function TalkSplitEditor({
  talk,
  suggestion,
  groupId,
  profileId,
  group,
  activitySpaces = [],
  onSaved,
  onCancel,
}) {
  const defaultDate = suggestion?.date || group?.arrival_date || "";
  const defaultStart = suggestion?.start_time || "09:00";
  const defaultEnd = suggestion?.end_time || "10:00";
  const totalPax = group?.participant_count || group?.total_pax || null;

  // Shared fields
  const [sharedForm, setSharedForm] = useState({
    activity_name: talk.name,
    date: defaultDate,
    start_time: defaultStart,
    end_time: defaultEnd,
    notes: suggestion?.notes || "",
  });

  // Per-space rows: [{ activity_space_id, pax }]
  const [spaceRows, setSpaceRows] = useState([
    { activity_space_id: "", pax: "" },
    { activity_space_id: "", pax: "" },
  ]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // When number of rows changes, re-auto-divide
  const handleAutoDivide = () => {
    const divided = autoDivide(totalPax, spaceRows.length);
    setSpaceRows(rows => rows.map((r, i) => ({ ...r, pax: divided[i] !== "" ? String(divided[i]) : "" })));
  };

  // Auto-divide on mount
  useEffect(() => {
    handleAutoDivide();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addRow = () => {
    setSpaceRows(rows => {
      const next = [...rows, { activity_space_id: "", pax: "" }];
      const divided = autoDivide(totalPax, next.length);
      return next.map((r, i) => ({ ...r, pax: divided[i] !== "" ? String(divided[i]) : r.pax }));
    });
  };

  const removeRow = (idx) => {
    if (spaceRows.length <= 2) return;
    setSpaceRows(rows => {
      const next = rows.filter((_, i) => i !== idx);
      const divided = autoDivide(totalPax, next.length);
      return next.map((r, i) => ({ ...r, pax: divided[i] !== "" ? String(divided[i]) : r.pax }));
    });
  };

  const updateRow = (idx, key, val) => {
    setSpaceRows(rows => rows.map((r, i) => i === idx ? { ...r, [key]: val } : r));
  };

  const setShared = (k, v) => setSharedForm(f => ({ ...f, [k]: v }));

  // Selected space IDs for duplicate detection
  const selectedSpaceIds = spaceRows.map(r => r.activity_space_id).filter(Boolean);

  const validate = () => {
    if (!sharedForm.date) return "יש למלא תאריך";
    if (!sharedForm.start_time || !sharedForm.end_time || sharedForm.start_time >= sharedForm.end_time)
      return "שעת הסיום חייבת להיות אחרי שעת ההתחלה";
    if (spaceRows.length < 2) return "יש לבחור לפחות 2 מרחבים";
    for (let i = 0; i < spaceRows.length; i++) {
      if (!spaceRows[i].activity_space_id) return `יש לבחור מרחב לשורה ${i + 1}`;
    }
    // Duplicate space check
    const ids = spaceRows.map(r => r.activity_space_id);
    const unique = new Set(ids);
    if (unique.size !== ids.length) return "לא ניתן לבחור את אותו מרחב פעמיים";
    return null;
  };

  const handleSave = async () => {
    setError(null);
    const validErr = validate();
    if (validErr) { setError(validErr); return; }

    setSaving(true);
    const splitGroupId = crypto.randomUUID();
    const splitTotal = spaceRows.length;
    const createdIds = [];

    try {
      for (let i = 0; i < spaceRows.length; i++) {
        const row = spaceRows[i];
        const res = await base44.functions.invoke("saveGroupScheduleItem", {
          group_id: groupId,
          operational_group_profile_id: profileId,
          date: sharedForm.date,
          start_time: sharedForm.start_time,
          end_time: sharedForm.end_time,
          activity_name: sharedForm.activity_name,
          activity_space_id: row.activity_space_id || null,
          quote_item_id: talk.quote_item_id,
          pax: row.pax ? Number(row.pax) : null,
          notes: sharedForm.notes || null,
          split_group_id: splitGroupId,
          split_index: i + 1,
          split_total: splitTotal,
          source: "manual",
          status: "ACTIVE",
        });

        if (res.data?.error) {
          // Rollback: cancel all previously created items
          for (const createdId of createdIds) {
            await opWrite.GroupScheduleItem.update(createdId, { status: "CANCELLED" }).catch(() => {});
          }
          setError(`שגיאה במרחב ${i + 1}: ${res.data.error}`);
          setSaving(false);
          return;
        }

        createdIds.push(res.data.item.id);
      }

      toast.success(`שיבוץ מפוצל נשמר — ${splitTotal} מרחבים`);
      onSaved();
    } catch (err) {
      // Rollback on unexpected error
      for (const createdId of createdIds) {
        await opWrite.GroupScheduleItem.update(createdId, { status: "CANCELLED" }).catch(() => {});
      }
      setError(err?.response?.data?.error || err?.message || "שגיאה בשמירה — הפעולה בוטלה");
    } finally {
      setSaving(false);
    }
  };

  // Spaces not yet selected in other rows (for each row's dropdown)
  const availableFor = (rowIdx) =>
    activitySpaces.filter(sp =>
      !spaceRows.some((r, i) => i !== rowIdx && r.activity_space_id === sp.id)
    );

  return (
    <div className="mt-2 bg-white border border-blue-200 rounded-xl p-4 space-y-4">
      <p className="text-xs font-semibold text-blue-700">
        שיבוץ מפוצל — {talk.type}: {talk.name}
      </p>

      {/* Shared fields */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1 col-span-2">
          <label className="text-xs text-slate-500">שם פעילות</label>
          <Input value={sharedForm.activity_name} onChange={e => setShared("activity_name", e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">תאריך *</label>
          <Input
            type="date"
            value={sharedForm.date}
            min={group?.arrival_date || undefined}
            max={group?.departure_date || undefined}
            onChange={e => setShared("date", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">הערות</label>
          <Input value={sharedForm.notes} onChange={e => setShared("notes", e.target.value)} placeholder="הערות..." />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">שעת התחלה</label>
          <Input type="time" value={sharedForm.start_time} onChange={e => setShared("start_time", e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">שעת סיום</label>
          <Input type="time" value={sharedForm.end_time} onChange={e => setShared("end_time", e.target.value)} />
        </div>
      </div>

      {/* Space rows */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-600">בחר מרחבים</label>
          {totalPax && (
            <button
              type="button"
              onClick={handleAutoDivide}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 underline"
            >
              <Shuffle className="w-3 h-3" /> פיצול אוטומטי ({totalPax} משתתפים)
            </button>
          )}
        </div>

        {spaceRows.map((row, idx) => (
          <div key={idx} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
            <span className="text-xs font-bold text-slate-400 w-5 shrink-0">{idx + 1}.</span>
            <div className="flex-1">
              <Select
                value={row.activity_space_id || "none"}
                onValueChange={v => updateRow(idx, "activity_space_id", v === "none" ? "" : v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="בחר מרחב..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— בחר מרחב —</SelectItem>
                  {availableFor(idx).map(sp => (
                    <SelectItem key={sp.id} value={sp.id}>{sp.name} ({sp.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-28 shrink-0">
              <Input
                type="number"
                min="0"
                value={row.pax}
                onChange={e => updateRow(idx, "pax", e.target.value)}
                placeholder="משתתפים"
                className="h-8 text-xs"
              />
            </div>
            <button
              type="button"
              onClick={() => removeRow(idx)}
              disabled={spaceRows.length <= 2}
              className="text-slate-300 hover:text-red-500 disabled:opacity-30 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mt-1"
        >
          <Plus className="w-3 h-3" /> הוסף מרחב נוסף
        </button>
      </div>

      {/* Summary */}
      {totalPax && (
        <p className="text-xs text-slate-400">
          סה״כ משתתפים שהוזנו:{" "}
          <span className="font-semibold text-slate-600">
            {spaceRows.reduce((s, r) => s + (Number(r.pax) || 0), 0)}
          </span>
          {" "}/ {totalPax} בקבוצה
        </p>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="outline" onClick={onCancel}>בטל</Button>
        <Button size="sm" onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
          {saving ? "שומר..." : "שמור שיבוץ מפוצל"}
        </Button>
      </div>
    </div>
  );
}