import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Send, Sparkles } from "lucide-react";
import MessageBubble from "./MessageBubble";
import WhatsAppConnectButton from "./WhatsAppConnectButton";
import ConversationSwitcher from "./ConversationSwitcher";
import useLogisticsConversations from "@/hooks/useLogisticsConversations";

const SUGGESTIONS = [
  "מה יש לי היום?",
  "מה נשאר לי להיום?",
  "יש עוד פינות קפה היום?",
  "מי מגיע היום?",
  "מחר באיזו שעה כולם יוצאים?",
  "מה עדיין פתוח בתחזוקה?",
];

export default function LogisticsChatPage({ userId }) {
  const {
    conversations, conversation, messages, setMessages, initializing, notice,
    openConversation, startNew, ensureConversation, refreshList,
  } = useLogisticsConversations(userId);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendError, setSendError] = useState(null);
  const scrollRef = useRef(null);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(async (text) => {
    const content = (text ?? input).trim();
    if (!content || initializing || loading) return;

    setInput("");
    setSendError(null);
    setLoading(true);

    try {
      const conv = await ensureConversation();
      setMessages(m => [...m, { role: "user", content }]);
      await base44.agents.addMessage(conv, { role: "user", content });
      refreshList().catch(() => {});
    } catch (err) {
      console.error("Failed to send message:", err);
      setInput(content);
      setSendError("שליחת ההודעה נכשלה. נסה שוב.");
    } finally {
      setLoading(false);
    }
  }, [input, loading, initializing, ensureConversation, setMessages, refreshList]);

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
        <WhatsAppConnectButton />
        <div className="mr-auto">
          <ConversationSwitcher
            conversations={conversations}
            currentId={conversation?.id}
            onSelect={openConversation}
            onNew={startNew}
            disabled={initializing || loading}
          />
        </div>
      </div>

      {notice && (
        <div className="shrink-0 bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-800">{notice}</div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50/50">
        {initializing && (
          <div className="flex items-center justify-center h-full text-xs text-slate-400">טוען שיחות…</div>
        )}
        {!initializing && !hasMessages && (
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
        {sendError && <p className="text-xs text-destructive mb-1.5">{sendError}</p>}
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