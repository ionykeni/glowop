import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Pencil, Archive, RotateCcw, Trash2, X, BookOpen } from "lucide-react";
import { useRoleContext } from "@/lib/RoleContext";

export default function OperationalProceduresPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { role } = useRoleContext();
  const isSuperAdmin = role === "SUPER_ADMIN";
  const canEdit = role === "SUPER_ADMIN" || role === "ADMIN";

  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ code: "", title: "", content: "", category: "" });
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: procedures = [], isLoading } = useQuery({
    queryKey: ["operationalProcedures"],
    queryFn: async () => {
      const res = await base44.entities.OperationalProcedure.list({ sort: "code" });
      return res.items || [];
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["operationalProcedures"] });

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (editingId) {
        return base44.entities.OperationalProcedure.update(editingId, {
          title: data.title,
          content: data.content,
          category: data.category,
        });
      }
      return base44.entities.OperationalProcedure.create({
        code: data.code,
        title: data.title,
        content: data.content,
        category: data.category,
        is_active: true,
      });
    },
    onSuccess: () => {
      toast({ title: editingId ? "הנוהל עודכן" : "הנוהל נוסף" });
      invalidate();
      resetForm();
    },
    onError: (err) => toast({ title: "שגיאה בשמירה", description: err?.message, variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }) =>
      base44.entities.OperationalProcedure.update(id, { is_active: active }),
    onSuccess: () => { toast({ title: "הסטטוס עודכן" }); invalidate(); },
    onError: (err) => toast({ title: "שגיאה", description: err?.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.functions.invoke("deleteOperationalProcedure", { id }),
    onSuccess: () => { toast({ title: "הנוהל נמחק" }); setDeleteTarget(null); invalidate(); },
    onError: (err) => toast({ title: "שגיאה במחיקה", description: err?.message, variant: "destructive" }),
  });

  const resetForm = () => {
    setEditingId(null);
    setShowForm(false);
    setFormData({ code: "", title: "", content: "", category: "" });
  };

  const openCreate = () => {
    setEditingId(null);
    setFormData({ code: "", title: "", content: "", category: "" });
    setShowForm(true);
  };

  const openEdit = (proc) => {
    setEditingId(proc.id);
    setFormData({ code: proc.code, title: proc.title, content: proc.content, category: proc.category || "" });
    setShowForm(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.content.trim()) {
      toast({ title: "יש למלא כותרת ותוכן", variant: "destructive" });
      return;
    }
    if (!editingId && !formData.code.trim()) {
      toast({ title: "יש למלא קוד נוהל", variant: "destructive" });
      return;
    }
    saveMutation.mutate(formData);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" />
          <h2 className="text-base font-bold text-foreground">נהלי תפעול</h2>
        </div>
        {canEdit && !showForm && (
          <Button size="sm" onClick={openCreate} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> הוספה חדשה
          </Button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-primary">{editingId ? "עריכת נוהל" : "נוהל חדש"}</p>
            <button type="button" onClick={resetForm} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">קוד נוהל</label>
              <Input
                value={formData.code}
                onChange={(e) => setFormData((f) => ({ ...f, code: e.target.value }))}
                disabled={!!editingId}
                placeholder="MORNING"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">קטגוריה</label>
              <Input
                value={formData.category}
                onChange={(e) => setFormData((f) => ({ ...f, category: e.target.value }))}
                placeholder="משמרת / שבת / ארוחות"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">כותרת</label>
            <Input
              value={formData.title}
              onChange={(e) => setFormData((f) => ({ ...f, title: e.target.value }))}
              placeholder="נוהל משמרת בוקר"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">תוכן הנוהל</label>
            <Textarea
              value={formData.content}
              onChange={(e) => setFormData((f) => ({ ...f, content: e.target.value }))}
              rows={10}
              dir="rtl"
              className="font-mono text-xs"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={resetForm}>ביטול</Button>
            <Button type="submit" size="sm" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "שומר..." : "שמור"}
            </Button>
          </div>
        </form>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-3">
          <p className="text-sm text-destructive">
            מחיקה לצמיתות של <span className="font-bold">{deleteTarget.title}</span>?
            פעולה זו אינה הפיכה.
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setDeleteTarget(null)}>ביטול</Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? "מוחק..." : "מחק לצמיתות"}
            </Button>
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-8">טוען נהלים...</p>
      ) : procedures.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8 border-2 border-dashed border-border rounded-xl">
          אין נהלים עדיין
        </p>
      ) : (
        <div className="space-y-3">
          {procedures.map((proc) => (
            <div
              key={proc.id}
              className={`rounded-xl border p-4 transition-opacity bg-card shadow-sm ${
                proc.is_active
                  ? "border-border"
                  : "border-border opacity-60"
              }`}
            >
              {/* Top row: actions (left) + category badge (right) */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1">
                  {canEdit && (
                    <>
                      <button
                        onClick={() => openEdit(proc)}
                        className="p-1.5 text-muted-foreground hover:text-primary rounded-lg hover:bg-muted transition-colors"
                        title="ערוך"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {proc.is_active ? (
                        <button
                          onClick={() => toggleActiveMutation.mutate({ id: proc.id, active: false })}
                          className="p-1.5 text-muted-foreground hover:text-amber-600 rounded-lg hover:bg-muted transition-colors"
                          title="השבת"
                        >
                          <Archive className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => toggleActiveMutation.mutate({ id: proc.id, active: true })}
                          className="p-1.5 text-muted-foreground hover:text-emerald-600 rounded-lg hover:bg-muted transition-colors"
                          title="הפעל מחדש"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                      {isSuperAdmin && (
                        <button
                          onClick={() => setDeleteTarget(proc)}
                          className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg hover:bg-muted transition-colors"
                          title="מחק לצמיתות"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {proc.code}
                  </span>
                  {proc.category && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                      {proc.category}
                    </span>
                  )}
                  {!proc.is_active && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                      מושבת
                    </span>
                  )}
                </div>
              </div>

              {/* Title */}
              <h3 className="text-sm font-bold text-foreground">{proc.title}</h3>

              {/* Content */}
              <pre className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed">
                {proc.content}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}