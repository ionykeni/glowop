// Converts a logical-order string to visual order for left-to-right PDF drawing in an RTL context.
// Scope: Hebrew text mixed with numbers, dates and times (the content of schedule reports).
// Hebrew runs are reversed, run order is reversed, number/date/time runs stay intact, brackets are mirrored.
// Pure-LTR strings (no Hebrew) are returned unchanged. Multi-word Latin phrases must not be mixed with Hebrew.
const HEB = /[\u0590-\u05FF\uFB1D-\uFB4F]/;
const TOKENS = /[\u0590-\u05FF\uFB1D-\uFB4F]+(?:['"][\u0590-\u05FF\uFB1D-\uFB4F]+)*|[A-Za-z0-9]+(?:[.:/,\-][A-Za-z0-9]+)*|[\s\S]/g;
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '<': '>', '>': '<', '{': '}', '}': '{' };

export function toVisual(text) {
  const s = String(text ?? '');
  if (!HEB.test(s)) return s;
  return (s.match(TOKENS) || []).reverse().map((t) => (HEB.test(t) ? [...t].reverse().join('') : MIRROR[t] || t)).join('');
}