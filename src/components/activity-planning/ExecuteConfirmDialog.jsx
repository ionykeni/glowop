import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function ExecuteConfirmDialog({ open, onOpenChange, preview, onConfirm }) {
  if (!preview) return null;
  const pending = preview.stations.filter(s => s.status === "PENDING");
  const groupNames = [...new Set(preview.stations.flatMap(s => s.groups.map(g => g.group_name)))];
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent dir="rtl" className="max-w-lg max-h-[85vh] overflow-y-auto text-right">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-right">יצירת יום פעילות</AlertDialogTitle>
          <AlertDialogDescription className="text-right text-slate-700">
            הפעולה תיצור פעילויות אמיתיות במערכת ותשריין את המרחבים שנבחרו. האם להמשיך?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 text-sm">
          <p><span className="text-slate-500">תבנית:</span> {preview.template.name} · גרסה {preview.template.version}</p>
          <p><span className="text-slate-500">תאריך:</span> {preview.date} · <span className="text-slate-500">תחנות:</span> {preview.stations.length}</p>
          <p><span className="text-slate-500">קבוצות משתתפות:</span> {groupNames.join(", ")}</p>
          <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100">
            {preview.stations.map(s => (
              <li key={s.station_id} className="px-3 py-1.5 text-xs">
                <span className="font-semibold">{s.start_time}–{s.end_time}</span> · {s.title || "ללא שם"} · {s.space_name}
                <span className="block text-slate-500">{s.groups.map(g => g.group_name).join(", ")}</span>
              </li>
            ))}
          </ul>
          {pending.length > 0 && (
            <div className="flex gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>קיימות בקשות ממתינות (לא הזמנות מאושרות) בתחנות: {pending.map(s => s.title || s.space_name).join(", ")}. אינן חוסמות את היצירה.</span>
            </div>
          )}
        </div>
        <AlertDialogFooter className="gap-2 sm:flex-row-reverse sm:justify-start">
          <Button onClick={onConfirm}>אישור ויצירת פעילויות</Button>
          <AlertDialogCancel>ביטול</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}