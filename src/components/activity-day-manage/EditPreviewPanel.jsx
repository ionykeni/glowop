import React from "react";

const Row = ({ label, children }) => <div className="flex gap-2"><span className="text-slate-500 w-24 shrink-0">{label}</span><span className="text-slate-800">{children}</span></div>;
const names = (list) => list.map(g => g.group_name).join(", ");

export default function EditPreviewPanel({ preview, station }) {
  const { diff, target } = preview;
  return (
    <div className="space-y-2 text-sm">
      {preview.no_changes ? (
        <div className="bg-slate-50 border border-slate-200 rounded p-2 text-slate-600">לא בוצעו שינויים בתחנה</div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded p-3 space-y-1">
          {diff.title_changed && <Row label="שם">{station.title} ← {target.title}</Row>}
          {diff.time_changed && <Row label="שעה">{station.start_time}–{station.end_time} ← {target.start_time}–{target.end_time}</Row>}
          {diff.space_changed && <Row label="חדר">{station.space_name} ← {preview.space_name}</Row>}
          {diff.added.length > 0 && <Row label="נוספות">{names(diff.added)}</Row>}
          {diff.removed.length > 0 && <Row label="מוסרות">{names(diff.removed)}</Row>}
          {diff.kept.length > 0 && <Row label="נשארות">{names(diff.kept)}</Row>}
          {diff.space_changed && <div className="text-xs text-slate-500 pt-1">החדר הקודם ישוחרר באותה פעולה.</div>}
        </div>
      )}
      {preview.blockers.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded p-2 text-red-800">
          <div className="font-semibold mb-1">לא ניתן לשמור:</div>
          <ul className="list-disc pr-4 space-y-0.5">{preview.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
      )}
      {preview.warnings.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-yellow-800">
          <ul className="list-disc pr-4 space-y-0.5">{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
    </div>
  );
}