import { Clock, MapPin, Users, CalendarCheck, Hourglass } from "lucide-react";
import { GROUP_TYPE_LABELS, fmtMin, eventEnd } from "@/lib/spaceCalendarView";

function Row({ icon: Icon, children }) {
  return <div className="flex items-start gap-2 text-sm"><Icon className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" /><div className="min-w-0">{children}</div></div>;
}

export default function VscEventDetails({ event, spaceName, freeAgain }) {
  const pending = event.status === "PENDING";
  const who = event.group_names.length ? event.group_names.join(" · ") : "פעילות כללית";
  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex items-center gap-2">
        <span className={`vsc-swatch vsc-tone-${event.tone} ${pending ? "vsc-ev--pending" : ""}`} />
        <span className="text-xs font-semibold text-muted-foreground">{GROUP_TYPE_LABELS[event.group_type]}</span>
        <span className={`mr-auto text-[11px] font-bold px-2 py-0.5 rounded-full ${pending ? "bg-brand-yellow text-foreground" : "bg-accent text-accent-foreground"}`}>
          {pending ? "ממתין לאישור" : "מאושר"}
        </span>
      </div>
      <p className="font-heading text-base leading-snug break-words">{event.title}</p>
      <div className="space-y-1.5">
        <Row icon={Users}>{who}{event.pax ? <span className="text-muted-foreground"> · {event.pax} משתתפים</span> : null}</Row>
        <Row icon={MapPin}>{spaceName}</Row>
        <Row icon={Clock}>{event.start_time} – {eventEnd(event) >= 1440 ? "24:00" : event.end_time}</Row>
        {!pending && <Row icon={CalendarCheck}>המרחב פנוי שוב {freeAgain >= 1440 ? "מחר" : `מ־${fmtMin(freeAgain)}`}</Row>}
        {pending && <Row icon={Hourglass}><span className="text-muted-foreground">בקשה שטרם אושרה — אינה חוסמת את המרחב</span></Row>}
      </div>
    </div>
  );
}