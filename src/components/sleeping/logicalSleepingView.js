// Display-only grouping. Authoritative completeness validation stays on the server.
export function groupLogicalSleepingAssignments(rows = []) {
  const active = rows.filter(r => r.status !== 'CANCELLED');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const buckets = new Map();
  active.forEach((r,i) => { const key = r.allocation_series_id ? `series:${r.allocation_series_id}` : `row:${r.id || i}`; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(r); });
  const unique = (rows, field) => new Set(rows.map(r => r[field]));
  const logical = [...buckets.entries()].map(([key, items]) => {
    const actionable = items.filter(r => r.departure_date > today), first = items[0], representative = actionable[0] || items.slice().sort((a,b) => b.departure_date.localeCompare(a.departure_date))[0];
    const errors = [];
    for (const [field,code] of [['tent_id','TENT_MISMATCH'],['allocation_type','ALLOCATION_TYPE_MISMATCH'],['gender_group','GENDER_MISMATCH']]) if (unique(items,field).size > 1) errors.push(code);
    if (unique(actionable,'allocated_pax').size > 1) errors.push('PAX_MISMATCH');
    const statuses = [...unique(items,'status')];
    return { logical_key:key,linked:!!first.allocation_series_id,allocation_series_id:first.allocation_series_id || null,series_effective_from_period_id:first.series_effective_from_period_id || null,period_rows:items,physical_row_count:items.length,logical_allocated_pax:errors.includes('PAX_MISMATCH') ? null : Number(representative.allocated_pax || 0),tent_id:first.tent_id,neighborhood_id:first.neighborhood_id,allocation_type:first.allocation_type,gender_group:first.gender_group,notes:representative.notes || '',statuses,status_summary:statuses.length === 1 ? statuses[0] : 'MIXED',all_confirmed:items.every(r => r.status === 'CONFIRMED'),has_draft:items.some(r => r.status === 'DRAFT'),inconsistent:errors.length > 0,consistency_errors:errors };
  });
  return { logical_assignments:logical,logical_assignment_count:logical.length,physical_row_count:active.length,inconsistent_series:logical.filter(r => r.inconsistent) };
}