import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { LOGISTICS_AGENT_NAME } from "@/lib/logisticsAssistantConfig";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

export default function WhatsAppConnectButton() {
  const [open, setOpen] = useState(false);
  const url = base44.agents.getWhatsAppConnectURL(LOGISTICS_AGENT_NAME);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="mr-auto flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5 hover:bg-emerald-100 transition-colors">
          <MessageCircle className="w-3.5 h-3.5" />
          WhatsApp
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-right" dir="rtl">
        <p className="text-sm font-semibold text-slate-800 mb-1">Conectar a WhatsApp</p>
        <ol className="text-xs text-slate-600 space-y-1 list-decimal pr-4 mb-3" dir="ltr" style={{ textAlign: "left" }}>
          <li>Pulsa el botón y abre WhatsApp.</li>
          <li>Envía el mensaje que aparece para vincular tu cuenta.</li>
          <li>Después, escribe tú primero al asistente (p. ej. "מה יש לי היום?").</li>
        </ol>
        <p className="text-[11px] text-slate-400 mb-3" dir="ltr" style={{ textAlign: "left" }}>
          El asistente responde solo cuando le escribes. No envía mensajes automáticos.
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setOpen(false)}
          className="block text-center text-sm font-medium bg-emerald-600 text-white rounded-lg py-2 hover:bg-emerald-700 transition-colors"
        >
          Abrir WhatsApp
        </a>
      </PopoverContent>
    </Popover>
  );
}