import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Trash2, Ban } from "lucide-react";
import { ROW_TYPES, ROW_BY_TYPE, WORKER_TEAMS, OPERATIONS_MORNING_OPTIONS, getDefaultShiftTimes } from "@/lib/workScheduleConfig";
import { REQUEST_TYPE_LABELS, REQUEST_STATUS_LABELS } from "@/lib/workScheduleRequestLabels";

const NEW_WORKER = "__new__";

export default function ShiftFormModal({ shift, defaults, workers, requests = [], isPublished, userEmail, onSave, onDelete, onCancelShift, onClose }) {
  const isEdit = !!shift;
  const initialRowType = shift?.row_type || defaults?.row_type || "OPERATIONS_MORNING";
  const initialTimes = getDefaultShiftTimes(initialRowType);
  const initialMorningOption = OPERATIONS_MORNING_OPTIONS.find((option) =>
    option.start_time === shift?.start_time && option.end_time === shift?.end_time
  )?.id || "EARLY";
  const [morningOption, setMorningOption] = useState(initialMorningOption);
  const [form, setForm] = useState({
    date:       shift?.date       || defaults?.date     || "",
    row_type:   initialRowType,
    worker_id:  shift?.worker_id  || "",
    worker_count: shift?.worker_count || "",
    start_time: shift?.start_time || initialTimes.start_time,
    end_time:   shift?.end_time   || initialTimes.end_time,
    notes:      shift?.notes      || "",
  });
  const [newWorker, setNewWorker] = useState({ full_name: "", phone: "", default_team: "OTHER", internal_user_email: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const handleRowTypeChange = (rowType) => {
    const times = getDefaultShiftTimes(rowType);
    setForm((current) => ({ ...current, row_type: rowType, start_time: times.start_time, end_time: times.end_time }));
    if (rowType === "OPERATIONS_MORNING") setMorningOption("EARLY");
  };
  const handleMorningOptionChange = (optionId) => {
    const option = OPERATIONS_MORNING_OPTIONS.find((item) => item.id === optionId);
    if (!option) return;
    setMorningOption(optionId);
    setForm((current) => ({ ...current, start_time: option.start_time, end_time: option.end_time }));
  };
  const row = ROW_BY_TYPE[form.row_type] || {};
  const isNightGeneratedMorning = shift?.auto_created_from === "NIGHT_ON_CALL_TO_OPERATIONS_MORNING";
  const isActivity = !!row.textOnly;
  const isCountBased = !!row.countBased;
  const isNewWorker = form.worker_id === NEW_WORKER;
  const availabilityWarnings = requests.filter((request) => {
    const start = request.start_date || request.date || "";
    const end = request.end_date || start;
    const timeMatches = (!request.start_time && !request.end_time) || ((request.start_time || "00:00") < (form.end_time || "23:59") && (request.end_time || "23:59") > (form.start_time || "00:00"));
    return (request.worker_profile_id || request.worker_id) === form.worker_id && ["DAY_OFF", "UNAVAILABLE", "CANNOT_WORK"].includes(request.request_type) && ["PENDING", "APPROVED"].includes(request.status) && start <= form.date && end >= form.date && timeMatches;
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.date) { setError("יש לבחור תאריך"); return; }
    if (isActivity) {
      if (!form.notes.trim()) { setError("יש להזין טקסט לפעילות המתוכננת"); return; }
    } else if (isCountBased) {
      if (!form.worker_count || Number(form.worker_count) < 1) { setError("יש להזין כמות מנקות"); return; }
    } else {
      if (!form.worker_id) { setError("יש לבחור עובד"); return; }
      if (isNewWorker && !newWorker.full_name.trim()) { setError("יש להזין שם עובד"); return; }
      if (!form.start_time || !form.end_time) { setError("יש להזין שעות התחלה וסיום"); return; }
    }

    setSaving(true);
    try {
      let workerId = form.worker_id;
      let workerName = "";
      if (!isActivity && !isCountBased) {
        if (isNewWorker) {
          const response = await base44.functions.invoke("manageWorkerProfiles", {
            action: "save",
            worker: {
              full_name: newWorker.full_name.trim(), phone: newWorker.phone || "",
              email: newWorker.internal_user_email.trim().toLowerCase(), default_team: newWorker.default_team,
              is_active: true, internal_user_id: "",
            },
          });
          workerId = response.data.worker.id;
          workerName = response.data.worker.full_name;
        } else {
          workerName = workers.find((w) => w.id === form.worker_id)?.full_name || shift?.worker_name || "";
        }
      }

      await onSave({
        date: form.date,
        row_type: form.row_type,
        row_label: row.label,
        row_order: row.order,
        worker_id: (isActivity || isCountBased) ? "" : workerId,
        worker_name: (isActivity || isCountBased) ? "" : workerName,
        worker_count: isCountBased ? Number(form.worker_count) : undefined,
        start_time: isActivity ? "" : form.start_time,
        end_time: isActivity ? "" : form.end_time,
        notes: form.notes || undefined,
        status: shift?.status || "PLANNED",
      });
      onClose();
    } catch (err) {
      setError(err.message || "שגיאה בשמירה");
    }
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-base">{isEdit ? "עריכת משמרת" : "הוספת משמרת"}</DialogTitle>
        </DialogHeader>

        {isPublished && (
          <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            הסידור כבר פורסם. שינוי זה ישפיע על מה שהעובדים רואים.
          </div>
        )}
        {availabilityWarnings.length > 0 && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"><b>לעובד קיימת בקשה / אי זמינות בתאריך זה</b>{availabilityWarnings.map((request) => <div key={request.id} className="mt-1">{REQUEST_TYPE_LABELS[request.request_type]} · {REQUEST_STATUS_LABELS[request.status]} — {request.message}</div>)}</div>}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">תאריך</Label>
              <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">אזור / משמרת</Label>
              <Select value={form.row_type} onValueChange={handleRowTypeChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROW_TYPES.map((r) => <SelectItem key={r.type} value={r.type}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.row_type === "OPERATIONS_MORNING" && !isNightGeneratedMorning && (
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">אפשרות תפעול בוקר</Label>
              <Select value={morningOption} onValueChange={handleMorningOptionChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OPERATIONS_MORNING_OPTIONS.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {isCountBased && (
            <>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">כמות מנקות *</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.worker_count}
                  onChange={(e) => set("worker_count", e.target.value)}
                  placeholder="לדוגמה: 4"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">שעת התחלה</Label>
                  <Input type="time" value={form.start_time} onChange={(e) => set("start_time", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">שעת סיום</Label>
                  <Input type="time" value={form.end_time} onChange={(e) => set("end_time", e.target.value)} />
                </div>
              </div>
            </>
          )}

          {!isActivity && !isCountBased && (
            <>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">עובד</Label>
                <Select value={form.worker_id} onValueChange={(v) => set("worker_id", v)}>
                  <SelectTrigger><SelectValue placeholder="בחר עובד" /></SelectTrigger>
                  <SelectContent>
                    {workers.map((w) => <SelectItem key={w.id} value={w.id}><span>{w.full_name} · <span className={w.is_linked ? "text-emerald-600" : "text-slate-400"}>{w.is_linked ? "משתמש מערכת מקושר" : "ללא משתמש מערכת"}</span></span></SelectItem>)}
                    <SelectItem value={NEW_WORKER}>➕ עובד חדש...</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {isNewWorker && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                  <div className="text-xs font-semibold text-slate-600">עובד חדש</div>
                  <Input placeholder="שם מלא *" value={newWorker.full_name} onChange={(e) => setNewWorker((w) => ({ ...w, full_name: e.target.value }))} />
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="טלפון (אופציונלי)" value={newWorker.phone} onChange={(e) => setNewWorker((w) => ({ ...w, phone: e.target.value }))} />
                    <Select value={newWorker.default_team} onValueChange={(v) => setNewWorker((w) => ({ ...w, default_team: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {WORKER_TEAMS.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input placeholder="אימייל משתמש מערכת (אופציונלי — לצפייה במשמרות שלי)" value={newWorker.internal_user_email} onChange={(e) => setNewWorker((w) => ({ ...w, internal_user_email: e.target.value }))} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">שעת התחלה</Label>
                  <Input type="time" value={form.start_time} onChange={(e) => set("start_time", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">שעת סיום</Label>
                  <Input type="time" value={form.end_time} onChange={(e) => set("end_time", e.target.value)} />
                </div>
              </div>
            </>
          )}

          <div className="space-y-1">
            <Label className="text-xs text-slate-500">{isActivity ? "טקסט הפעילות *" : "הערות"}</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)}
              placeholder={isActivity ? "לדוגמה: קבוצה גדולה באתר / ביקור 11:00–13:00" : ""} />
          </div>

          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" disabled={saving} className="flex-1">{saving ? "שומר..." : "שמירה"}</Button>
            {isEdit && shift.status === "PLANNED" && (
              <Button type="button" variant="outline" size="icon" title="בטל משמרת" onClick={() => { onCancelShift(shift); onClose(); }}>
                <Ban className="w-4 h-4 text-amber-600" />
              </Button>
            )}
            {isEdit && (
              <Button type="button" variant="outline" size="icon" title="מחק" onClick={() => { onDelete(shift); onClose(); }}>
                <Trash2 className="w-4 h-4 text-red-500" />
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}