/**
 * QuoteSyncButton
 * Shows a diff preview and lets admin sync accepted Quote data into an existing Group.
 * Visible only when:
 *  - Quote is APPROVED
 *  - Quote has a linked group_id
 *  - At least one field differs between Quote and Group/OGP
 */
import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import RoleGate from "@/components/RoleGate";
import { buildQuoteOperationalDiff } from "@/lib/quoteOperationalDiff";

export default function QuoteSyncButton({ quote, group, profile, onSynced }) {
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [blockError, setBlockError] = useState(null);

  if (!quote || !["APPROVED", "DRAFT"].includes(quote.status) || !group) return null;

  const diffs = buildQuoteOperationalDiff(quote, group, profile);
  if (diffs.length === 0) return null;

  const handleSync = async () => {
    setSyncing(true);
    setBlockError(null);
    // Guard: sync requires an existing OGP — never create a duplicate here.
    if (!profile) {
      setSyncing(false);
      setBlockError("עדכון הנתונים התפעוליים נכשל — לא נמצא פרופיל תפעולי לקבוצה. יש לאשר/ליצור פרופיל תפעולי תחילה.");
      return;
    }
    let res;
    try {
      res = await base44.functions.invoke("syncQuoteToOperationalGroup", {
        quote_id: quote.id,
        group_id: group.id,
      });
    } catch {
      setSyncing(false);
      setBlockError("עדכון הנתונים התפעוליים נכשל — יש לבדוק את הקבוצה והפרופיל התפעולי");
      return;
    }
    setSyncing(false);
    if (res.data?.success) {
      toast.success("הנתונים התפעוליים עודכנו מההצעה");
      setOpen(false);
      onSynced?.();
    } else {
      setBlockError(res.data?.error || "עדכון הנתונים התפעוליים נכשל — יש לבדוק את הקבוצה והפרופיל התפעולי");
    }
  };

  return (
    <RoleGate roles={["admin", "ADMIN", "SUPER_ADMIN", "OPERATIONS"]}>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 text-xs h-7 border-amber-400 text-amber-700 hover:bg-amber-50"
        onClick={() => { setBlockError(null); setOpen(true); }}
      >
        <RefreshCw className="w-3.5 h-3.5" />
        עדכן נתונים תפעוליים מההצעה
      </Button>

      {open && (
        <Dialog open onOpenChange={() => setOpen(false)}>
          <DialogContent dir="rtl" className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-right">עדכון נתונים תפעוליים מההצעה</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground text-xs">
                השדות הבאים ישתנו בקבוצה ובפרופיל התפעולי:
              </p>

              <div className="border border-border rounded-lg divide-y divide-border">
                {diffs.map((d, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 gap-4">
                    <span className="font-medium text-xs text-muted-foreground w-28 shrink-0">{d.label}</span>
                    <span className="text-xs text-red-600 line-through">{d.from}</span>
                    <span className="text-xs">→</span>
                    <span className="text-xs text-green-700 font-semibold">{d.to}</span>
                  </div>
                ))}
              </div>

              {blockError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 whitespace-pre-line">
                  ⛔ {blockError}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                שיבוצי לינה קיימים לא יושפעו. במידה וקיימים שיבוצים פעילים ומספר המשתתפים משתנה, תיווצר התראה לצוות השיבוץ.
              </p>

              <div className="flex gap-2 justify-end pt-1">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)}>ביטול</Button>
                <Button
                  size="sm"
                  disabled={syncing}
                  onClick={handleSync}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {syncing ? "מסנכרן..." : "אשר וסנכרן"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </RoleGate>
  );
}