import { calcAddonLine, calcPackageLine } from "@/lib/quoteCatalog";
import { DISCOUNT_TYPE, normalizeDiscountType, resolveQuoteDiscount } from "@/lib/quoteDiscount";

export { DISCOUNT_TYPE, normalizeDiscountType, resolveQuoteDiscount };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function calendarOrdinal(value) {
  const match = DATE_PATTERN.exec(value || "");
  if (!match) return null;
  let year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const monthDays = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > monthDays[month - 1]) return null;
  year -= month <= 2 ? 1 : 0;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const shiftedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra;
}

export function getQuoteNights(arrivalDate, departureDate, quoteType = "lodging") {
  if (quoteType === "day_use") return 0;
  const arrival = calendarOrdinal(arrivalDate);
  const departure = calendarOrdinal(departureDate);
  if (arrival === null || departure === null) return 0;
  return Math.max(0, departure - arrival);
}

export function calcStudentLodgingLine(line, nights) {
  const rates = { day_activity: 125, midweek_lodging: 190, weekend_lodging: 250 };
  const rate = rates[line.rate_type] ?? Number(line.rate || 0);
  return Number(line.pax || 0) * rate * (line.rate_type === "day_activity" ? 1 : nights);
}

export function calcAdultLodgingLine(line, nights) {
  const rates = { BED3: 340, BED68: 250 };
  const rate = rates[line.tent_type] ?? Number(line.rate_per_tent_per_night || 0);
  return Number(line.tent_count || 0) * nights * rate;
}

const parseLines = value => { try { const rows = JSON.parse(value || "[]"); return Array.isArray(rows) ? rows : []; } catch { return []; } };
const adjustmentTotal = line => line.unit_price !== undefined || line.quantity !== undefined
  ? Number(line.unit_price || 0) * Number(line.quantity ?? 1)
  : Number(line.amount || 0);

export function priceQuoteParts(parts, nights, isDayUse) {
  const student = isDayUse ? 0 : (parts.studentLodging || []).reduce((sum, line) => sum + calcStudentLodgingLine(line, nights), 0);
  const adult = isDayUse ? 0 : (parts.adultLodging || []).reduce((sum, line) => sum + calcAdultLodgingLine(line, nights), 0);
  const packages = (parts.packageLines || []).reduce((sum, line) => sum + calcPackageLine(line, isDayUse ? 1 : nights), 0);
  const catalogAddons = (parts.newAddonLines || []).reduce((sum, line) => sum + calcAddonLine(line, isDayUse ? 1 : nights), 0);
  const workshops = (parts.workshops || []).reduce((sum, line) => sum + Number(line.rate || 0), 0);
  const lectures = (parts.lectures || []).reduce((sum, line) => { const base = Number(line.base_price || 0); return sum + (line.vat_included ? base * 1.18 : base); }, 0);
  const addons = (parts.addons || []).reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_price || 0), 0);
  const adjustments = (parts.adjustments || []).reduce((sum, line) => sum + adjustmentTotal(line), 0);
  const coffee = parts.coffeeEnabled && Number(parts.staffCount) > 0 ? Number(parts.staffCount) * 15 : 0;
  const prisa = parts.prisaEnabled ? Math.round(Number(parts.estimatedPax || 0) * 2.5) : 0;
  return { student, adult, packages, catalogAddons, workshops, lectures, addons, adjustments, coffee, prisa,
    subtotal: student + adult + packages + catalogAddons + workshops + lectures + addons + adjustments + coffee + prisa };
}

export function repriceOptionPayload(payload, nights, isDayUse, estimatedPax) {
  const parts = {
    studentLodging: parseLines(payload.student_lodging_lines), adultLodging: parseLines(payload.adult_lodging_lines),
    packageLines: parseLines(payload.package_lines), newAddonLines: parseLines(payload.new_addon_lines),
    workshops: parseLines(payload.workshop_lines), lectures: parseLines(payload.lecture_lines),
    addons: parseLines(payload.addon_lines), adjustments: [...parseLines(payload.adjustment_lines), ...parseLines(payload.surcharge_lines)],
    coffeeEnabled: Number(payload.coffee_corner_pax || 0) > 0, staffCount: Number(payload.coffee_corner_pax || 0),
    prisaEnabled: payload.includes_prisa === true, estimatedPax,
  };
  const priced = priceQuoteParts(parts, nights, isDayUse);
  const discount = resolveQuoteDiscount(payload, priced.subtotal);
  const advance_payment = Math.round(discount.total * 0.3);
  const syncNights = value => JSON.stringify(parseLines(value).map(line => line.rate_type === "day_activity" ? line : { ...line, nights }));
  return { ...payload, student_lodging_lines: syncNights(payload.student_lodging_lines), adult_lodging_lines: syncNights(payload.adult_lodging_lines), subtotal: priced.subtotal, discount_type: discount.type, discount_amount: discount.amount, total_price: discount.total, advance_payment, balance_payment: discount.total - advance_payment };
}