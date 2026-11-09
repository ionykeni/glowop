import VscWeekCell from "./VscWeekCell";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DAY_NAMES, weekDates, spaceCode } from "@/lib/spaceCalendarView";

// Weekly grid: 1 + 7 equal columns at every width. Click a day to inspect exact hours.
export default function VscWeekGrid({ spaces, events, blocks, date, now, onOpenDay }) {
  const dates = weekDates(date);
  return (
    <div className="vsc-week">
      <table>
        <thead>
          <tr>
            <th scope="col">מרחב</th>
            {dates.map((d, i) => (
              <th key={d} scope="col">
                <button type="button" className="vsc-dayhead" aria-current={d === now.date ? "date" : undefined} onClick={() => onOpenDay(d)} title="מעבר לתצוגה יומית">
                  <span className="vsc-dayhead-dow">{DAY_NAMES[i]}</span>
                  <span className="vsc-dayhead-num">{Number(d.slice(8))}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spaces.map(space => (
            <tr key={space.id}>
              <th scope="row" className="vsc-rowhead">
                <span className="vsc-rowname" title={space.name}>{space.name}</span>
                <Popover>
                  <PopoverTrigger asChild><button type="button" className="vsc-rowcode" aria-label={space.name}>{spaceCode(space.name)}</button></PopoverTrigger>
                  <PopoverContent className="w-auto max-w-[220px] px-3 py-2 text-xs font-semibold" side="left">{space.name}</PopoverContent>
                </Popover>
              </th>
              {dates.map(d => (
                <td key={d}>
                  <VscWeekCell space={space} date={d} onOpenDay={onOpenDay}
                    events={events.filter(e => e.space_id === space.id && e.date === d)}
                    blocks={blocks.filter(b => b.space_id === space.id)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {spaces.length === 0 && <p className="text-sm text-muted-foreground text-center py-10">אין מרחבים להצגה</p>}
    </div>
  );
}