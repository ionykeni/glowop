import React from "react";

const STYLES = {
  ACTIVE: ["פעיל", "bg-green-50 text-green-700 border-green-200"],
  UPDATING: ["בעדכון", "bg-yellow-50 text-yellow-700 border-yellow-200"],
  NEEDS_RECOVERY: ["נדרשת השלמה", "bg-red-50 text-red-700 border-red-200"],
  CANCELLED: ["בוטל", "bg-slate-100 text-slate-500 border-slate-200"],
  INCOMPLETE: ["יצירה לא הושלמה", "bg-red-50 text-red-700 border-red-200"],
  PAST: ["עבר", "bg-slate-100 text-slate-500 border-slate-200"],
};

export function resolveState(ex, today) {
  if (ex.state !== "COMPLETED") return "INCOMPLETE";
  if (ex.management_state && ex.management_state !== "ACTIVE") return ex.management_state;
  if (today && ex.date < today) return "PAST";
  return "ACTIVE";
}

export default function ManagementStateBadge({ state }) {
  const [label, cls] = STYLES[state] || STYLES.ACTIVE;
  return <span className={`activity-day-status inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>{label}</span>;
}