import { guardOperationalClient } from '../../shared/groupWriteGuard.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
const todayIL = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
const fail = (code, error, extra = {}, status = 200) => Response.json({ success: false, error, error_code: code, ...extra }, { status });

export default async function(req) {
  let base44;
  const created = [];
  const snapshots = [];
  try {
    base44 = guardOperationalClient(createClientFromRequest(req));
    const user = await base44.auth.me();
    if (!user) return fail('UNAUTHORIZED', 'נדרשת התחברות', {}, 401);
    const body = await req.json();
    const { allocation_id, group_id, destination_tent_id, effective_date, test_failure_stage } = body || {};
    if (!allocation_id || !group_id || !destination_tent_id || !/^\d{4}-\d{2}-\d{2}$/.test(effective_date || '')) {
      return fail('INVALID_INPUT', 'חסרים פרטי שינוי מקום הלינה');
    }

    const [group, allocation, destinationTent] = await Promise.all([
      base44.asServiceRole.entities.Group.get(group_id).catch(() => null),
      base44.asServiceRole.entities.SleepingAllocation.get(allocation_id).catch(() => null),
      base44.asServiceRole.entities.Tent.get(destination_tent_id).catch(() => null),
    ]);
    if (!group || !allocation || allocation.group_id !== group_id) return fail('ALLOCATION_NOT_FOUND', 'שיבוץ הלינה לא נמצא');
    if (group.stay_mode === 'MULTI_PERIOD') return fail('MULTI_PERIOD_REASSIGNMENT_BLOCKED', 'שינוי חלקי של שיבוץ רב־תקופתי חסום כדי לא לפגוע בקישורי התקופות והסדרה');
    if (group.stay_mode !== 'CONTINUOUS') return fail('UNSUPPORTED_STAY_MODE', 'סוג השהייה אינו נתמך לשינוי מתוארך');
    if (effective_date < todayIL()) return fail('HISTORICAL_CORRECTION_REQUIRED', 'לא ניתן לשנות היסטוריית לינה מתאריך עבר בתהליך הרגיל. נדרש תהליך תיקון היסטורי');
    if (allocation.status !== 'CONFIRMED') return fail('CONFIRMED_ALLOCATION_REQUIRED', 'ניתן לפצל רק שיבוץ מאושר');
    if (!destinationTent || destinationTent.working_status !== 'WORKING') return fail('DESTINATION_UNAVAILABLE', 'אוהל היעד אינו זמין');
    if (destinationTent.id === allocation.tent_id) return fail('DESTINATION_UNCHANGED', 'יש לבחור מקום לינה חדש');

    const existingResult = await base44.asServiceRole.entities.SleepingAllocation.filter({ group_id, tent_id: destination_tent_id });
    const alreadyCreated = existingResult.find(row => row.status === 'CONFIRMED' && row.arrival_date === effective_date &&
      row.operational_group_profile_id === allocation.operational_group_profile_id && row.allocation_type === allocation.allocation_type &&
      Number(row.allocated_pax) === Number(allocation.allocated_pax) && row.gender_group === allocation.gender_group && (row.notes || '') === (allocation.notes || ''));
    if (allocation.departure_date === effective_date && alreadyCreated) {
      return Response.json({ success: true, already_applied: true, old_allocation_id: allocation.id, new_allocation_id: alreadyCreated.id });
    }

    const stayStart = String(group.arrival_date || '').slice(0, 10);
    const stayEnd = String(group.departure_date || '').slice(0, 10);
    if (!(stayStart <= effective_date && effective_date < stayEnd)) return fail('EFFECTIVE_DATE_OUTSIDE_STAY', 'התאריך חייב להיות בתוך תקופת השהייה');
    if (!(allocation.arrival_date <= effective_date && effective_date < allocation.departure_date)) {
      return fail('EFFECTIVE_DATE_OUTSIDE_SEGMENT', 'התאריך חייב להיות בתוך מקטע השיבוץ הנוכחי');
    }
    const replacesWholeSegment = allocation.arrival_date === effective_date;
    if (todayIL() < stayStart) return fail('PRE_ARRIVAL_USE_EXISTING_FLOW', 'לפני ההגעה יש להשתמש בתהליך השיבוץ הרגיל');

    const isVipMarker = /__vip_req_\d+__/.test(allocation.notes || '');
    const isAltMarker = (allocation.notes || '').includes('__alt_tent__');
    if (isVipMarker && destinationTent.tent_type !== 'VIP') return fail('VIP_DESTINATION_REQUIRED', 'דרישת VIP חייבת להישאר באוהל VIP');
    if (isAltMarker && destinationTent.tent_type === 'VIP') return fail('ALT_DESTINATION_MUST_BE_STANDARD', 'אוהל חילופי חייב להיות אוהל רגיל');
    const maxPax = destinationTent.tent_type === 'VIP' || destinationTent.is_accessible === true || /^8\d/.test(String(destinationTent.code || ''))
      ? 4 : Number(destinationTent.capacity || 0);
    if (Number(allocation.allocated_pax) > maxPax) return fail('PAX_EXCEEDS_CAPACITY', `הקיבולת המרבית באוהל היעד היא ${maxPax}`);

    const [tentRows, groupRows, groupReservations, allReservations] = await Promise.all([
      base44.asServiceRole.entities.SleepingAllocation.filter({ tent_id: destination_tent_id }),
      base44.asServiceRole.entities.SleepingAllocation.filter({ group_id }),
      base44.asServiceRole.entities.NeighborhoodReservation.filter({ group_id, status: 'ACTIVE' }),
      allocation.allocation_type === 'STUDENT' ? base44.asServiceRole.entities.NeighborhoodReservation.filter({ status: 'ACTIVE' }) : Promise.resolve([]),
    ]);
    const intervalEnd = allocation.departure_date;
    const conflicts = tentRows.filter(row => row.status !== 'CANCELLED' && row.group_id !== group_id && overlaps(effective_date, intervalEnd, row.arrival_date, row.departure_date));
    if (conflicts.length) {
      const conflict = conflicts[0];
      const conflictGroup = await base44.asServiceRole.entities.Group.get(conflict.group_id).catch(() => null);
      return fail('TENT_CONFLICT', `האוהל תפוס על ידי ${conflictGroup?.group_name || conflict.group_id} בתאריכים ${conflict.arrival_date}–${conflict.departure_date}`, {
        conflicting_group_id: conflict.group_id, conflicting_arrival_date: conflict.arrival_date, conflicting_departure_date: conflict.departure_date,
      });
    }
    const selfConflict = tentRows.find(row => row.status !== 'CANCELLED' && row.id !== allocation.id && row.group_id === group_id && overlaps(effective_date, intervalEnd, row.arrival_date, row.departure_date));
    if (selfConflict) return fail('SELF_TENT_CONFLICT', 'לקבוצה כבר קיים שיבוץ חופף באוהל היעד');

    const oldReservation = groupReservations.find(row => row.neighborhood_id === allocation.neighborhood_id && overlaps(allocation.arrival_date, intervalEnd, row.arrival_date, row.departure_date));
    let createNewReservation = false;
    let truncateOldReservation = false;
    let relocateOldReservation = false;
    if (allocation.allocation_type === 'STUDENT' && destinationTent.neighborhood_id !== allocation.neighborhood_id) {
      const otherGroupReservation = allReservations.find(row => row.group_id !== group_id && row.neighborhood_id === destinationTent.neighborhood_id && overlaps(effective_date, intervalEnd, row.arrival_date, row.departure_date));
      if (otherGroupReservation) return fail('NEIGHBORHOOD_CONFLICT', 'שכונת היעד תפוסה בתאריכים החדשים');
      const ownDestinationReservations = groupReservations.filter(row => row.neighborhood_id === destinationTent.neighborhood_id && overlaps(effective_date, intervalEnd, row.arrival_date, row.departure_date));
      if (ownDestinationReservations.length > 1 || (ownDestinationReservations[0] && !(ownDestinationReservations[0].arrival_date <= effective_date && ownDestinationReservations[0].departure_date >= intervalEnd))) {
        return fail('AMBIGUOUS_DESTINATION_RESERVATION', 'מצב הזמנת שכונת היעד אינו מאפשר פיצול בטוח');
      }
      const otherOldFuture = groupRows.some(row => row.status !== 'CANCELLED' && row.id !== allocation.id && row.allocation_type === 'STUDENT' && row.neighborhood_id === allocation.neighborhood_id && overlaps(effective_date, intervalEnd, row.arrival_date, row.departure_date));
      relocateOldReservation = replacesWholeSegment && !!oldReservation && !otherOldFuture;
      createNewReservation = ownDestinationReservations.length === 0 && !relocateOldReservation;
      truncateOldReservation = !replacesWholeSegment && !!oldReservation && !otherOldFuture && oldReservation.arrival_date < effective_date && oldReservation.departure_date > effective_date;
    }

    let newAllocation = allocation;
    if (!replacesWholeSegment) {
      newAllocation = await base44.asServiceRole.entities.SleepingAllocation.create({
        operational_group_profile_id: allocation.operational_group_profile_id, group_id, tent_id: destinationTent.id,
        neighborhood_id: destinationTent.neighborhood_id, arrival_date: effective_date, departure_date: intervalEnd,
        allocated_pax: allocation.allocated_pax, allocation_type: allocation.allocation_type, gender_group: allocation.gender_group,
        status: 'CONFIRMED', housekeeping_status: allocation.housekeeping_status || 'PENDING', notes: allocation.notes || '',
      });
      created.push({ entity: 'SleepingAllocation', id: newAllocation.id });
      if (test_failure_stage === 'AFTER_NEW_ALLOCATION' && String(group.group_name || '').startsWith('__TEST__')) throw new Error('SYNTHETIC_FAILURE_AFTER_NEW_ALLOCATION');
    }

    let newReservation = null;
    if (createNewReservation) {
      newReservation = await base44.asServiceRole.entities.NeighborhoodReservation.create({
        group_id, operational_group_profile_id: allocation.operational_group_profile_id, neighborhood_id: destinationTent.neighborhood_id,
        arrival_date: effective_date, departure_date: intervalEnd, gender_group: ['BOYS', 'GIRLS'].includes(allocation.gender_group) ? allocation.gender_group : 'MIXED',
        planned_tents: 1, status: 'ACTIVE', source: 'allocation', notes: oldReservation?.notes || '', shared_neighborhood_allowed: false,
      });
      created.push({ entity: 'NeighborhoodReservation', id: newReservation.id });
    }
    if (truncateOldReservation) {
      snapshots.push({ entity: 'NeighborhoodReservation', id: oldReservation.id, data: { departure_date: oldReservation.departure_date } });
      await base44.asServiceRole.entities.NeighborhoodReservation.update(oldReservation.id, { departure_date: effective_date });
    }
    if (relocateOldReservation) {
      snapshots.push({ entity: 'NeighborhoodReservation', id: oldReservation.id, data: { neighborhood_id: oldReservation.neighborhood_id } });
      await base44.asServiceRole.entities.NeighborhoodReservation.update(oldReservation.id, { neighborhood_id: destinationTent.neighborhood_id });
    }
    if (replacesWholeSegment) {
      snapshots.push({ entity: 'SleepingAllocation', id: allocation.id, data: { tent_id: allocation.tent_id, neighborhood_id: allocation.neighborhood_id } });
      await base44.asServiceRole.entities.SleepingAllocation.update(allocation.id, { tent_id: destinationTent.id, neighborhood_id: destinationTent.neighborhood_id });
    } else {
      snapshots.push({ entity: 'SleepingAllocation', id: allocation.id, data: { departure_date: allocation.departure_date } });
      await base44.asServiceRole.entities.SleepingAllocation.update(allocation.id, { departure_date: effective_date });
    }

    return Response.json({ success: true, old_allocation_id: allocation.id, new_allocation_id: newAllocation.id, effective_date,
      old_interval: replacesWholeSegment ? null : { arrival_date: allocation.arrival_date, departure_date: effective_date }, new_interval: { arrival_date: effective_date, departure_date: intervalEnd },
      old_reservation_truncated: truncateOldReservation, reservation_relocated: relocateOldReservation, new_reservation_id: newReservation?.id || null });
  } catch (error) {
    if (base44) {
      for (const snapshot of [...snapshots].reverse()) await base44.asServiceRole.entities[snapshot.entity].update(snapshot.id, snapshot.data).catch(() => null);
      for (const item of [...created].reverse()) await base44.asServiceRole.entities[item.entity].delete(item.id).catch(() => null);
    }
    return Response.json({ success: false, error: 'שינוי מקום הלינה נכשל והשיבוץ המקורי נשמר', error_code: 'REASSIGNMENT_ROLLED_BACK', rollback: { restored: true, removed_created_rows: created.length }, debug_message: error?.message }, { status: 500 });
  }
}