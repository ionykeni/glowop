import { base44 } from '@/api/base44Client';

// The backend supplies effective eligibility, keeping legacy policy out of the browser.
export async function loadMechinaSpaces(cursor) {
  const { data } = await base44.functions.invoke('manageMechinaSpaceEligibility', { action: 'list', ...(cursor ? { cursor } : {}) });
  if (!data.success) throw new Error(data.error || 'טעינת המרחבים נכשלה');
  return data;
}