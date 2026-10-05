import moment from "moment";
import "moment/locale/he";
import { buildChronologicalDayEvents } from "@/components/calendar/ChronologicalDayView";
import { PRISA_SLOT_LABELS, PRISA_SLOT_ORDER } from "@/lib/prisaLabels";

moment.locale("he");

const SLOT_TO_MEAL_TYPE = {
  AFTER_BREAKFAST: "BREAKFAST",
  AFTER_LUNCH: "LUNCH",
  AFTER_DINNER: "DINNER",
};

const TYPE_LABELS = {
  arrival: "הגעה",
  departure: "עזיבה",
  dayuse: "באי יום",
  meal: "ארוחה",
  coffee: "פינת קפה",
  activity: "פעילות",
};

const TYPE_COLORS = {
  arrival: "#059669",
  departure: "#ea580c",
  dayuse: "#0d9488",
  meal: "#d97706",
  coffee: "#ca8a04",
  activity: "#7c3aed",
};

function resolveSpaceName(event, spaceMap) {
  if (event.type === "activity" && event._activity?.activity_space_id) {
    return spaceMap[event._activity.activity_space_id]?.name || "";
  }
  return event.location || "";
}

function buildDietText(meal) {
  if (!meal?.special_diets_summary) return "";
  let d = null;
  try { d = JSON.parse(meal.special_diets_summary); } catch { return ""; }
  if (!d) return "";
  const items = [
    d.lifeThreatening_count > 0 ? `⚠ ${d.lifeThreatening_count} אלרגיות` : "",
    d.vegetarian_count > 0 ? `${d.vegetarian_count} צמחוני` : "",
    d.vegan_count > 0 ? `${d.vegan_count} טבעוני` : "",
    d.glutenFree_count > 0 ? `${d.glutenFree_count} ללא גלוטן` : "",
  ].filter(Boolean);
  return items.join(" · ");
}

function buildEquipmentText(item) {
  const LOGISTICS = [
    ["needs_projector", "מקרן"],
    ["needs_screen", "מסך"],
    ["needs_microphone", "מיקרופון"],
    ["needs_sound", "מערכת סאונד"],
    ["needs_whiteboard", "לוח"],
    ["needs_chair_circle", "מעגל כיסאות"],
  ];
  const parts = LOGISTICS.filter(([k]) => item[k]).map(([, l]) => l);
  if (item.chairs_count > 0) parts.push(`כיסאות: ${item.chairs_count}`);
  if (item.logistics_other) parts.push(item.logistics_other);
  return parts.join(", ");
}

