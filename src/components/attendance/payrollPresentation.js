import { fmtDateTime } from "../../lib/attendanceFormat.js";

export const PAYROLL_NOTICE = "טיוטת דוח שעות בלבד – לא דוח סופי לשכר";
export const PAYROLL_METHOD = "השעות מחושבות לפי שעון ישראל ומחולקות לפי תאריך. סכומים אינם סופרים חפיפות פעמיים; לא נוכו הפסקות שלא תועדו. שעות פעילות, לא מאומתות ושעות עם תיקון ממתין אינן חלק מהסכום המאומת.";
export const PAYROLL_LEGAL = {
  regular: "שעות רגילות", overtime125: "שעות נוספות 125%", overtime150: "שעות נוספות 150%",
  weekly_rest: "מנוחה שבועית", holiday: "חג", unresolved: "נדרש בירור",
};
export const PAYROLL_REASONS = {
  ARRANGEMENT: "חסר הסדר העסקה מאומת המכסה את שבוע העבודה.",
  ATTENDANCE: "בשבוע קיימים נתונים שדורשים בדיקה: חפיפה, רשומה פתוחה, לא מאומתת או תיקון ממתין.",
  NIGHT: "עבודת לילה או עבודה מעבר לחצות מחייבת בדיקת שיוך ליום העבודה וכללי הסף.",
  DAILY_LIMIT: "חסר סף יומי מאומת לאחד מימי העבודה בשבוע.",
  SPECIAL: "שבוע עם עבודה במנוחה שבועית או בחג מחייב בדיקת זכאות וכללי שילוב עם שעות נוספות.",
};
export const PAYROLL_KIND = { verified: "מאומתת", pending: "תיקון ממתין", unverified: "לא מאומתת", active: "פעילה" };
export const PAYROLL_SUMMARY = { verified: "שעות מאומתות", active: "זמן פעיל (משוער)", unverified: "זמן לא מאומת", pending: "זמן ברשומות בתיקון" };
export const PAYROLL_HEADERS = ["תאריך", "כניסה בפועל", "יציאה בפועל", "משך הרשומה", "נספר ליום", "מצב"];
export const PAYROLL_REQUEST_TYPES = { ADD: "הוספה", EDIT: "עדכון", VOID: "ביטול" };
export const PAYROLL_REQUEST_HEADERS = ["תאריך", "בקשה", "כניסה מבוקשת", "יציאה מבוקשת", "מצב"];
export const duration = (ms) => {
  if (ms == null) return "—";
  const s = Math.floor(Math.max(0, ms) / 1000);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, "0")).join(":");
};
export const stamp = (iso) => iso ? fmtDateTime(iso) : "—";
export const rowStatus = (row) => [PAYROLL_KIND[row.kind], row.corrected && "תוקנה", row.overlap && "חפיפה", row.invalid && "זמנים חסרים או לא תקינים"].filter(Boolean).join(" · ");
export const endText = (row) => row.end_at ? `${stamp(row.end_at)}${row.estimated_end ? " (סגירה אוטומטית)" : ""}` : "—";
export const requestStatus = (req) => req.status === "APPROVING" ? "בתהליך אישור" : "ממתינה לאישור";