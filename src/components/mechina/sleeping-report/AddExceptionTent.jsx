import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

// Lets the user report students physically sleeping in a tent not officially assigned to the group.
// Does not change any official allocation.
export default function AddExceptionTent({ tents, neighborhoods, excludeIds, onAdd }) {
  const [open, setOpen] = useState(false);
  const [tentId, setTentId] = useState("");
  const nbName = Object.fromEntries(neighborhoods.map(n => [n.id, n.name]));
  const options = tents.filter(t => !excludeIds.has(t.id))
    .sort((a, b) => String(a.code).localeCompare(String(b.code), "he", { numeric: true }));

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="gap-1.5 border-dashed w-full" onClick={() => setOpen(true)}>
        <Plus className="w-4 h-4" /> חניכים ישנים באוהל אחר (חריגה)
      </Button>
    );
  }
  return (
    <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 space-y-2">
      <p className="text-xs text-orange-800">בחר את האוהל שבו החניכים ישנים בפועל. השיבוץ הרשמי לא ישתנה.</p>
      <div className="flex gap-2">
        <select value={tentId} onChange={e => setTentId(e.target.value)} className="flex-1 border border-border rounded-lg px-2 py-2 text-sm bg-background">
          <option value="">בחר אוהל...</option>
          {options.map(t => <option key={t.id} value={t.id}>{t.code} — {nbName[t.neighborhood_id] || ""}</option>)}
        </select>
        <Button size="sm" disabled={!tentId} onClick={() => { onAdd(tentId); setTentId(""); setOpen(false); }}>הוסף</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>ביטול</Button>
      </div>
    </div>
  );
}