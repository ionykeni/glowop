// Soft segmented control. Labels never wrap; on narrow screens the strip scrolls instead of breaking the layout.
export default function SegmentedTabs({ tabs, value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto rounded-2xl bg-cream-deep/70 p-1 ring-1 ring-warm-line/50 [scrollbar-width:none]">
      {tabs.map((t) => {
        const active = value === t.id;
        return (
          <button key={t.id} type="button" role="tab" aria-selected={active} onClick={() => onChange(t.id)}
            className={`inline-flex h-10 min-w-max flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:bg-card/60 hover:text-foreground"}`}>
            <span>{t.label}</span>
            {t.count > 0 && (
              <span aria-label={`${t.count} ממתינות`} className="inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold leading-none text-white tabular-nums shadow-sm shadow-red-500/30">
                {t.count > 99 ? "99+" : t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}