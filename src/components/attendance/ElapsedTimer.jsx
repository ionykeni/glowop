import { useEffect, useState } from "react";
import { fmtClock } from "@/lib/attendanceFormat";

// Elapsed time derived from the server-recorded start (corrected for device clock skew), capped at the 13h cutoff.
export default function ElapsedTimer({ startAt, dueAt, offset }) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const t = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(t);
  }, [offset]);
  const end = Math.min(now, Date.parse(dueAt));
  return (
    <div dir="ltr" className="font-mono text-5xl sm:text-6xl font-bold tabular-nums tracking-tight text-foreground">
      {fmtClock(end - Date.parse(startAt))}
    </div>
  );
}