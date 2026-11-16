// Print styles for the multi-week "לפי עובדים" team document (A4 portrait).
export const MULTI_WEEK_TEAM_PDF_STYLES = `
  @page { size: A4 portrait; margin: 12mm 11mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #172033; direction: rtl; font-family: Arial, "Arial Hebrew", sans-serif; font-size: 11px; line-height: 1.32; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .pdf-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 8px; padding-bottom: 7px; border-bottom: 2px solid #1d4ed8; }
  h1 { margin: 0 0 3px 0; font-size: 20px; line-height: 1.1; color: #0f172a; }
  .date-range { margin: 0; font-size: 13px; font-weight: 700; color: #475569; }
  .summary { font-size: 11px; font-weight: 700; color: #334155; padding: 5px 9px; border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc; }
  .weeks-status { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
  .week-chip { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; border: 1px solid; }
  .week-chip.ok { background: #f0fdf4; color: #166534; border-color: #bbf7d0; }
  .week-chip.missing { background: #fffbeb; color: #92400e; border-color: #fde68a; }
  .warning { margin-bottom: 10px; padding: 6px 9px; border: 1px solid #fde68a; background: #fffbeb; color: #78350f; border-radius: 6px; font-weight: 700; }
  .empty { text-align: center; color: #64748b; padding: 20px 0; }
  .worker { margin-bottom: 10px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 7px 9px; }
  .worker-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 5px; break-after: avoid; page-break-after: avoid; }
  .worker-head h2 { margin: 0; font-size: 14px; color: #0f172a; }
  .worker-head span { font-size: 10px; color: #64748b; font-weight: 700; }
  .week { margin-top: 5px; break-inside: avoid; page-break-inside: avoid; }
  .week-band { font-size: 10px; font-weight: 800; color: #1e3a8a; background: #eff6ff; border-radius: 4px; padding: 2px 6px; margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th, td { text-align: right; vertical-align: top; padding: 3px 5px; border-bottom: 1px solid #f1f5f9; }
  th { width: 92px; font-weight: 800; color: #334155; }
  th small { font-weight: 400; color: #94a3b8; margin-right: 3px; }
  .line { font-weight: 700; color: #1e293b; }
  .line .notes { font-weight: 400; color: #64748b; }
  .night { display: inline-block; margin: 1px 0; padding: 1px 7px; border-radius: 999px; background: #172554; color: #fff; font-size: 10px; font-weight: 700; }
  .cleaning { margin-top: 4px; border: 1px solid #bbf7d0; background: #f0fdf4; border-radius: 8px; padding: 7px 9px; }
  .cleaning h2 { margin: 0 0 4px 0; font-size: 14px; color: #14532d; break-after: avoid; }
`;