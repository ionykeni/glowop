export const SLEEPING_PERIOD_SCOPE = Object.freeze({
  ONLY: "SELECTED_ONLY",
  FORWARD: "SELECTED_AND_FUTURE",
});

export const laterStayPeriods = (periods, selectedId) => {
  const index = periods.findIndex(period => period.id === selectedId);
  return index < 0 ? [] : periods.slice(index + 1);
};