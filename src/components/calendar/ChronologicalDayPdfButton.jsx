import { useState, useMemo } from "react";
import ReactDOM from "react-dom";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { buildChronologicalDayEvents } from "@/components/calendar/ChronologicalDayView";
import ChronologicalDayPrintTemplate from "@/components/calendar/ChronologicalDayPrintTemplate";
import { isGroupOperationallyEnabled } from "@/lib/groupOperationalIsolation";

export default function ChronologicalDayPdfButton({ dateStr, allGroups, allMeals, allActivities, allCoffeeRequests, allPrisaRequests, allSpaces }) {
  const [printing, setPrinting] = useState(false);

  const groupMap = useMemo(
    () => Object.fromEntries((allGroups || []).filter(isGroupOperationallyEnabled).map((g) => [g.id, g])),
    [allGroups]
  );
  const spaceMap = useMemo(
    () => Object.fromEntries((allSpaces || []).map((s) => [s.id, s])),
    [allSpaces]
  );
  const activeCoffeeKeys = useMemo(() => {
    const keys = new Set();
    (allCoffeeRequests || []).forEach((r) => { if (r.status === "ACTIVE") keys.add(`${r.group_id}|${r.date}`); });
    return keys;
  }, [allCoffeeRequests]);

  const events = useMemo(
    () => buildChronologicalDayEvents({ dateStr, allGroups, allMeals, allActivities, allCoffeeRequests, allPrisaRequests, activeCoffeeKeys }).map((e) => ({
      ...e,
      group_name: e.group_name || groupMap[e.group_id]?.group_name || null,
    })),
    [dateStr, allGroups, allMeals, allActivities, allCoffeeRequests, allPrisaRequests, activeCoffeeKeys, groupMap]
  );

  const handlePrint = () => {
    setPrinting(true);
    const printWindow = window.open("", "_blank", "width=820,height=1000");
    if (!printWindow) {
      alert("נא לאפשר חלונות קופצים כדי לייצא PDF");
      setPrinting(false);
      return;
    }

    printWindow.document.open();
    printWindow.document.write(`<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>סדר יום כרונולוגי</title>
<style>
  @font-face { font-family: 'Kav16'; src: url('https://raw.githubusercontent.com/jkenigsberger-cmd/fonts-/refs/heads/main/Kav16-Semibold.otf') format('opentype'); font-weight: 600; font-display: swap; }
  @font-face { font-family: 'SimplerPro'; src: url('https://raw.githubusercontent.com/jkenigsberger-cmd/fonts-/refs/heads/main/SimplerPro_HL-Regular.otf') format('opentype'); font-weight: 400; font-display: swap; }
  @font-face { font-family: 'SimplerPro'; src: url('https://raw.githubusercontent.com/jkenigsberger-cmd/fonts-/refs/heads/main/SimplerPro_HL-Bold.otf') format('opentype'); font-weight: 700; font-display: swap; }
  body { margin: 0; background: #fff; }
</style>
</head>
<body><div id="chrono-print-root"></div></body>
</html>`);
    printWindow.document.close();

    const container = printWindow.document.getElementById("chrono-print-root");
    ReactDOM.render(
      <ChronologicalDayPrintTemplate dateStr={dateStr} events={events} groupMap={groupMap} spaceMap={spaceMap} />,
      container,
      () => {
        setTimeout(() => {
          printWindow.focus();
          printWindow.print();
          setTimeout(() => {
            printWindow.close();
            setPrinting(false);
          }, 800);
        }, 350);
      }
    );
  };

  if (events.length === 0) return null;

  return (
    <Button variant="outline" size="sm" onClick={handlePrint} disabled={printing} className="gap-1.5">
      <Download className="w-3.5 h-3.5" />
      {printing ? "מכין..." : "ייצוא PDF"}
    </Button>
  );
}