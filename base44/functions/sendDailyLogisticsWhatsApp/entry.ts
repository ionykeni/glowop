import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';

const PROMPT = `אתה כותב סיכום לוגיסטי יומי בעברית בלבד, להודעת WhatsApp, עבור מנהל תפעול ומנהל משק בית של אתר 'הדור הבא'.
השתמש רק בנתונים המצורפים (JSON). אל תמציא שעות, כמויות או סטטוסים. אם שעה חסרה — כתוב "שעה לא הוגדרה".
מבנה:
1. כותרת קצרה עם התאריך.
2. ✅ נתונים ומשימות מאושרים — לפי עדיפות ושעה, רק סעיפים רלוונטיים:
🚐 הגעות / יציאות (שעות)
☀️ קבוצות יום (DAY_USE) — הגעה, יציאה, פעילויות ובקשות
☕ פינות קפה — שעה, קבוצה, כמות, מיקום, סוג
🏠 חללים להכנה ופעילויות (ציוד נדרש)
🛏️ לינה ללא שיבוץ מאושר (רק מתוך sleeping_missing_allocation)
🔧 תחזוקה — תקלות פתוחות לפי עדיפות, וחסימות חללים
🧹 משק בית — הכנת אוהלים להגעות, ניקיון אחרי יציאות
3. 💡 המלצות (הצעות בלבד, לא עובדות) — עד 4 שורות קצרות.
כל פריט בשורה נפרדת עם "•". ללא טבלאות, ללא markdown מודגש. קצר וברור.
אם אין משימות רלוונטיות — כתוב זאת בשורה אחת, והוסף המלצה רק אם הנתונים מצדיקים.
אסור לטעון שפינת קפה מוכנה או שתקלה תוקנה.`;

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const ctxRes = await base44.functions.invoke('getLogisticsOperationalContext', { include_reminders: true });
    const ctx = ctxRes.data;
    delete ctx.meeting_summaries;

    const message = await base44.integrations.Core.InvokeLLM({
      prompt: `${PROMPT}\n\nנתונים:\n${JSON.stringify(ctx)}`,
    });

    const token = secrets.get('WHATSAPP_TOKEN');
    const phoneId = secrets.get('WHATSAPP_PHONE_NUMBER_ID');
    const to = secrets.get('WHATSAPP_RECIPIENT');
    if (!token || !phoneId || !to) {
      return Response.json({ sent: false, reason: 'WhatsApp secrets missing', message });
    }

    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: String(message).slice(0, 4000) } }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await res.json();
    if (!res.ok) return Response.json({ sent: false, error: result, message }, { status: 502 });
    return Response.json({ sent: true, date: ctx.requested_date });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}