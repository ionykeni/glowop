// Multi-week "לפי עובדים" team report: combines several consecutive weeks using the
// existing single-week grouping (groupShiftsByWorker / groupCleaningContractorByDay).
// Only PUBLISHED weeks contribute shifts; every other week is listed as not included.
import { addDays, fmtDM } from "@/lib/workScheduleConfig";
import { groupShiftsByWorker, groupCleaningContractorByDay } from "@/lib/weeklyScheduleReport";

export const TEAM_PERIOD_OPTIONS = [
  { value: 1, label: "שבוע אחד" },
  { value: 2, label: "שבועיים" },
  { value: 3, label: "3 שבועות" },
  { value: 4, label: "4 שבועות" },
];

export const WEEK_STATUS_LABEL = { PUBLISHED: "פורסם", DRAFT: "טיוטה", ARCHIVED: "בארכיון", MISSING: "אין סידור" };

export const periodWeekStarts = (startWeek, count) => Array.from({ length: count }, (_, i) => addDays(startWeek, i * 7));
export const periodEnd = (startWeek, count) => addDays(startWeek, count * 7 - 1);
export const fmtFullDate = (date) => { const [y, m, d] = date.split("-"); return `${d}/${m}/${y}`; };
export const weekLabel = (weekStart) => `${fmtDM(weekStart)}–${fmtDM(addDays(weekStart, 6))}`;
export const unpublishedListText = (report) => report.unpublished.map((w) => `${weekLabel(w.weekStart)} (${WEEK_STATUS_LABEL[w.status] || w.status})`).join(", ");

// weeks: [{ weekStart, schedule, shifts }] in chronological order
export function buildMultiWeekTeamReport(weeks) {
  const statuses = weeks.map((w) => ({ weekStart: w.weekStart, status: w.schedule?.status || "MISSING" }));
  const byWorker = new Map();
  const cleaning = [];

  weeks.filter((w) => w.schedule?.status === "PUBLISHED").forEach((w) => {
    groupShiftsByWorker(w.schedule, w.shifts).forEach((worker) => {
      if (!byWorker.has(worker.key)) byWorker.set(worker.key, { key: worker.key, name: worker.name, firstDate: worker.firstDate, totalShifts: 0, weeks: [] });
      const entry = byWorker.get(worker.key);
      entry.totalShifts += worker.totalShifts;
      entry.weeks.push({ weekStart: w.weekStart, days: worker.days, totalShifts: worker.totalShifts });
    });
    const days = groupCleaningContractorByDay(w.schedule, w.shifts, w.weekStart);
    if (days.length) cleaning.push({ weekStart: w.weekStart, days });
  });

  const workers = Array.from(byWorker.values()).sort((a, b) => a.firstDate.localeCompare(b.firstDate) || a.name.localeCompare(b.name, "he"));
  return {
    start: weeks[0].weekStart,
    end: addDays(weeks[weeks.length - 1].weekStart, 6),
    statuses,
    unpublished: statuses.filter((s) => s.status !== "PUBLISHED"),
    workers,
    cleaning,
  };
}