import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export default function QuoteGlobalSearch({ value, onChange, resultCount }) {
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder="חיפוש הצעה, קבוצה, איש קשר, טלפון..."
          className="h-11 pr-10 pl-10 bg-card"
          aria-label="חיפוש בכל הצעות המחיר"
        />
        {value && (
          <button type="button" onClick={() => onChange("")} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="נקה חיפוש">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {value.trim() && <p className="text-xs text-muted-foreground">{resultCount} תוצאות מכל הסטטוסים</p>}
    </div>
  );
}