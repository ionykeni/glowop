import moment from "moment";
import { History, MessageSquarePlus, Check } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function titleOf(conv) {
  const first = (conv.messages || []).find(m => m.role === "user" && m.content);
  return first ? first.content.replace(/\s+/g, " ").slice(0, 45) : "שיחה חדשה";
}

function dateOf(conv) {
  const raw = conv.updated_date || conv.created_date;
  if (!raw) return "";
  return moment.utc(raw).local().format("DD/MM HH:mm");
}

export default function ConversationSwitcher({ conversations, currentId, onSelect, onNew, disabled }) {
  return (
    <div className="flex items-center gap-1.5" dir="rtl">
      <button
        onClick={onNew}
        disabled={disabled}
        className="flex items-center gap-1 text-xs text-slate-600 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-40"
      >
        <MessageSquarePlus className="w-3.5 h-3.5" /> שיחה חדשה
      </button>
      <DropdownMenu dir="rtl">
        <DropdownMenuTrigger asChild>
          <button
            disabled={disabled}
            className="flex items-center gap-1 text-xs text-slate-600 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-40"
          >
            <History className="w-3.5 h-3.5" /> שיחות קודמות
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 max-h-96 overflow-y-auto" dir="rtl">
          <DropdownMenuLabel className="text-xs">שיחות קודמות</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {conversations.length === 0 && (
            <div className="px-2 py-3 text-xs text-slate-400 text-center">אין שיחות קודמות</div>
          )}
          {conversations.map(c => (
            <DropdownMenuItem key={c.id} onSelect={() => onSelect(c.id)} className="flex items-start gap-2 cursor-pointer">
              <Check className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${c.id === currentId ? "text-primary" : "invisible"}`} />
              <div className="min-w-0 flex-1 text-right">
                <p className="text-xs text-slate-700 truncate">{titleOf(c)}</p>
                <p className="text-[10px] text-slate-400">{dateOf(c)} · {(c.messages || []).length} הודעות</p>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}