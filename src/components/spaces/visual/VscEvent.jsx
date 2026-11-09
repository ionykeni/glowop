import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import VscEventDetails from "./VscEventDetails";

// One event (timeline block or week chip) with its compact details popover.
export default function VscEvent({ event, className, style, spaceName, freeAgain, children }) {
  const pending = event.status === "PENDING";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          style={style}
          className={`${className} vsc-tone-${event.tone} ${pending ? "vsc-ev--pending" : ""}`}
          aria-label={`${event.title}, ${event.start_time}–${event.end_time}${pending ? ", ממתין" : ""}`}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4" align="center" sideOffset={6}>
        <VscEventDetails event={event} spaceName={spaceName} freeAgain={freeAgain} />
      </PopoverContent>
    </Popover>
  );
}