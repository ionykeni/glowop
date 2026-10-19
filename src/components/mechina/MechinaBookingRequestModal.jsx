import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useEffect } from "react";
import { findBlockingSpace } from "@/lib/activitySpaceBlocks";
import { loadMechinaSpaces } from '@/components/mechina/useMechinaSpaces';
import MechinaRequestSpaceSelect from '@/components/mechina/MechinaRequestSpaceSelect';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export default function MechinaBookingRequestModal({ open, onClose, onSubmitted, spaces, defaultDate, defaultSpaceId, mechinaGroupId }) {
  const [form, setForm] = useState({
    date: defaultDate || new Date().toISOString().split("T")[0],
    space_id: defaultSpaceId || "",
    start_time: "",
    end_time: "",
    activity_title: "",
    participants_count: "",
    needs_projector: false,
    needs_screen: false,
    needs_microphone: false,
    needs_sound: false,
    needs_whiteboard: false,
    needs_chair_circle: false,
    chairs_count: "",
    logistics_other: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [availableSpaces, setAvailableSpaces] = useState(spaces);
  const [loadingSpaces, setLoadingSpaces] = useState(true);
  const [spaceLoadFailed, setSpaceLoadFailed] = useState(false);
  const [spaceCursor, setSpaceCursor] = useState(null);
  const refreshSpaces = async (cursor) => {
    setLoadingSpaces(true); setSpaceLoadFailed(false);
    try {
      const [data, activeBlocks] = await Promise.all([loadMechinaSpaces(cursor), base44.entities.ActivitySpaceBlock.filter({ status: 'ACTIVE' })]);
      setAvailableSpaces(current => cursor ? [...current, ...data.spaces] : data.spaces);
      setSpaceCursor(data.has_more ? data.next_cursor : null); setBlocks(activeBlocks);
    } catch { setSpaceLoadFailed(true); setError('טעינת זמינות המרחבים נכשלה. יש לנסות שוב.'); }
    finally { setLoadingSpaces(false); }
  };
  useEffect(() => { refreshSpaces(); }, []);
  useEffect(() => base44.entities.ActivitySpace.subscribe(() => { refreshSpaces(); }), []);
  const isBlocked = spaceId => !!findBlockingSpace(blocks, spaceId, form.date, form.start_time, form.end_time);

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));
  const toggle = (field) => setForm(f => ({ ...f, [field]: !f[field] }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.space_id) { setError("יש לבחור מרחב"); return; }
    const selectedSpace = availableSpaces.find(space => space.id === form.space_id);
    if (loadingSpaces || spaceLoadFailed) { setError('יש להמתין לטעינת זמינות המרחבים'); return; }
    if (selectedSpace?.mechina_requests_effective_enabled !== true) { setError('המרחב חסום לבקשות מכינה חדשות. יש לפנות למנהל המערכת.'); return; }
    if (selectedSpace.is_bookable === false) { setError('המרחב אינו זמין להזמנה כללית'); return; }
    if (!form.start_time || !form.end_time) { setError("יש להזין שעות"); return; }
    if (!form.activity_title.trim()) { setError("יש להזין שם פעילות"); return; }
    if (isBlocked(form.space_id)) { setError("המרחב הזה לא זמין בזמן הזה"); return; }

    setSaving(true);
    try {
      const res = await base44.functions.invoke("submitMechinaBookingRequest", {
        mechina_group_id: mechinaGroupId,
        space_id: form.space_id,
        date: form.date,
        start_time: form.start_time,
        end_time: form.end_time,
        activity_title: form.activity_title.trim(),
        participants_count: form.participants_count ? Number(form.participants_count) : null,
        needs_projector: form.needs_projector,
        needs_screen: form.needs_screen,
        needs_microphone: form.needs_microphone,
        needs_sound: form.needs_sound,
        needs_whiteboard: form.needs_whiteboard,
        needs_chair_circle: form.needs_chair_circle,
        chairs_count: form.chairs_count ? Number(form.chairs_count) : null,
        logistics_other: form.logistics_other,
        notes: form.notes,
      });
      if (res.data?.success) {
        toast.success("הבקשה אושרה והמרחב נשמר");
        onSubmitted();
        onClose();
      } else {
        setError(res.data?.error || "שגיאה בשליחת הבקשה");
      }
    } catch (err) {
      setError(err?.message || "שגיאה בשליחת הבקשה");
    } finally {
      setSaving(false);
    }
  };

  const EQUIPMENT = [
    { key: "needs_projector",    label: "מקרן" },
    { key: "needs_screen",       label: "מסך" },
    { key: "needs_microphone",   label: "מיקרופון" },
    { key: "needs_sound",        label: "מערכת סאונד" },
    { key: "needs_whiteboard",   label: "לוח לבן" },
    { key: "needs_chair_circle", label: "עיגול כיסאות" },
  ];

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg w-full max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">בקשה חדשה להזמנת מרחב</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Date */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">תאריך</label>
            <input
              type="date"
              value={form.date}
              onChange={e => set("date", e.target.value)}
              required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <MechinaRequestSpaceSelect spaces={availableSpaces} value={form.space_id} onChange={id => set('space_id', id)} isBlocked={isBlocked} loading={loadingSpaces} />
          {spaceLoadFailed && <Button type="button" variant="outline" onClick={() => refreshSpaces()}>נסה לטעון מרחבים שוב</Button>}
          {spaceCursor && <Button type="button" variant="outline" disabled={loadingSpaces} onClick={() => refreshSpaces(spaceCursor)}>הצג מרחבים נוספים</Button>}

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">שעת התחלה *</label>
              <input
                type="time"
                value={form.start_time}
                onChange={e => set("start_time", e.target.value)}
                required
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">שעת סיום *</label>
              <input
                type="time"
                value={form.end_time}
                onChange={e => set("end_time", e.target.value)}
                required
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Activity title */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">שם הפעילות *</label>
            <input
              type="text"
              value={form.activity_title}
              onChange={e => set("activity_title", e.target.value)}
              placeholder="לדוגמה: שיחת בוקר, מפגש קבוצה..."
              required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Participants */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">מספר משתתפים</label>
            <input
              type="number"
              min="1"
              value={form.participants_count}
              onChange={e => set("participants_count", e.target.value)}
              placeholder="מספר משתתפים"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Equipment checkboxes */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">ציוד נדרש</label>
            <div className="grid grid-cols-2 gap-2">
              {EQUIPMENT.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form[key]}
                    onChange={() => toggle(key)}
                    className="rounded"
                  />
                  {label}
                </label>
              ))}
            </div>
            {form.needs_chair_circle && (
              <input
                type="number"
                min="1"
                value={form.chairs_count}
                onChange={e => set("chairs_count", e.target.value)}
                placeholder="כמות כיסאות"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary mt-1"
              />
            )}
            <input
              type="text"
              value={form.logistics_other}
              onChange={e => set("logistics_other", e.target.value)}
              placeholder="ציוד נוסף / הערות לוגיסטיות..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">הערות</label>
            <textarea
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
              placeholder="הערות נוספות..."
              rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={saving}>ביטול</Button>
            <Button type="submit" className="flex-1" disabled={saving || loadingSpaces || spaceLoadFailed}>
              {saving ? "שולח..." : "שלח בקשה"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}