import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

// One editable proposed tent: tent, gender and participant count.
export default function ProposalRow({ row, tentOptions, takenTentIds, onChange, onRemove }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5 text-xs">
      <select
        className="h-8 rounded-md border border-input bg-background px-2"
        value={row.tent_id}
        onChange={e => onChange({ tent_id: e.target.value })}
      >
        {tentOptions.map(t => (
          <option key={t.id} value={t.id} disabled={t.id !== row.tent_id && takenTentIds.has(t.id)}>
            {t.neighborhood_name} · אוהל {t.code}
          </option>
        ))}
      </select>
      <select
        className="h-8 rounded-md border border-input bg-background px-2"
        value={row.gender_group}
        onChange={e => onChange({ gender_group: e.target.value })}
      >
        <option value="BOYS">בנים</option>
        <option value="GIRLS">בנות</option>
      </select>
      <Input
        type="number"
        min={1}
        className="h-8 w-20"
        value={row.allocated_pax}
        onChange={e => onChange({ allocated_pax: e.target.value })}
      />
      <span className="text-muted-foreground">אנשים</span>
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 mr-auto" onClick={onRemove}>
        <Trash2 className="w-4 h-4 text-destructive" />
      </Button>
    </div>
  );
}