import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, PencilLine } from "lucide-react";
import { callTemplates } from "@/lib/activityDayTemplatesApi";
import useActivitySpaceOptions from "@/hooks/useActivitySpaceOptions";
import TemplateEditor from "./TemplateEditor";
import VersionSelector from "./VersionSelector";
import ReadyVersionView from "./ReadyVersionView";

export default function TemplateFamilyView({ familyId, onFamilyCreated }) {
  const isNew = familyId === "new";
  const qc = useQueryClient();
  const { spaces, byId } = useActivitySpaceOptions();
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["activity-day-template-family", familyId],
    queryFn: () => callTemplates("get_family", { family_id: familyId }),
    enabled: !isNew,
  });

  const handleSaved = (t) => {
    qc.invalidateQueries({ queryKey: ["activity-day-templates"] });
    qc.invalidateQueries({ queryKey: ["activity-day-template-family", t.family_id] });
    if (isNew) onFamilyCreated(t.family_id); else setSelectedId(t.id);
  };

  if (isNew) return <TemplateEditor template={null} spaces={spaces} onSaved={handleSaved} />;
  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (!data?.success) return <p className="text-sm text-red-600 text-center py-10">{data?.error || "טעינת התבנית נכשלה"}</p>;

  const versions = data.versions;
  const draft = versions.find(v => v.status === "DRAFT");
  const selected = versions.find(v => v.id === selectedId) || draft || versions[0];

  const startNewVersion = async () => {
    setBusy(true); setError("");
    const res = await callTemplates("new_version", { family_id: familyId });
    setBusy(false);
    if (!res.success) return setError(res.error);
    handleSaved(res.template);
  };

  return (
    <div className="space-y-4">
      <VersionSelector versions={versions} selectedId={selected.id} onSelect={setSelectedId} />
      {selected.status === "DRAFT" ? (
        <TemplateEditor key={selected.id} template={selected} spaces={spaces} onSaved={handleSaved} />
      ) : (
        <>
          <ReadyVersionView template={selected} spacesById={byId} warnings={data.warnings} />
          {draft ? (
            <Button variant="outline" onClick={() => setSelectedId(draft.id)} className="w-full gap-1.5"><PencilLine className="w-4 h-4" /> פתח את הטיוטה הפתוחה (גרסה {draft.version})</Button>
          ) : (
            <Button onClick={startNewVersion} disabled={busy} className="w-full gap-1.5">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PencilLine className="w-4 h-4" />} ערוך — יצירת גרסה חדשה כטיוטה
            </Button>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </>
      )}
    </div>
  );
}