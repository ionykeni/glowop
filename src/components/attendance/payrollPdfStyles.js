export const payrollPdfStyles = `
  @page { size: A4 portrait; margin: 13mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; direction: rtl; color: #161d18; font: 10pt/1.38 Arial, 'Arial Hebrew', sans-serif; }
  main { max-width: 186mm; margin: auto; }
  h1, h2, h3, p { margin: 0; }
  h1 { font-size: 20pt; }
  h2 { font-size: 15pt; }
  h3 { font-size: 11pt; margin-bottom: 2mm; }
  header { padding: 3mm 0; border-bottom: 1pt solid #56745d; margin-bottom: 3mm; }
  .notice { color: #284d34; font-weight: bold; margin: 1mm 0; }
  .meta, .review { color: #45554a; font-size: 8.5pt; }
  .meta { margin: 1mm 0; }
  .summary { border: .6pt solid #cbd7ce; background: #f7faf6; border-radius: 2mm; padding: 3mm; margin: 3mm 0; }
  dl { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm; margin: 2mm 0; }
  dl.legal { grid-template-columns: repeat(3, 1fr); }
  dt { font-size: 8pt; }
  dd { margin: 0; font-weight: bold; font-size: 10pt; }
  table { width: 100%; border-collapse: collapse; margin: 3mm 0; font-size: 8.5pt; }
  th, td { text-align: start; vertical-align: top; border-bottom: .5pt solid #d8dfd8; padding: 1.4mm 1.2mm; }
  th { background: #eef4ed; }
  caption { text-align: start; font-size: 11pt; font-weight: bold; margin-bottom: 1mm; }
  small { display: block; }
  .subtotal { background: #f3f0e8; }
  .not-verified { color: #505850; }
  .next-worker { break-before: page; }
  .review { margin: 2mm 0; }
  .review ul { margin: 1mm 0 0; padding-inline-start: 5mm; }
  thead { display: table-header-group; }
  table, tbody { break-inside: auto; }
  tr, .summary, .review li { break-inside: avoid; }
  h2, h3, caption, header { break-after: avoid; }
  bdi { font-variant-numeric: tabular-nums; white-space: nowrap; }
  @media print { * { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
`;