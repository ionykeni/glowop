// Print-friendly rendering of client_notes. Text is shown exactly as entered;
// lines are only grouped into day blocks (a line starting with a date opens a block).
const DATE_RE = /^\s*\S{0,12}?\s*\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?/;
const MAX_LINES = 32; // ~one A4 page of note lines; longer days continue in a labelled chunk

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
  // Chunk very long days so breaks fall between entries, with a continuation label.
  return blocks.flatMap(b => {
    if (b.lines.length <= MAX_LINES) return [b];
    const out = [];
    for (let i = 0; i < b.lines.length; i += MAX_LINES)
      out.push({ heading: b.heading, cont: i > 0, lines: b.lines.slice(i, i + MAX_LINES) });
    return out;
  });
}

const avoid = { breakInside: "avoid", pageBreakInside: "avoid" };

export default function QuoteClientNotes({ text, style }) {
  return (
    <div style={{ ...style, whiteSpace: "pre-wrap" }}>
      {toBlocks(text).map((b, i) => (
        <div key={i} style={{ ...avoid, marginBottom: b.heading !== null ? 6 : 0 }}>
          {b.heading !== null && (
            <div style={{ fontWeight: 700, breakAfter: "avoid", pageBreakAfter: "avoid" }}>
              {b.heading}{b.cont ? " — המשך" : ""}
            </div>
          )}
          {b.lines.map((l, j) => <div key={j} style={avoid}>{l || "\u00A0"}</div>)}
        </div>
      ))}
    </div>
  );
}