const tentCodeCollator = new Intl.Collator(["he", "en"], {
  numeric: true,
  sensitivity: "base",
});

const codeOf = value => String(value?.code ?? value ?? "").trim();

export function naturalTentCodeCompare(left, right) {
  return tentCodeCollator.compare(codeOf(left), codeOf(right));
}

export function sortTentsNaturally(tents = []) {
  return [...tents].sort(naturalTentCodeCompare);
}