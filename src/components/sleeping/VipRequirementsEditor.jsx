import { Plus, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const VIP_MAX = 10;
const VIP_MAX_PER_TENT = 4;

const PURPOSE_OPTIONS = [
  { value: "STAFF",    label: "צוות" },
  { value: "DRIVER",   label: "נהג" },
  { value: "SECURITY", label: "אבטחה" },
  { value: "GUIDE",    label: "מדריך" },
  { value: "OTHER",    label: "אחר" },
];

const GENDER_OPTIONS = [
  { value: "MEN",   label: "בנים" },
  { value: "WOMEN", label: "בנות" },
];

// Color scheme per gender
const GENDER_COLORS = {
  MEN:   { row: "border-emerald-300 bg-emerald-50/60", badge: "bg-emerald-100 text-emerald-700 border-emerald-300" },
  WOMEN: { row: "border-orange-300 bg-orange-50/60",   badge: "bg-orange-100 text-orange-700 border-orange-300" },
};

const EMPTY_ROW = () => ({ gender_group: "", people_count: 1, purpose: "STAFF", notes: "" });

const NON_STAFF_PURPOSES = ["DRIVER", "SECURITY", "GUIDE", "OTHER"];

function SingleCountdown({ total, assigned, label, colorClass }) {
  if (total == null) return null;
  const remaining = total - assigned;
  const done = remaining === 0;
  const over = remaining < 0;
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs flex items-center justify-between flex-1 ${
      over ? "bg-red-50 border-red-300 text-red-700" :
      done ? "bg-emerald-50 border-emerald-300 text-emerald-700" :
             colorClass
    }`}>
      <span className="text-[11px] opacity-70 ml-1">{label}</span>
      <span>שובצו: <strong>{assigned}</strong> / {total}</span>
      <span className="font-bold">
        {over ? `${Math.abs(remaining)} עודף!` : done ? "✓" : `נותרו: ${remaining}`}
      </span>
    </div>
  );
}

function CountdownBar({ staffTotal, rows }) {
  // All person types count toward a single staff total
  if (staffTotal == null) return null;
  const totalAssigned = rows.reduce((s, r) => s + (Number(r.people_count) || 0), 0);
  return (
    <div className="flex gap-2 flex-wrap">
      <SingleCountdown
        total={staffTotal}
        assigned={totalAssigned}
        label="סה״כ צוות / מלווים (כולל נהגים, מדריכים, מורים)"
        colorClass="bg-violet-50 border-violet-200 text-violet-700"
      />
    </div>
  );
}

function VipSummary({ rows }) {
  const total       = rows.length;
  const boysRows    = rows.filter(r => r.gender_group === "MEN");
  const girlsRows   = rows.filter(r => r.gender_group === "WOMEN");
  const boysPeople  = boysRows.reduce((s, r)  => s + (r.people_count || 0), 0);
  const girlsPeople = girlsRows.reduce((s, r) => s + (r.people_count || 0), 0);
  const exceedsMax  = total > VIP_MAX;
  const hasOverPax  = rows.some(r => r.people_count > VIP_MAX_PER_TENT);

  if (total === 0) return null;

  return (
    <div className={`rounded-lg border px-3 py-2.5 text-xs space-y-1 ${exceedsMax || hasOverPax ? "bg-red-50 border-red-300 text-red-700" : "bg-purple-50 border-purple-200 text-purple-700"}`}>
      <p className="font-semibold flex items-center gap-1.5">
        {exceedsMax || hasOverPax
          ? <><AlertTriangle className="w-3.5 h-3.5" /> שגיאות VIP</>
          : <><CheckCircle2 className="w-3.5 h-3.5" /> סיכום VIP</>
        }
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span>סה"כ אוהלי VIP: <strong>{total}</strong> / {VIP_MAX}</span>
        <span>סה"כ אנשים: <strong>{boysPeople + girlsPeople}</strong></span>
        <span>בנים: {boysRows.length} אוהלים · {boysPeople} אנשים</span>
        <span>בנות: {girlsRows.length} אוהלים · {girlsPeople} אנשים</span>
      </div>
      {exceedsMax && <p className="text-red-600">⚠️ חריגה מהמקסימום ({VIP_MAX} אוהלי VIP בסה"כ)</p>}
      {hasOverPax && <p className="text-red-600">⚠️ יש שורה עם יותר מ-{VIP_MAX_PER_TENT} אנשים לאוהל</p>}
      <p className="text-[10px] opacity-60">אוהלי VIP 80–89. שיבוץ ספציפי ייעשה ע"י משק הבית.</p>
    </div>
  );
}

export default function VipRequirementsEditor({ rows, onChange, staffTotal, driversTotal, altTentPax, altTentNotes, onAltTentNotesChange, staffMenCount, staffWomenCount }) {
  const addRow    = () => onChange([...rows, EMPTY_ROW()]);
  const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i));
  const updateRow = (i, field, val) => {
    const next = [...rows];
    next[i] = { ...next[i], [field]: val };
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {/* Countdown — shown above rows */}
      <CountdownBar staffTotal={staffTotal} rows={rows} />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-slate-500">כל שורה = אוהל VIP אחד נדרש (לא מוקצה פיזית)</p>
        <div className="flex gap-1.5 flex-wrap">
          <Button size="sm" variant="outline"
            onClick={() => onChange([...rows, { ...EMPTY_ROW(), purpose: "SECURITY", gender_group: "" }])}
            className="text-xs gap-1 h-7 border-amber-300 text-amber-700 hover:bg-amber-50"
            disabled={rows.length >= VIP_MAX}>
            <Plus className="w-3 h-3" /> אבטחה
          </Button>
          <Button size="sm" variant="outline"
            onClick={() => onChange([...rows, { ...EMPTY_ROW(), purpose: "DRIVER", gender_group: "" }])}
            className="text-xs gap-1 h-7 border-blue-300 text-blue-700 hover:bg-blue-50"
            disabled={rows.length >= VIP_MAX}>
            <Plus className="w-3 h-3" /> נהג
          </Button>
          <Button size="sm" variant="outline" onClick={addRow}
            className="text-xs gap-1 h-7" disabled={rows.length >= VIP_MAX}>
            <Plus className="w-3 h-3" /> הוסף אוהל VIP
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-3 border-2 border-dashed border-slate-200 rounded-lg">
          אין דרישות VIP — לחץ "הוסף אוהל VIP"
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => {
            const overPax       = row.people_count > VIP_MAX_PER_TENT;
            const missingGender = !row.gender_group;
            const missingPax    = !row.people_count;
            const hasError      = overPax || missingGender || missingPax;

            const genderColor = !hasError && row.gender_group
              ? GENDER_COLORS[row.gender_group]
              : null;

            const rowClass = hasError
              ? "border-red-300 bg-red-50/40"
              : genderColor
                ? genderColor.row
                : "border-slate-200 bg-slate-50/40";

            return (
              <div key={i} className={`border rounded-lg p-3 space-y-2 ${rowClass}`}>
                <div className="grid grid-cols-12 gap-2 items-end">
                  {/* Gender */}
                  <div className="col-span-3 space-y-1">
                    <label className="text-[11px] text-slate-500">מגדר *</label>
                    <Select value={row.gender_group || ""} onValueChange={v => updateRow(i, "gender_group", v)}>
                      <SelectTrigger className={`h-7 text-xs ${missingGender ? "border-red-400" : genderColor ? `border ${genderColor.badge.split(" ")[2]}` : ""}`}>
                        <SelectValue placeholder="בחר..." />
                      </SelectTrigger>
                      <SelectContent>
                        {GENDER_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* People count */}
                  <div className="col-span-2 space-y-1">
                    <label className="text-[11px] text-slate-500">אנשים *</label>
                    <Input
                     type="number" min="1" max="4"
                      value={row.people_count || ""}
                      onChange={e => updateRow(i, "people_count", e.target.value === "" ? "" : Number(e.target.value))}
                      className={`h-7 text-xs text-center ${overPax || missingPax ? "border-red-400 bg-red-50" : ""}`}
                    />
                  </div>

                  {/* Purpose */}
                  <div className="col-span-3 space-y-1">
                    <label className="text-[11px] text-slate-500">מיועד ל</label>
                    <Select value={row.purpose || "STAFF"} onValueChange={v => updateRow(i, "purpose", v)}>
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PURPOSE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Notes */}
                  <div className="col-span-3 space-y-1">
                    <label className="text-[11px] text-slate-500">הערות</label>
                    <Input
                      value={row.notes || ""}
                      onChange={e => updateRow(i, "notes", e.target.value)}
                      placeholder="הערה..."
                      className="h-7 text-xs"
                    />
                  </div>

                  {/* Delete */}
                  <div className="col-span-1 flex justify-center pb-0.5">
                    <button onClick={() => removeRow(i)} className="text-slate-300 hover:text-red-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Badges row */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {!hasError && genderColor && (
                    <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded border ${genderColor.badge}`}>
                      {row.gender_group === "MEN" ? "בנים" : "בנות"}
                    </span>
                  )}
                  {row.purpose && row.purpose !== "STAFF" && (
                    <span className="inline-flex text-[10px] font-semibold px-2 py-0.5 rounded border bg-slate-100 border-slate-300 text-slate-600">
                      {PURPOSE_OPTIONS.find(p => p.value === row.purpose)?.label || row.purpose}
                    </span>
                  )}
                </div>

                {/* Row-level errors */}
                {hasError && (
                  <div className="text-[11px] text-red-600 space-y-0.5">
                    {missingGender && <p>• חסר מגדר</p>}
                    {missingPax    && <p>• חסר מספר אנשים</p>}
                    {overPax       && <p>• מקסימום {VIP_MAX_PER_TENT} אנשים לאוהל VIP</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <VipSummary rows={rows} />

      {/* ── Alternative tent section — auto-calculated ────────────────────── */}
      {(() => {
        // All VIP rows count toward staff total — no exclusion by purpose
        const totalVipPeople = rows.reduce((s, r) => s + (Number(r.people_count) || 0), 0);
        const calcAltPax = staffTotal != null
          ? Math.max(staffTotal - totalVipPeople, 0)
          : null;

        return (
          <div className="border border-amber-300 bg-amber-50/60 rounded-xl p-3 space-y-3">
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-amber-800">אוהל חילופי לצוות</p>
              <p className="text-[11px] text-amber-700">
                המספר מחושב אוטומטית: סה״כ צוות פחות אנשים המשובצים באוהלי VIP.
              </p>
            </div>

            {staffTotal == null ? (
              <div className="flex items-center gap-1.5 bg-amber-100 border border-amber-300 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <p className="text-[11px] text-amber-700">לא הוגדר מספר צוות כללי, לכן לא ניתן לחשב אוטומטית אוהל חילופי.</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 text-xs text-center">
                <div className="bg-white border border-amber-200 rounded-lg px-2 py-2">
                  <p className="text-[10px] text-slate-500 mb-0.5">סה״כ צוות ללינה</p>
                  <p className="text-lg font-bold text-slate-700">{staffTotal}</p>
                </div>
                <div className="bg-white border border-amber-200 rounded-lg px-2 py-2">
                  <p className="text-[10px] text-slate-500 mb-0.5">אנשים באוהלי VIP</p>
                  <p className="text-lg font-bold text-violet-700">{totalVipPeople}</p>
                </div>
                <div className={`border rounded-lg px-2 py-2 ${calcAltPax > 0 ? "bg-amber-100 border-amber-400" : "bg-emerald-50 border-emerald-300"}`}>
                  <p className="text-[10px] text-slate-500 mb-0.5">נותרו לאוהל חילופי</p>
                  <p className={`text-lg font-bold ${calcAltPax > 0 ? "text-amber-800" : "text-emerald-700"}`}>{calcAltPax}</p>
                </div>
                <div className="bg-white border border-emerald-200 rounded-lg px-2 py-2">
                  <p className="text-[10px] text-slate-500 mb-0.5">גברים</p>
                  <p className="text-lg font-bold text-emerald-700">{Number(staffMenCount) || 0}</p>
                </div>
                <div className="bg-white border border-orange-200 rounded-lg px-2 py-2">
                  <p className="text-[10px] text-slate-500 mb-0.5">נשים</p>
                  <p className="text-lg font-bold text-orange-700">{Number(staffWomenCount) || 0}</p>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">הערות לאוהל חילופי</label>
              <textarea
                value={altTentNotes ?? ""}
                onChange={e => onAltTentNotesChange(e.target.value)}
                placeholder="מיקום מועדף, הערות נוספות..."
                rows={2}
                className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}