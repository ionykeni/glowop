import { Fragment, useEffect, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { invokeWorkforce } from '@/lib/workforceApi';
import { fmtDateTime, fmtDay, localDate, israelToday, addDays } from '@/lib/attendanceFormat';
import NotificationRow from '@/components/notifications/NotificationRow';

export default function NotificationList({ folder, id, open, visit, action, identity, emptyIcon: EmptyIcon }) {
  const scroll = useRef(null), measured = useRef(false);
  const query = useInfiniteQuery({ queryKey: ['attendance-notifications', identity, 'list', folder], enabled: open, retry: false,
    initialPageParam: null, queryFn: ({ pageParam }) => invokeWorkforce('attendanceNotifications', { action: 'list', folder, cursor: pageParam }),
    getNextPageParam: (page) => page.next_cursor || undefined, refetchInterval: open ? 180000 : false,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) || [];
  const today = israelToday();
  useEffect(() => { scroll.current.scrollTop = 0; }, [folder]);
  useEffect(() => {
    const node = scroll.current;
    let live = true, width;
    const fit = () => {
      if (!live || !node.clientWidth) return;
      const top = node.getBoundingClientRect().top - node.scrollTop;
      const padding = parseFloat(window.getComputedStyle(node).paddingBottom) || 0;
      const ends = [...node.querySelectorAll('[data-nc-row]')].map((r) => Math.ceil(r.getBoundingClientRect().bottom - top + padding));
      const best = Math.max(0, ...ends.filter((h) => h > 0 && h <= 456));
      node.style.setProperty('--nc-list-size', `${best || (ends.length ? 456 : 180)}px`);
      if (ends.length) measured.current = true;
    };
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.width;
      if (next > 0 && width !== next) { width = next; fit(); }
    });
    observer.observe(node); document.fonts?.ready.then(fit);
    return () => { live = false; observer.disconnect(); };
  }, []);
  useEffect(() => {
    if (measured.current || !rows.length) return;
    const node = scroll.current, top = node.getBoundingClientRect().top - node.scrollTop;
    const ends = [...node.querySelectorAll('[data-nc-row]')].map((r) => Math.ceil(r.getBoundingClientRect().bottom - top + 8));
    const best = Math.max(0, ...ends.filter((h) => h > 0 && h <= 456));
    if (best) { node.style.setProperty('--nc-list-size', `${best}px`); measured.current = true; }
  }, [rows.length]);
  return <div className="nc-card nc-scroll" ref={scroll} id={`${id}-list`} role="tabpanel" aria-labelledby={`${id}-${folder}`}>
    {query.isError && !rows.length ? <div className="nc-empty"><p>לא ניתן לטעון את ההתראות</p><button type="button" onClick={() => query.refetch()}>ניסיון נוסף</button></div>
      : query.isPending && open ? <p className="nc-empty" role="status">טוען התראות…</p>
        : !rows.length ? <div className="nc-empty"><EmptyIcon size={32} /><strong>{folder === 'archived' ? 'אין התראות בארכיון' : 'אין התראות בתיקייה'}</strong></div>
          : <ul>{rows.map((row, i) => { const day = localDate(row.created_at); return <Fragment key={row.id}>
            {(i === 0 || day !== localDate(rows[i - 1].created_at)) && <li className="nc-day">{day === today ? 'היום' : day === addDays(today, -1) ? 'אתמול' : fmtDay(day)}</li>}
            <NotificationRow row={row} time={fmtDateTime(row.created_at)} visit={visit} action={action} tabId={`${id}-${folder}`} />
          </Fragment>; })}</ul>}
    {query.hasNextPage && <button type="button" className="nc-more" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>{query.isFetchingNextPage ? 'טוען…' : 'התראות נוספות'}</button>}
  </div>;
}