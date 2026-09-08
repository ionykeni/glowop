import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { ROLE_LABELS, ROLES } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import RouteGuard from "@/components/RouteGuard";
import { UserPlus, Pencil, Check, X, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";

const ROLE_OPTIONS = Object.entries(ROLE_LABELS);

const ROLE_COLORS = {
  SUPER_ADMIN:        "bg-red-100 text-red-800 border-red-200",
  ADMIN:              "bg-violet-100 text-violet-800 border-violet-200",
  QUOTES_MANAGER:     "bg-cyan-100 text-cyan-800 border-cyan-200",
  OPERATIONS:         "bg-blue-100 text-blue-800 border-blue-200",
  HOUSEKEEPING_MANAGER: "bg-amber-100 text-amber-800 border-amber-200",
  HOUSEKEEPING_STAFF: "bg-yellow-100 text-yellow-800 border-yellow-200",
  KITCHEN:            "bg-orange-100 text-orange-800 border-orange-200",
  VIEWER:             "bg-slate-100 text-slate-700 border-slate-200",
};

function emptyForm() {
  return { email: "", name: "", role: "VIEWER", phone: "", notes: "" };
}

export default function UserManagement() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [formError, setFormError] = useState("");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["internalUsers"],
    queryFn: () => base44.entities.InternalUser.list("-created_date", 200),
  });

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (editingId) {
        return base44.entities.InternalUser.update(editingId, data);
      }
      return base44.entities.InternalUser.create({ ...data, active: true });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["internalUsers"] });
      setShowForm(false);
      setForm(emptyForm());
      setEditingId(null);
      setFormError("");
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }) => base44.entities.InternalUser.update(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["internalUsers"] }),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.email.trim()) { setFormError("אימייל הוא שדה חובה"); return; }
    if (!editingId) {
      const exists = users.find(u => u.email.toLowerCase() === form.email.toLowerCase());
      if (exists) { setFormError("משתמש עם אימייל זה כבר קיים"); return; }
    }
    saveMutation.mutate({ email: form.email.trim().toLowerCase(), name: form.name, role: form.role, phone: form.phone, notes: form.notes });
  };

  const startEdit = (u) => {
    setForm({ email: u.email, name: u.name || "", role: u.role, phone: u.phone || "", notes: u.notes || "" });
    setEditingId(u.id);
    setShowForm(true);
    setFormError("");
  };

  const cancelForm = () => {
    setShowForm(false);
    setForm(emptyForm());
    setEditingId(null);
    setFormError("");
  };

  return (
    <RouteGuard>
      <div className="min-h-screen bg-slate-900" dir="rtl">
        {/* Header */}
        <div className="border-b border-slate-700 bg-slate-800">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-amber-500/20 border border-amber-500/40 rounded-lg p-2">
                <ShieldAlert className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">ניהול משתמשים</h1>
                <p className="text-xs text-slate-400">הרשאות גישה — SUPER_ADMIN בלבד</p>
              </div>
            </div>
            <Link to="/admin" className="text-sm text-slate-400 hover:text-white transition-colors">
              ← חזרה לניהול
            </Link>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">

          {/* Add user button */}
          {!showForm && (
            <Button onClick={() => { setShowForm(true); setEditingId(null); setForm(emptyForm()); }} className="gap-2">
              <UserPlus className="w-4 h-4" />
              הוסף משתמש
            </Button>
          )}

          {/* Form */}
          {showForm && (
            <div className="bg-white rounded-xl p-6 space-y-4">
              <h2 className="font-bold text-slate-800">{editingId ? "עריכת משתמש" : "משתמש חדש"}</h2>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-slate-700">אימייל *</label>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="user@example.com"
                      disabled={!!editingId}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-slate-700">שם</label>
                    <Input
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="שם מלא"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-slate-700">תפקיד *</label>
                    <select
                      value={form.role}
                      onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                      className="w-full border border-input bg-transparent rounded-md px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {ROLE_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label} ({value})</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-slate-700">טלפון</label>
                    <Input
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="05X-XXXXXXX"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">הערות</label>
                  <Input
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="הערות פנימיות"
                  />
                </div>
                {formError && <p className="text-sm text-red-600 font-medium">{formError}</p>}
                <div className="flex gap-2 pt-1">
                  <Button type="submit" disabled={saveMutation.isPending} className="gap-1.5">
                    <Check className="w-4 h-4" />
                    {editingId ? "עדכן" : "צור משתמש"}
                  </Button>
                  <Button type="button" variant="outline" onClick={cancelForm} className="gap-1.5">
                    <X className="w-4 h-4" />
                    ביטול
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* User list */}
          <div className="space-y-3">
            {isLoading && (
              <p className="text-slate-400 text-sm">טוען משתמשים...</p>
            )}
            {!isLoading && users.length === 0 && (
              <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-400 text-sm">
                אין משתמשים רשומים עדיין. הוסף את המשתמש הראשון.
              </div>
            )}
            {users.map(u => (
              <div key={u.id} className={`bg-white rounded-xl px-5 py-4 flex items-center gap-4 ${!u.active ? "opacity-60" : ""}`}>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-slate-800">{u.name || u.email}</span>
                    <span className="text-xs text-slate-500">{u.email}</span>
                    <span className={`text-[11px] font-semibold border rounded-full px-2 py-0.5 ${ROLE_COLORS[u.role]}`}>
                      {ROLE_LABELS[u.role] || u.role}
                    </span>
                    {!u.active && (
                      <span className="text-[11px] bg-red-100 text-red-700 border border-red-200 rounded-full px-2 py-0.5">
                        לא פעיל
                      </span>
                    )}
                  </div>
                  {u.phone && <p className="text-xs text-slate-400">{u.phone}</p>}
                  {u.notes && <p className="text-xs text-slate-400 italic">{u.notes}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => startEdit(u)} className="gap-1">
                    <Pencil className="w-3.5 h-3.5" />
                    ערוך
                  </Button>
                  <Button
                    size="sm"
                    variant={u.active ? "destructive" : "outline"}
                    onClick={() => toggleActive.mutate({ id: u.id, active: !u.active })}
                    className="text-xs"
                  >
                    {u.active ? "השבת" : "הפעל"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </RouteGuard>
  );
}