import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { base44 } from "@/api/base44Client";
import { WARNING_LABELS, formatDateTime, formatPeriod, genderLabel } from "@/lib/mechinaSleepingReportCalc";
import renderSleepingReportPages from "@/lib/renderSleepingReportPages";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Renders ONLY from the immutable version snapshot — never from live data.
function buildHtml(version) {
  const s = version.snapshot;
  const c = version.comparison;
  const diff = version.total_students - version.expected_students;
  const rows = [...s.entries].sort((a, b) => (a.neighborhood_name || "").localeCompare(b.neighborhood_name || "", "he") || String(a.tent_code).localeCompare(String(b.tent_code), "he", { numeric: true }))
    .map(e => `<tr${e.warnings.length ? ' style="background:#fff7ed"' : ""}>
      <td>${esc(e.neighborhood_name)}</td><td><b>${esc(e.tent_code)}</b>${e.assigned ? "" : " (חריגה)"}</td>
      <td><b>${e.count ?? e.total}</b></td><td>${esc(e.gender !== undefined ? genderLabel(e.gender) : e.boys && e.girls ? "דיווח ישן: בנים ובנות" : genderLabel(e.boys ? "BOYS" : e.girls ? "GIRLS" : ""))}</td><td>${e.capacity || "—"}</td>
      <td>${e.warnings.map(w => esc(WARNING_LABELS[w])).join(", ")}${e.note ? `<br/>${esc(e.note)}` : ""}</td></tr>`).join("");
  const nb = Object.entries(s.byNeighborhood || {}).map(([k, v]) => `<span class="chip">${esc(k)}: ${v.total} (ב׳ ${v.boys} / ג׳ ${v.girls})</span>`).join("");
  const corr = c ? `<div class="box warn"><b>גרסה מתוקנת</b> — מחליפה את גרסה ${c.prev_version_number}. סה״כ קודם: ${c.prev_total} → ${c.total}.
    ${c.changed_tents.length ? `<br/>אוהלים ששונו: ${c.changed_tents.map(t => `${esc(t.tent_code)} (${t.prev_boys}/${t.prev_girls} → ${t.boys}/${t.girls})`).join(", ")}` : ""}</div>` : "";
  return `<div class="msrp-document" style="width:794px;padding:40px 44px;box-sizing:border-box;background:#fff;color:#1a1a1a;direction:rtl;font-family:SimplerPro,Arial,sans-serif;font-size:12px;line-height:1.45">
    <style>.msrp-document table{width:100%;border-collapse:collapse;margin-top:6px}.msrp-document th,.msrp-document td{border:1px solid #dbe3ef;padding:4px 6px;text-align:right;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}.msrp-document th{background:#eef3ff;color:#0933dc}.msrp-document .box{border:1px solid #dbe3ef;border-radius:6px;padding:8px 10px;margin-top:10px;white-space:pre-wrap}.msrp-document .warn{background:#fff7ed;border-color:#fed7aa}.msrp-document .chip{display:inline-block;margin:2px 0 2px 6px;padding:2px 8px;border-radius:10px;background:#f1f5f9}.msrp-document .grid{display:flex;gap:8px;margin-top:10px}.msrp-document .grid div{flex:1;border:1px solid #dbe3ef;border-radius:6px;padding:6px;text-align:center}.msrp-document .grid b{display:block;font-size:18px}</style>
    <div style="border-bottom:3px solid #0933dc;padding-bottom:8px;display:flex;justify-content:space-between;align-items:flex-end">
      <div><div style="font-family:Kav16,Arial;font-size:22px;color:#0933dc">דיווח לינה בפועל</div>
      <div style="font-size:15px;margin-top:2px">${esc(version.group_name)}</div>
      <div style="color:#555">תקופת שהייה: ${esc(formatPeriod(s.period))}</div></div>
      <div style="text-align:left;color:#333"><div style="font-size:16px;font-weight:bold">גרסה ${version.version_number}</div>
      <div>הוגש: ${esc(formatDateTime(version.submitted_at))}</div><div>מדווח: ${esc(version.submitted_by_name || version.submitted_by_email)}</div></div>
    </div>
    <div class="grid"><div>צפוי<b>${version.expected_students}</b></div><div>בנים<b>${version.total_boys}</b></div><div>בנות<b>${version.total_girls}</b></div><div>סה״כ דווח<b>${version.total_students}</b></div><div>הפרש<b style="color:${diff === 0 ? "#15803d" : "#c2410c"}">${diff > 0 ? "+" : ""}${diff}</b></div></div>
    ${corr}
    <div class="box"><b>לפי שכונה:</b> ${nb || "—"}</div>
    <table><thead><tr><th>שכונה</th><th>אוהל</th><th>כמות מדווחת</th><th>מגדר</th><th>קיבולת</th><th>הערות / חריגות</th></tr></thead><tbody>${rows}</tbody></table>
    ${s.general_notes ? `<div class="box"><b>הערות כלליות:</b> ${esc(s.general_notes)}</div>` : ""}
    <div style="margin-top:14px;font-size:10px;color:#777">דיווח מידעי בלבד — אינו משנה שיבוצים רשמיים. סטודנטים בלבד (ללא צוות/VIP). גרסה ${version.version_number} · ${esc(formatDateTime(version.submitted_at))}</div>
  </div>`;
}

async function renderPdfBlob(version) {
  const pages = await renderSleepingReportPages(buildHtml(version));
  try {
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    for (let i = 0; i < pages.elements.length; i++) {
      if (i) pdf.addPage();
      const canvas = await html2canvas(pages.elements[i], { scale: 2, backgroundColor: "#ffffff" });
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.94), "JPEG", 0, 0, 210, 297);
    }
    return pdf.output("blob");
  } finally { pages.remove(); }
}

// Generates the PDF for one submitted version, stores it privately, and commits it.
// The version only becomes SUBMITTED/current after the server confirms the PDF is attached.
export async function generateAndAttachPdf(version) {
  const blob = await renderPdfBlob(version);
  const file = new File([blob], `sleeping-report-v${version.version_number}.pdf`, { type: "application/pdf" });
  const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
  const res = await base44.functions.invoke("mechinaSleepingReport", { action: "attach_pdf", version_id: version.id, file_uri });
  if (!res.data?.success) throw new Error(res.data?.error || "צירוף ה-PDF נכשל");
}

export async function openVersionPdf(versionId) {
  const res = await base44.functions.invoke("mechinaSleepingReport", { action: "pdf_url", version_id: versionId });
  if (!res.data?.success) throw new Error(res.data?.error || "לא ניתן לפתוח PDF");
  window.open(res.data.url, "_blank");
}