import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Send, Sparkles } from "lucide-react";
import MessageBubble from "./MessageBubble";
import { LOGISTICS_AGENT_NAME, isLogisticsManager } from "@/lib/logisticsAssistantConfig";

const SUGGESTIONS = [
  "מה יש לי היום?",
  "מה נשאר לי להיום?",
  "יש עוד פינות קפה היום?",
  "מי מגיע היום?",
  "מחר באיזו שעה כולם יוצאים?",
  "מה עדיין פתוח בתחזוקה?",
];

export default function LogisticsChatPage({ userEmail }) {
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  // Create conversation on mount
  useEffect(() => {
    let unsub = null;
    let cancelled = false;

    async function init() {
      try {
        const conv = await base44.agents.createConversation({
          agent_name: LOGISTICS_AGENT_NAME,
          metadata: { name: "עוזר לוגיסטיקה", description: "צ'אט פרטי עם עוזר הלוגיסטיקה" },
        });
        if (cancelled) return;
        setConversation(conv);
        setMessages(conv.messages || []);

        unsub = base44.agents.subscribeToConversation(conv.id, (data) => {
          setMessages(data.messages || []);
        });
      } catch (err) {
        console.error("Failed to init logistics conversation:", err);
      }
    }

    init();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(async (text) => {
    const content = (text ?? input).trim();
    if (!content || !conversation || loading) return;

    setInput("");
    setLoading(true);

    try {
      await base44.agents.addMessage(conversation, { role: "user", content });
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setLoading(false);
    }
  }, [conversation, input, loading]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] sm:h-[calc(100vh-3.5rem)]" dir="rtl">
      {/* Header */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 flex items-center gap-2">
        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary">
          <Sparkles className="w-4.5 h-4.5" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-slate-800">עוזר לוגיסטיקה</h1>
          <p className="text-[11px] text-slate-400">קופילוט תפעולי פרטי · קריאה בלבד</p>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50/50">
        {!hasMessages && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-8">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 text-primary">
              <Sparkles className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-700">שלום! אני העוזר הלוגיסטי שלך</p>
              <p className="text-xs text-slate-400 max-w-xs">שאל אותי על היום שלך, פינות קפה, תחזוקה, הגעות ויציאות, ומה צריך להכין.</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-md">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="text-xs text-slate-600 bg-white border border-slate-200 rounded-full px-3 py-1.5 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <MessageBubble key={idx} message={msg} />
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="כתוב הודעה..."
            className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/30 max-h-32"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || loading}
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}