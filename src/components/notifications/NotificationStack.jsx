import { Inbox, Minus, Plus } from 'lucide-react';
import NotificationList from '@/components/notifications/NotificationList';

const folders = { inbox: 'דואר נכנס', general: 'כללי', archived: 'ארכיון' };
const keys = Object.keys(folders);
const zero = { unread: 0, total: 0 };

export default function NotificationStack({ id, open, folder, setFolder, summary, visit, action, identity }) {
  const info = summary?.folders[folder] || zero, inbox = summary?.folders.inbox || zero;
  const general = summary?.folders.general || zero, archived = folder === 'archived';
  const value = archived ? info.total : info.unread;
  const fraction = inbox.total ? inbox.unread / inbox.total * 100 : 0;
  const hasRead = inbox.total + general.total > (summary?.unread || 0);
  const onKey = (e) => {
    let i = keys.indexOf(folder);
    if (e.key === 'ArrowRight') i = (i + 2) % 3;
    else if (e.key === 'ArrowLeft') i = (i + 1) % 3;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = 2;
    else return;
    e.preventDefault(); setFolder(keys[i]); document.getElementById(`${id}-${keys[i]}`)?.focus();
  };
  return <section id={id} className="nc-stack" aria-label="מרכז התראות">
    <header className="nc-card nc-header">
      <div><p>{!summary ? 'מרכז התראות' : value ? 'כרגע יש לך' : archived ? 'אין התראות בארכיון' : 'אין התראות חדשות'}</p>
        <h2 aria-live="polite">{!summary ? 'התראות' : value ? `${value} ${archived ? 'בארכיון' : 'חדשות'}` : archived ? 'ריק' : 'הכול נקרא'}</h2></div>
      <div className="nc-folder-legend"><b>{folders[folder]}</b><svg viewBox="0 0 72 72" aria-hidden="true">
        <circle className="nc-ring-track" cx="36" cy="36" r="31" /><circle className="nc-ring-arc" cx="36" cy="36" r="31" pathLength="100" strokeDasharray={`${fraction} 100`} opacity={fraction ? 1 : 0} />
        <circle className="nc-ring-mid" cx="36" cy="36" r="20" /><circle className="nc-ring-core" cx="36" cy="36" r="10" />
      </svg></div>
    </header>
    <div className="nc-card nc-tabs" role="tablist" aria-label="תיקיות התראות" onKeyDown={onKey}>
      {keys.map((name) => { const Icon = name === folder ? Minus : Plus; return <button key={name} type="button" id={`${id}-${name}`} aria-controls={`${id}-list`} role="tab" aria-selected={name === folder} tabIndex={name === folder ? 0 : -1} data-folder={name} onClick={() => setFolder(name)}>{folders[name]}<Icon size={13} aria-hidden="true" /></button>; })}
    </div>
    <NotificationList {...{ folder, id, open, visit, action, identity }} emptyIcon={Inbox} />
    <footer className="nc-card nc-footer">
      <span>{archived ? `${info.total} בארכיון` : `${info.unread} מתוך ${info.total} לא נקראו`}</span>
      <div><button type="button" disabled={!hasRead || action.isPending} onClick={() => action.mutate({ action: 'clear_read' })}>העברה לארכיון של מה שנקרא</button>
        <button type="button" disabled={!summary?.unread || action.isPending} onClick={() => action.mutate({ action: 'read_all' })}>סימון הכול כנקרא</button></div>
    </footer>
  </section>;
}