import { Archive, ArchiveRestore } from 'lucide-react';

export default function NotificationRow({ row, time, visit, action, tabId }) {
  const archived = row.status === 'archived', management = row.event_type === 'NINE_HOURS';
  const Icon = archived ? ArchiveRestore : Archive;
  const cmd = archived ? 'restore' : 'archive';
  const leaving = action.isPending && (action.variables?.id === row.id && action.variables?.action === cmd || action.variables?.action === 'clear_read' && row.status === 'read');
  return <li className="nc-row" data-nc-row data-state={row.status} data-leaving={leaving}>
    <div className="nc-clip"><div className="nc-row-inner">
      <button type="button" className="nc-hit" disabled={action.isPending} onClick={() => visit(row).catch(() => {})}>
        <span className="sr-only">{row.status === 'unread' ? 'לא נקראה: ' : archived ? 'בארכיון: ' : 'נקראה: '}</span>
        <span className="nc-tag" data-management={management}>{management ? 'נוכחות' : 'משמרת'}</span>
        <span className="nc-text"><span className="line-clamp-2">{row.subject_name && <><b dir="auto">{row.subject_name}</b> · </>}<b>{row.title}</b></span>
          <span className="nc-body line-clamp-2">{row.body}</span><span className="nc-meta">{time} · {management ? 'שעון נוכחות' : 'סידור עבודה'}</span></span>
        <span className="nc-dot" aria-hidden="true" />
      </button>
      <button type="button" className="nc-quick" disabled={action.isPending} aria-label={archived ? 'שחזור מהארכיון' : 'העברה לארכיון'} onClick={() => { document.getElementById(tabId)?.focus(); action.mutate({ action: cmd, id: row.id }); }}><Icon size={16} /></button>
    </div></div>
  </li>;
}