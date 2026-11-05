import { XCircle } from "lucide-react";

const parse = (v) => { try { return JSON.parse(v || "[]"); } catch { return []; } };
const gender = (g) => (g === "GIRLS" ? "בנות" : g === "BOYS" ? "בנים" : "");

// Shows what the original request asked for but the proposal does NOT include.
export default function ProposalMissingList({ proposal }) {
  if (proposal.completeness !== "INCOMPLETE") return null;
  const missing = parse(proposal.missing_json);
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs space-y-1" dir="rtl">
      <p className="font-semibold text-destructive flex items-center gap-1">
        <XCircle className="w-3.5 h-3.5" /> הצעה חלקית — לא כל הבקשה המקורית נכללה
      </p>
      {missing.length === 0 && <p className="text-slate-600">הרשימה שהתקבלה אינה תואמת לסיכום הבקשה — ראה אזהרות.</p>}
      {missing.map((m, i) => (
        <p key={i} className="text-slate-700">
          • {m.tent_code ? `אוהל ${m.tent_code}` : "חניכים"}{m.neighborhood ? ` (${m.neighborhood})` : ""}{m.pax ? ` — ${m.pax} ${gender(m.gender_group)}` : ""}: {m.reason}
        </p>
      ))}
    </div>
  );
}