import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { callPlanner, isSelectable, stationFromTemplate, toPreviewStations, uniqueGroupsSummary } from "@/lib/activityDayPlanning";

// In-memory plan only. Nothing here is persisted.
export default function useActivityDayPlan(templateId) {
  const [date, setDate] = useState("");
  const [stations, setStations] = useState([]);
  const [pool, setPool] = useState([]);
  const [pruned, setPruned] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewKey, setPreviewKey] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const tplQuery = useQuery({ queryKey: ["plan-template", templateId], queryFn: () => callPlanner("load_template", { template_id: templateId }), enabled: !!templateId });
  const template = tplQuery.data?.success ? tplQuery.data.template : null;
  useEffect(() => { if (template) setStations(template.stations.map(stationFromTemplate)); }, [template?.id]);

  const dayQuery = useQuery({ queryKey: ["plan-day", templateId, date], queryFn: () => callPlanner("load_day", { template_id: templateId, date }), enabled: !!template && !!date });
  const groups = dayQuery.data?.success ? dayQuery.data.groups : [];
  const groupsById = useMemo(() => Object.fromEntries(groups.map(g => [g.id, g])), [groups]);

  // When the date's groups arrive, drop any selection that is no longer eligible and say which.
  useEffect(() => {
    if (!dayQuery.data?.success) return;
    const ok = new Set(dayQuery.data.groups.filter(isSelectable).map(g => g.id));
    const removed = new Set([...pool, ...stations.flatMap(s => s.groups)].filter(id => !ok.has(id)));
    setPruned([...removed]);
    if (removed.size === 0) return;
    setPool(p => p.filter(id => ok.has(id)));
    setStations(list => list.map(s => ({ ...s, groups: s.groups.filter(id => ok.has(id)) })));
  }, [dayQuery.data]);

  const payloadStations = toPreviewStations(stations);
  const currentKey = JSON.stringify([date, payloadStations]);

  const updateStation = (id, patch) => setStations(l => l.map(s => (s.station_id === id ? { ...s, ...patch } : s)));
  const togglePool = (id) => setPool(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  const selectAllEligible = () => setPool(groups.filter(isSelectable).map(g => g.id));
  const applyPoolToAll = () => setStations(l => l.map(s => (s.removed ? s : { ...s, groups: [...pool] })));
  const summary = uniqueGroupsSummary(stations, groupsById);

  const runPreview = async () => {
    setPreviewing(true); setPreviewError("");
    const res = await callPlanner("preview", { template_id: templateId, template_updated_date: template.updated_date, date, stations: payloadStations });
    setPreviewing(false);
    if (!res.success) return setPreviewError(res.error);
    setPreview(res); setPreviewKey(currentKey);
  };

  return {
    tplQuery, template, spaces: tplQuery.data?.spaces || [], date, setDate, dayQuery, groups, groupsById,
    stations, updateStation, pool, togglePool, selectAllEligible, applyPoolToAll, summary, pruned,
    payloadStations, preview, previewStale: !!preview && previewKey !== currentKey, previewing, previewError, runPreview,
    canPreview: !!date && payloadStations.length > 0,
  };
}