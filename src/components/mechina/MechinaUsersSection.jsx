import { useState, useEffect } from "react";
import { invokeWorkforce } from "@/lib/workforceApi";
import { Button } from "@/components/ui/button";
import { Users, Plus, UserX, UserCheck } from "lucide-react";
import { toast } from "sonner";

export default function MechinaUsersSection({ groupId, groupName }) {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ email: "", name: "", notes: "" });

  const loadAssignments = () => {
    invokeWorkforce("manageMechinaUsers", { action: "list_assignments", group_id: groupId })
      .then(res => setAssignments(res.assignments))
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadAssignments(); }, [groupId]);

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.email.trim()) { setError("אימייל משתמש הוא שדה חובה"); return; }

    setSaving(true);
    try {
      // Server validates the caller, creates/reactivates only a MECHINA_USER and upserts the assignment
      await invokeWorkforce("manageMechinaUsers", {
        action: "assign", group_id: groupId,
        email: form.email.trim(), name: form.name.trim(), notes: form.notes,
      });
      toast.success("המשתמש שויך למכינה בהצלחה");
      setForm({ email: "", name: "", notes: "" });
      setShowForm(false);
      loadAssignments();
    } catch (err) {
      setError(err?.message || "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  };

  const setAssignmentActive = async (assignment, isActive) => {
    try {
      await invokeWorkforce("manageMechinaUsers", { action: "set_assignment_active", assignment_id: assignment.id, is_active: isActive });
      toast.success(isActive ? "השיוך הופעל מחדש" : "השיוך בוטל");
      loadAssignments();
    } catch (err) {
      toast.error(err.message);
    }
  };
  const handleDeactivate = (assignment) => setAssignmentActive(assignment, false);
  const handleReactivate = (assignment) => setAssignmentActive(assignment, true);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold flex items-center gap-2 text-slate-800">
            <Users className="w-4 h-4" /> משתמשי מכינה
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            משתמשים שיכולים לשלוח בקשות מרחבים עבור קבוצה זו
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => { setShowForm(v => !v); setError(""); }} className="gap-1">
          <Plus className="w-3.5 h-3.5" /> שייך משתמש למכינה
        </Button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700">אימייל משתמש *</label>
              <input
                type="email"
                value={form.email}
                onChange={e => set("email", e.target.value)}
                placeholder="user@example.com"
                required
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary bg-white"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700">שם משתמש</label>
              <input
                type="text"
                value={form.name}
                onChange={e => set("name", e.target.value)}
                placeholder="שם מלא"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary bg-white"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700">הערות</label>
            <input
              type="text"
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
              placeholder="הערות אופציונליות..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary bg-white"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => { setShowForm(false); setError(""); }}>ביטול</Button>
            <Button type="submit" size="sm" disabled={saving}>{saving ? "שומר..." : "שייך משתמש"}</Button>
          </div>
        </form>
      )}

      {/* List */}
      {loading ? (
        <p className="text-sm text-muted-foreground py-2">טוען...</p>
      ) : assignments.length === 0 ? (
        <div className="border border-dashed border-slate-200 rounded-xl p-6 text-center bg-white">
          <p className="text-sm text-slate-400">לא שויכו משתמשים למכינה זו</p>
        </div>
      ) : (
        <div className="space-y-2">
          {assignments.map(a => (
            <div key={a.id} className={`bg-white border rounded-xl px-4 py-3 flex items-center gap-3 ${a.is_active ? "border-slate-200" : "border-slate-100 opacity-60"}`}>
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-sm font-semibold text-slate-800">{a.user_name || "—"}</p>
                <p className="text-xs text-slate-500">{a.user_email}</p>
                {a.notes && <p className="text-xs text-slate-400">{a.notes}</p>}
              </div>
              <span className={`text-xs font-medium border rounded-full px-2.5 py-0.5 ${a.is_active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-400 border-slate-200"}`}>
                {a.is_active ? "פעיל" : "לא פעיל"}
              </span>
              {a.is_active ? (
                <Button size="sm" variant="ghost" className="text-slate-400 hover:text-red-600 gap-1" onClick={() => handleDeactivate(a)}>
                  <UserX className="w-3.5 h-3.5" /> בטל שיוך
                </Button>
              ) : (
                <Button size="sm" variant="ghost" className="text-slate-400 hover:text-emerald-600 gap-1" onClick={() => handleReactivate(a)}>
                  <UserCheck className="w-3.5 h-3.5" /> הפעל מחדש
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}