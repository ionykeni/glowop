import { AlertTriangle, CheckCircle2 } from "lucide-react";

const GENDERS = [["BOYS", "בנים"], ["GIRLS", "בנות"]];
const sum = (list, g, key) => list.filter(r => r.gender_group === g).reduce((s, r) => s + (Number(r[key]) || 0), 0);

// Per-gender reconciliation: existing (already saved) + proposed vs requested and vs Group requirement.
// `existing` must already exclude drafts created by this proposal, so nothing is counted twice.
export default function ProposalReconciliation({ proposal, rows, existing, profile }) {
  const required = {
    BOYS: Number(profile?.boys_beds_needed ?? profile?.boys_count ?? 0),
    GIRLS: Number(profile?.girls_beds_needed ?? profile?.girls_count ?? 0),
  };
  const requested = { BOYS: proposal.requested_boys, GIRLS: proposal.requested_girls };
  const lines = GENDERS.map(([g, label]) => {
    const already = sum(existing, g, "pax");
    const proposed = sum(rows, g, "allocated_pax");
    const reqShort = requested[g] != null ? Math.max(0, requested[g] - proposed) : 0;
    const groupLeft = Math.max(0, required[g] - already - proposed);
    return { g, label, already, proposed, req: requested[g], reqShort, required: required[g], groupLeft };
  });
  const short = lines.some(l => l.reqShort > 0 || l.groupLeft > 0);

  return (
    <div className={`rounded-lg border px-3 py-2 text-xs space-y-1 ${short ? "border-amber-400 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>
      <div className="flex items-center gap-1 font-semibold">
        {short ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
        {short ? "שיבוץ חלקי — לא כל המשתתפים שובצו" : "כל המשתתפים מכוסים"}
      </div>
      {lines.map(l => (
        <div key={l.g}>
          <span className="font-semibold">{l.label}:</span> כבר משובצים {l.already} · בהצעה {l.proposed}
          {l.req != null && <> · התבקשו {l.req}{l.reqShort > 0 && <b className="text-destructive"> (חסרים {l.reqShort})</b>}</>}
          {l.required > 0 && <> · נדרש לפי הקבוצה {l.required} · נותרו ללא שיבוץ <b className={l.groupLeft ? "text-destructive" : ""}>{l.groupLeft}</b></>}
        </div>
      ))}
      {short && <p className="text-[11px]">ניתן לאשר שיבוץ חלקי — החוסר יישאר מסומן במסך הלינה.</p>}
    </div>
  );
}