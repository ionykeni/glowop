import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeWorkforce } from '@/lib/workforceApi';
import { useToast } from '@/components/ui/use-toast';
import NotificationStack from '@/components/notifications/NotificationStack';
import '@/components/notifications/notification-center.css';

export default function NotificationCenter({ identity }) {
  const [open, setOpen] = useState(false), [folder, setFolder] = useState('inbox');
  const root = useRef(null), bell = useRef(null), id = useId();
  const nav = useNavigate(), location = useLocation(), cache = useQueryClient(), { toast } = useToast();
  const key = ['attendance-notifications', identity];
  const call = (action, payload) => invokeWorkforce('attendanceNotifications', { action, ...payload });
  const { data: summary } = useQuery({ queryKey: [...key, 'summary'], queryFn: () => call('summary'), refetchInterval: 180000, staleTime: 60000, retry: false });
  const action = useMutation({ mutationFn: ({ action: name, id: rowId }) => call(name, { id: rowId }),
    onSuccess: async (_result, change) => {
      if (['archive', 'restore', 'clear_read'].includes(change.action)) await new Promise((resolve) => setTimeout(resolve, 280));
      await cache.invalidateQueries({ queryKey: key });
    },
    onError: () => toast({ title: 'לא ניתן לעדכן את ההתראה. נסו שוב.', variant: 'destructive' }),
  });
  useEffect(() => { setOpen(false); }, [location.key]);
  useEffect(() => {
    if (!open) return;
    const position = () => {
      const rect = bell.current.getBoundingClientRect();
      root.current.style.setProperty('--nc-shift', `${Math.max(0, Math.min(460, innerWidth - 32) + 16 - rect.right)}px`);
      root.current.style.setProperty('--nc-limit', `${Math.max(0, innerHeight - rect.bottom - 22)}px`);
    };
    const outside = (e) => { if (!root.current?.contains(e.target)) setOpen(false); };
    const escape = (e) => { if (e.key === 'Escape') { setOpen(false); bell.current?.focus(); } };
    position();
    window.addEventListener('resize', position); document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { window.removeEventListener('resize', position); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const unread = summary?.unread || 0;
  const visit = async (row) => { await action.mutateAsync({ action: 'read', id: row.id }); setOpen(false); nav(row.link); };
  return <div className="nc-root" ref={root} dir="rtl">
    <button type="button" ref={bell} className="nc-bell" aria-expanded={open} aria-controls={id} aria-label={`התראות, ${unread} שלא נקראו`} onClick={() => setOpen(!open)}>
      <Bell size={19} aria-hidden="true" />{unread > 0 && <span className="nc-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
    </button>
    <div className="nc-drop" data-open={open}><div className="nc-inner" inert={!open ? '' : undefined} aria-hidden={!open}>
      <NotificationStack {...{ id, open, folder, setFolder, summary, visit, action, identity }} />
    </div></div>
  </div>;
}