export default function ChronologicalDayPrintTemplate({ dateStr, events, groupMap, spaceMap }) {
  const dateLabel = moment(dateStr).format("dddd, D בMMMM YYYY");

  const timed = events.filter((e) => e.time).sort((a, b) => a.time.localeCompare(b.time));
  const prisaEvents = events.filter((e) => e.type === "prisa");
  const untimed = events.filter((e) => !e.time && e.type !== "prisa");

  // Interleave Prisa after the last meal of the corresponding type
  const sorted = [...timed];
  const prisaWithoutMeal = [];
  const prisaBySlot = {};
  prisaEvents.forEach((p) => {
    const slot = p._prisa_slot;
    if (!prisaBySlot[slot]) prisaBySlot[slot] = [];
    prisaBySlot[slot].push(p);
  });
  Object.entries(prisaBySlot)
    .sort(([a], [b]) => (PRISA_SLOT_ORDER[a] ?? 99) - (PRISA_SLOT_ORDER[b] ?? 99))
    .forEach(([slot, prisas]) => {
      const mealType = SLOT_TO_MEAL_TYPE[slot];
      let lastIdx = -1;
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].type === "meal" && sorted[i]._meal?.meal_type === mealType) { lastIdx = i; break; }
      }
      if (lastIdx >= 0) sorted.splice(lastIdx + 1, 0, ...prisas);
      else prisaWithoutMeal.push(...prisas);
    });
  const prisaUntimedBySlot = prisaWithoutMeal.reduce((acc, p) => {
    const slot = p._prisa_slot;
    if (!acc[slot]) acc[slot] = [];
    acc[slot].push(p);
    return acc;
  }, {});
  const prisaUntimedSlots = Object.keys(prisaUntimedBySlot)
    .sort((a, b) => (PRISA_SLOT_ORDER[a] ?? 99) - (PRISA_SLOT_ORDER[b] ?? 99));

  const renderRow = (event) => {
    const color = TYPE_COLORS[event.type] || "#475569";
    const groupName = event.group_name || groupMap[event.group_id]?.group_name || "";
    const spaceName = resolveSpaceName(event, spaceMap);
    const typeLabel = event.type === "meal" ? event.title : TYPE_LABELS[event.type] || event.type;
    const timeText = event.time
      ? `${event.time}${event.end_time ? ` - ${event.end_time}` : ""}`
      : "—";
    const dietText = event.type === "meal" ? buildDietText(event._meal) : "";
    const equipText = event.type === "activity" && event._activity ? buildEquipmentText(event._activity) : "";

    return (
      <tr key={event.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
        <td style={{ padding: "6px 8px", fontFamily: "monospace", fontSize: "11px", fontWeight: 700, color, whiteSpace: "nowrap", direction: "ltr", textAlign: "right", verticalAlign: "top" }}>
          {timeText}
        </td>
        <td style={{ padding: "6px 8px", verticalAlign: "top" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color }}>
            {typeLabel}
          </div>
          {groupName && <div style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginTop: "1px" }}>{groupName}</div>}
          {spaceName && <div style={{ fontSize: "11px", color: "#64748b", marginTop: "1px" }}>📍 {spaceName}</div>}
          {event.pax > 0 && <div style={{ fontSize: "11px", color: "#64748b" }}>{event.pax} 👤</div>}
          {event.details && <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "1px" }}>{event.details}</div>}
          {equipText && <div style={{ fontSize: "11px", color: "#64748b", marginTop: "1px" }}>🔧 {equipText}</div>}
          {dietText && <div style={{ fontSize: "11px", color: "#b45309", marginTop: "2px" }}>{dietText}</div>}
        </td>
      </tr>
    );
  };

  return (
    <div
      id="chrono-print-container"
      dir="rtl"
      style={{
        maxWidth: "800px",
        margin: "0 auto",
        padding: "24px",
        fontFamily: "SimplerPro, Arial Hebrew, Arial, sans-serif",
        color: "#1a1a1a",
        background: "#fff",
      }}
    >
      {/* Header */}
      <div style={{ borderBottom: "2px solid #1a56a0", paddingBottom: "10px", marginBottom: "16px", textAlign: "center" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1a56a0", fontFamily: "Kav16, Arial Hebrew, Arial, sans-serif", margin: 0 }}>
          סדר יום כרונולוגי
        </h1>
        <p style={{ fontSize: "14px", color: "#475569", marginTop: "4px" }}>{dateLabel}</p>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "14px", fontSize: "11px", color: "#64748b" }}>
        {Object.entries(TYPE_LABELS).map(([key, label]) => (
          <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: TYPE_COLORS[key] }} />
            {label}
          </span>
        ))}
      </div>

      {/* Events table */}
      {events.length === 0 ? (
        <p style={{ textAlign: "center", color: "#94a3b8", padding: "40px 0", fontSize: "14px" }}>אין אירועים ביום זה</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #cbd5e1" }}>
              <th style={{ padding: "6px 8px", fontSize: "11px", fontWeight: 700, color: "#64748b", textAlign: "right", width: "120px" }}>שעה</th>
              <th style={{ padding: "6px 8px", fontSize: "11px", fontWeight: 700, color: "#64748b", textAlign: "right" }}>פרטים</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(renderRow)}
            {untimed.length > 0 && (
              <tr>
                <td colSpan={2} style={{ padding: "10px 8px 4px", fontSize: "11px", color: "#94a3b8", fontWeight: 600, borderTop: "1px dashed #cbd5e1" }}>
                  ללא שעה
                </td>
              </tr>
            )}
            {untimed.map(renderRow)}
            {prisaUntimedSlots.map(slot => (
              <tr key={`label-${slot}`}>
                <td colSpan={2} style={{ padding: "10px 8px 4px", fontSize: "11px", color: "#ea580c", fontWeight: 600, borderTop: "1px dashed #fed7aa" }}>
                  {PRISA_SLOT_LABELS[slot] || slot}
                </td>
              </tr>
            ))}
            {prisaUntimedSlots.flatMap(slot => prisaUntimedBySlot[slot].map((e, i) => renderRow(e, `${slot}-${i}`)))}
          </tbody>
        </table>
      )}

      {/* Footer */}
      <div style={{ marginTop: "20px", paddingTop: "10px", borderTop: "1px solid #e2e8f0", fontSize: "10px", color: "#94a3b8", textAlign: "center" }}>
        נוצר באופן אוטומטי · {moment().format("D/M/YYYY HH:mm")}
      </div>
    </div>
  );
}