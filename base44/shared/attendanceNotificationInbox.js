import { isId } from './attendancePolicy.js';

const FOLDERS = ['inbox', 'general', 'archived'];
const bad = (status, error) => ({ status, error });
const card = ({ id, title, body, subject_name, event_type, link, status, created_at }) => ({ id, title, body, subject_name, event_type, link, status, created_at });
const folderQuery = (folder) => folder === 'archived' ? { status: 'archived' } : { folder, status: { $in: ['read', 'unread'] } };

export async function attendanceNotificationInbox(entity, userId, input, now = new Date().toISOString()) {
  if (!userId) return bad(401, 'Unauthorized');
  const owner = { recipient_user_id: userId };
  const { action, folder, cursor, id } = input || {};
  if (action === 'summary') {
    const { rows } = await entity.aggregate({ query: owner, groupBy: ['folder', 'status'] });
    const folders = Object.fromEntries(FOLDERS.map((f) => [f, { unread: 0, total: 0 }]));
    for (const row of rows) {
      if (!['inbox', 'general'].includes(row.folder)) continue;
      if (row.status === 'archived') folders.archived.total += row.count;
      else {
        folders[row.folder].total += row.count;
        if (row.status === 'unread') folders[row.folder].unread += row.count;
      }
    }
    return { folders, unread: folders.inbox.unread + folders.general.unread };
  }
  if (action === 'list') {
    if (!FOLDERS.includes(folder) || (cursor != null && (typeof cursor !== 'string' || cursor.length > 2048))) return bad(400, 'תיקיית התראות לא תקינה');
    const page = await entity.filter({ ...owner, ...folderQuery(folder) }, { sort: '-created_at', limit: 30, ...(cursor ? { cursor } : {}) });
    return { items: page.items.map(card), next_cursor: page.has_more ? page.next_cursor : null };
  }
  if (action === 'read_all' || action === 'clear_read') {
    const read = action === 'read_all';
    const query = { ...owner, status: read ? 'unread' : 'read' };
    do {
      const result = await entity.updateMany(query, { $set: read ? { status: 'read', read_at: now } : { status: 'archived' } });
      if (!result.has_more || !result.updated) break;
    } while (true);
    return { ok: true };
  }
  if (!['read', 'archive', 'restore'].includes(action) || !isId(id)) return bad(400, 'פעולת התראות לא תקינה');
  const [row] = await entity.filter({ ...owner, id }, 'created_at', 1);
  if (!row) return bad(404, 'ההתראה לא נמצאה');
  const update = action === 'read'
    ? (row.status === 'unread' ? { status: 'read', read_at: now } : row.status === 'archived' && !row.read_at ? { read_at: now } : null)
    : action === 'archive'
      ? (row.status !== 'archived' ? { status: 'archived' } : null)
      : (row.status === 'archived' ? { status: row.read_at ? 'read' : 'unread' } : null);
  if (update) await entity.updateMany({ ...owner, id, status: row.status, read_at: row.read_at || null }, { $set: update });
  return { ok: true };
}