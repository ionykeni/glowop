export default function VscLegend() {
  return (
    <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span className="vsc-swatch vsc-tone-0" /> מאושר (צבע לפי קבוצה)</span>
      <span className="inline-flex items-center gap-1.5"><span className="vsc-swatch vsc-tone-0 vsc-ev--pending" /> ממתין לאישור — אינו חוסם</span>
      <span className="inline-flex items-center gap-1.5"><span className="vsc-swatch vsc-blocked border border-border" /> סגור / חסום</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-0.5 h-3 bg-destructive inline-block" /> השעה עכשיו</span>
      <span>אזור ריק = פנוי</span>
    </div>
  );
}