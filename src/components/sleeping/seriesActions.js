import { base44 } from '@/api/base44Client';
export async function releaseSleepingSeries(groupId, seriesId) {
  if (!seriesId) throw new Error('לא נמצאה סדרת השיבוץ; יש לרענן');
  const { data } = await base44.functions.invoke('manageMultiPeriodSleepingSeries', { group_id: groupId, allocation_series_id: seriesId, action: 'release_series' });
  if (!data?.success) throw new Error(data?.error || 'שחרור השיבוץ נכשל');
  return data;
}
export async function releaseSleepingNeighborhood(groupId, neighborhoodId) {
  const { data } = await base44.functions.invoke('manageMultiPeriodSleepingSeries', { group_id: groupId, neighborhood_id: neighborhoodId, action: 'release_neighborhood' });
  if (!data?.success) throw new Error(data?.error || 'שחרור השכונה נכשל');
  return data;
}
export const actionableSleepingRows = rows => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  return rows.filter(r => r.status !== 'CANCELLED' && r.departure_date > today);
};