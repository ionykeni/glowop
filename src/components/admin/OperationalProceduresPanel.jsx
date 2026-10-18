import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Pencil, Archive, RotateCcw, Trash2, X, BookOpen } from "lucide-react";
import { useRoleContext } from "@/lib/RoleContext";

const SOURCE_URL = "https://docs.google.com/document/d/1qMjOlxeK7Ewf25xXkn-hUUF5gpGhMKVrCj0Xkyw2w_4/edit";

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
    queryFn: () => base44.entities.OperationalProcedure.list({ sort: "code" }),
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
        source_document_url: SOURCE_URL,
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
    mutationFn: (id) => base44.entities.OperationalProcedure.delete(id),
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
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-amber-400" />
          <h2 className="text-sm font-bold text-white">נהלי תפעול</h2>
        </div>
        {canEdit && !showForm && (
          <Button size="sm" variant="outline" onClick={openCreate} className="gap-1.5 text-xs">
            <Plus className="w-3.5 h-3.5" /> הוסף נוהל
          </Button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-4 rounded-lg border border-slate-600 bg-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-amber-400">{editingId ? "עריכת נוהל" : "נוהל חדש"}</p>
            <button type="button" onClick={resetForm} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">קוד נוהל</label>
              <Input
                value={formData.code}
                onChange={(e) => setFormData((f) => ({ ...f, code: e.target.value }))}
                disabled={!!editingId}
                placeholder="MORNING"
                className="bg-slate-800 border-slate-600 text-white"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">קטגוריה</label>
              <Input
                value={formData.category}
                onChange={(e) => setFormData((f) => ({ ...f, category: e.target.value }))}
                placeholder="משמרת / שבת / ארוחות"
                className="bg-slate-800 border-slate-600 text-white"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">כותרת</label>
            <Input
              value={formData.title}
              onChange={(e) => setFormData((f) => ({ ...f, title: e.target.value }))}
              placeholder="נוהל משמרת בוקר"
              className="bg-slate-800 border-slate-600 text-white"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">תוכן הנוהל</label>
            <Textarea
              value={formData.content}
              onChange={(e) => setFormData((f) => ({ ...f, content: e.target.value }))}
              rows={10}
              dir="rtl"
              className="bg-slate-800 border-slate-600 text-white font-mono text-xs"
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

      {deleteTarget && (
        <div className="mb-4 rounded-lg border border-red-600 bg-red-950/50 p-4 space-y-3">
          <p className="text-sm text-red-200">
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

      {isLoading ? (
        <p className="text-xs text-slate-500 text-center py-4">טוען נהלים...</p>
      ) : procedures.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-4">אין נהלים עדיין</p>
      ) : (
        <div className="space-y-2">
          {procedures.map((proc) => (
            <div
              key={proc.id}
              className={`rounded-lg border p-3 transition-opacity ${
                proc.is_active
                  ? "border-slate-600 bg-slate-900/60"
                  : "border-slate-700 bg-slate-900/30 opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
                      {proc.code}
                    </span>
                    {proc.category && (
                      <span className="text-[10px] text-slate-400">{proc.category}</span>
                    )}
                    {!proc.is_active && (
                      <span className="text-[10px] text-amber-400">מושבת</span>
                    )}
                  </div>
                  <h3 className="text-sm font-semibold text-white mt-1">{proc.title}</h3>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openEdit(proc)}
                      className="p-1.5 text-slate-400 hover:text-blue-400 rounded"
                      title="ערוך"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {proc.is_active ? (
                      <button
                        onClick={() => toggleActiveMutation.mutate({ id: proc.id, active: false })}
                        className="p-1.5 text-slate-400 hover:text-amber-400 rounded"
                        title="השבת"
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => toggleActiveMutation.mutate({ id: proc.id, active: true })}
                        className="p-1.5 text-slate-400 hover:text-emerald-400 rounded"
                        title="הפעל מחדש"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {isSuperAdmin && (
                      <button
                        onClick={() => setDeleteTarget(proc)}
                        className="p-1.5 text-slate-400 hover:text-red-400 rounded"
                        title="מחק לצמיתות"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
              <pre className="mt-2 text-xs text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">
                {proc.content}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}