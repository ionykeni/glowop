// Print-friendly rendering of client_notes. Text is shown exactly as entered;
// lines are only grouped into day blocks (a line starting with a date opens a block).
//
// Chrome's print engine does not reliably honour `break-inside: avoid` on plain
// block divs, so a day's header could be left at the page bottom. Each chunk is
// rendered as `display: inline-block; width: 100%` — inline-blocks are monolithic
// fragments in print and are moved whole to the next page when they don't fit.
// Days taller than a page are pre-split by ESTIMATED rendered height (wrapped
// rows, not raw lines) so every chunk fits on one A4 page.
const DATE_RE = /^\s*\S{0,12}?\s*\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?/;
const CHARS_PER_ROW = 90;   // 12px body font across the 178mm content width
const MAX_ROWS = 38;        // safe rows per A4 page body (≈20px line height, header/footer excluded)

const rowsOf = (line) => Math.max(1, Math.ceil((line || " ").length / CHARS_PER_ROW));

function toBlocks(text) {
  const blocks = [];
  let cur = { heading: null, lines: [] };
  for (const line of text.split("\n")) {
    if (DATE_RE.test(line)) {
      if (cur.heading !== null || cur.lines.length) blocks.push(cur);
      cur = { heading: line, lines: [] };
    } else cur.lines.push(line);
  }
  blocks.push(cur);
  return blocks.flatMap(b => {
    const out = [];
    let chunk = { heading: b.heading, cont: false, lines: [] };
    let rows = b.heading !== null ? rowsOf(b.heading) : 0;
    for (const l of b.lines) {
      const r = rowsOf(l);
      if (rows + r > MAX_ROWS && chunk.lines.length) {
        out.push(chunk);
        chunk = { heading: b.heading, cont: true, lines: [] };
        rows = b.heading !== null ? rowsOf(b.heading) : 0;
      }
      chunk.lines.push(l);
      rows += r;
    }
    out.push(chunk);
    return out;
  });
}

const unbreakable = { display: "inline-block", width: "100%", verticalAlign: "top", breakInside: "avoid", pageBreakInside: "avoid" };

export default function QuoteClientNotes({ text, style }) {
  return (
    <div style={{ ...style, whiteSpace: "pre-wrap" }}>
      {toBlocks(text).map((b, i) => (
        <div key={i} style={{ ...unbreakable, marginBottom: b.heading !== null ? 6 : 0 }}>
          {b.heading !== null && (
            <div style={{ fontWeight: 700 }}>{b.heading}{b.cont ? " — המשך" : ""}</div>
          )}
          {b.lines.map((l, j) => <div key={j}>{l || "\u00A0"}</div>)}
        </div>
      ))}
    </div>
  );
}