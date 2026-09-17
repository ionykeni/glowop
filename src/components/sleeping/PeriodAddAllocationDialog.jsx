import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SLEEPING_PERIOD_SCOPE } from "@/lib/sleepingPeriodScope";
import { toast } from "sonner";
import { sortTentsNaturally } from "./tentCodeSort";

export default function PeriodAddAllocationDialog({ kind, vipRequirement, requirementIndex, groupId, selectedPeriodId, tents, neighborhoods, hasLaterPeriods, defaultPax, requiredPax, allocatedPax, defaultGender, onClose, onSaved }) {
  const compatible = useMemo(() => sortTentsNaturally(tents.filter(tent => tent.working_status === "WORKING" && (kind === "VIP" ? tent.tent_type === "VIP" : tent.tent_type !== "VIP"))), [tents, kind]);
  const [tentId, setTentId] = useState("");
  const [pax, setPax] = useState("");
  const [paxManuallyEdited, setPaxManuallyEdited] = useState(false);
  const [gender, setGender] = useState(kind === "VIP" ? (["BOYS", "MEN"].includes(vipRequirement?.gender_group) ? "MEN" : "WOMEN") : defaultGender || "MIXED");
  const [scope, setScope] = useState(SLEEPING_PERIOD_SCOPE.ONLY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const tent = compatible.find(item => item.id === tentId);
  const physicalCapacity = item => kind === "VIP" || item.is_accessible ? Math.max(Number(item.capacity || 0), 4) : Number(item.capacity || 0);
  const physicalMax = tent ? physicalCapacity(tent) : 0;
  const handleTentChange = event => {
    const nextTentId = event.target.value;
    const nextTent = compatible.find(item => item.id === nextTentId);
    setTentId(nextTentId);
    if (!paxManuallyEdited) {
      const remainingNeed = Number(kind === "VIP" ? vipRequirement?.people_count : defaultPax) || 1;
      setPax(nextTent ? Math.min(remainingNeed, physicalCapacity(nextTent)) : "");
    }
  };
  const overRequired = Number(requiredPax) > 0 && Number(allocatedPax || 0) + Number(pax || 0) > Number(requiredPax);
  const save = async () => {
    setSaving(true); setError("");
    const marker = kind === "VIP" ? `__vip_req_${requirementIndex}__` : "";
    try {
      const { data } = await base44.functions.invoke("manageScopedSleepingRelease", { action: "ADD", group_id: groupId, destination_tent_id: tentId, allocated_pax: Number(pax), allocation_type: kind === "VIP" ? "STAFF" : "STUDENT", gender_group: gender, notes: kind === "VIP" ? `${marker}${vipRequirement?.notes ? ` ${vipRequirement.notes}` : ""}` : "", edit_scope: { mode: hasLaterPeriods ? scope : SLEEPING_PERIOD_SCOPE.ONLY, selected_period_id: selectedPeriodId } });
      if (!data?.success) throw new Error(data?.error || "הוספת השיבוץ נכשלה");
      if (data.warnings?.some(item => item.code === "OVER_REQUIRED_PAX")) toast.warning("השיבוץ גבוה מהכמות הנדרשת");
      toast.success(data.affected_period_count > 1 ? "האוהל נוסף לתקופה זו ולתקופות הבאות" : "האוהל נוסף לתקופה זו"); onSaved();
    } catch (err) { setError(err?.response?.data?.error || err.message); }
    finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={onClose}><DialogContent className="max-w-md" dir="rtl"><DialogHeader><DialogTitle className="text-right">{kind === "VIP" ? "הוסף שיבוץ VIP" : "הוסף אוהל"}</DialogTitle></DialogHeader><div className="space-y-4">
    <div><label className="text-xs font-semibold text-slate-600">שכונה / אוהל</label><select value={tentId} onChange={handleTentChange} className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"><option value="">בחר אוהל</option>{compatible.map(item => <option key={item.id} value={item.id}>{neighborhoods.find(n => n.id === item.neighborhood_id)?.name || "שכונה"} / אוהל {item.code}</option>)}</select></div>
    <div className="grid grid-cols-2 gap-3"><div><label className="text-xs font-semibold text-slate-600">מספר אנשים</label><Input type="number" min="1" value={pax} onChange={event => { setPax(event.target.value); setPaxManuallyEdited(true); }} className="mt-1" />{kind === "VIP" ? <p className="mt-1 text-[11px] text-slate-400">דרישת VIP: {Number(vipRequirement?.people_count || 0)}</p> : <p className="mt-1 text-[11px] text-slate-400">נותרו לשיבוץ: {Number(defaultPax || 0)}</p>}</div><div><label className="text-xs font-semibold text-slate-600">מגדר</label><select value={gender} onChange={event => setGender(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">{(kind === "VIP" ? [["MEN","גברים"],["WOMEN","נשים"]] : [["BOYS","בנים"],["GIRLS","בנות"],["MIXED","מעורב"]]).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
    {hasLaterPeriods && <div className="space-y-2"><p className="text-xs font-semibold text-slate-600">כיצד להחיל את השיבוץ?</p>{[[SLEEPING_PERIOD_SCOPE.ONLY,"רק לתקופה הזו"],[SLEEPING_PERIOD_SCOPE.FORWARD,"לתקופה הזו ולכל התקופות הבאות"]].map(([value,label]) => <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="radio" checked={scope === value} onChange={() => setScope(value)} />{label}</label>)}</div>}
    {overRequired && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">השיבוץ גבוה מהכמות הנדרשת</p>}{tent && Number(pax) > physicalMax && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">מספר האנשים גבוה מקיבולת האוהל ({physicalMax})</p>}{error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={saving}>ביטול</Button><Button onClick={save} disabled={saving || !tentId || Number(pax) < 1 || Number(pax) > physicalMax}>{saving ? "שומר..." : "הוסף אוהל"}</Button></div>
  </div></DialogContent></Dialog>;
}