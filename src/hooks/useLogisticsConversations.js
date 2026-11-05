import { useState, useEffect, useCallback, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { LOGISTICS_AGENT_NAME } from "@/lib/logisticsAssistantConfig";

// Persistent logistics-assistant conversations for ONE user.
// Only conversations created by this user for this agent are ever shown or opened.
const byUpdatedDesc = (a, b) => String(b.updated_date || "").localeCompare(String(a.updated_date || ""));

export default function useLogisticsConversations(userId) {
  const storageKey = `logistics_assistant_conversation_${userId}`;
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [initializing, setInitializing] = useState(true);
  const [notice, setNotice] = useState(null);
  const requestRef = useRef(0);

  const isMine = useCallback(
    (c) => c && c.agent_name === LOGISTICS_AGENT_NAME && c.created_by_id === userId && !c.deleted_at && !c.is_archived,
    [userId]
  );

  const refreshList = useCallback(async () => {
    const rows = await base44.agents.listConversations({ agent_name: LOGISTICS_AGENT_NAME, sort: "-updated_date", limit: 50 });
    const mine = (Array.isArray(rows) ? rows : []).filter(isMine).sort(byUpdatedDesc);
    setConversations(mine);
    return mine;
  }, [isMine]);

  const startNew = useCallback(() => {
    requestRef.current++;
    localStorage.removeItem(storageKey);
    setConversation(null);
    setMessages([]);
    setNotice(null);
  }, [storageKey]);

  const openConversation = useCallback(async (id) => {
    const token = ++requestRef.current;
    const conv = await base44.agents.getConversation(id).catch(() => null);
    if (token !== requestRef.current) return;
    if (!isMine(conv)) {
      localStorage.removeItem(storageKey);
      setConversation(null);
      setMessages([]);
      setNotice("השיחה שנבחרה אינה זמינה עוד. ניתן להתחיל שיחה חדשה.");
      return;
    }
    localStorage.setItem(storageKey, conv.id);
    setConversation(conv);
    setMessages(conv.messages || []);
    setNotice(null);
  }, [isMine, storageKey]);

  // Reopen the last selected conversation, else the most recent one with messages.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const mine = await refreshList();
        if (cancelled) return;
        const stored = localStorage.getItem(storageKey);
        const target = mine.find(c => c.id === stored) || mine.find(c => (c.messages || []).length > 0);
        if (target) await openConversation(target.id);
      } catch {
        if (!cancelled) setNotice("לא ניתן לטעון שיחות קודמות כרגע. ניתן להמשיך בשיחה חדשה.");
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Live updates for the selected conversation only.
  useEffect(() => {
    if (!conversation?.id) return;
    const unsub = base44.agents.subscribeToConversation(conversation.id, (data) => {
      if (data?.id && data.id !== conversation.id) return;
      setMessages(data?.messages || []);
    });
    return () => unsub && unsub();
  }, [conversation?.id]);

  // Returns the selected conversation; creates one only when the user sends in "new conversation" mode.
  const ensureConversation = useCallback(async () => {
    if (conversation) return conversation;
    const conv = await base44.agents.createConversation({
      agent_name: LOGISTICS_AGENT_NAME,
      metadata: { name: "עוזר לוגיסטיקה", description: "צ'אט פרטי עם עוזר הלוגיסטיקה" },
    });
    requestRef.current++;
    localStorage.setItem(storageKey, conv.id);
    setConversation(conv);
    return conv;
  }, [conversation, storageKey]);

  return {
    conversations, conversation, messages, setMessages, initializing, notice,
    openConversation, startNew, ensureConversation, refreshList,
  };
}