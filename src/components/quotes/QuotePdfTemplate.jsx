/**
 * QuotePdfTemplate — single A4 page for quote content + separate terms page.
 * Printable RTL Hebrew via window.print().
 */
import { getQuoteAudienceContent } from "@/lib/quoteAudience";
import { PACKAGE_CATALOG, OPERATOR_ADDON_CATALOG, calcAddonLine, calcPackageLine } from "@/lib/quoteCatalog";
import { calcAdultLodgingLine, calcStudentLodgingLine, getQuoteNights } from "@/lib/quotePricing";

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("he-IL");
// Unit price: preserve decimals (e.g. 2.5) instead of rounding to a whole number.
const fmtUnit = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? v.toLocaleString("he-IL") : v.toLocaleString("he-IL", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
};
const fmtDate = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("he-IL"); } catch { return d; }
};
const parse = (str, fb = []) => { try { const r = JSON.parse(str); return Array.isArray(r) ? r : fb; } catch { return fb; } };

// New catalog inline (PDF is self-contained)
const PACKAGE_CATALOG_PDF = {
  chavila_1: { name: "חבילה 1", description: "לינה - תלמידים ותלמידות - 17:00 עד 11:00 למחרת" },
  chavila_2: { name: "חבילה 2", description: "יום סיור, ארוחה ושיחה על המכינות" },
  chavila_3: { name: "חבילה 3", description: "פעילות יום לצוותים — הרצאה + 2 סדנאות" },
  chavila_4: { name: "חבילה 4", description: "פעילות 24 שעות — תלמידים ומכינות" },
  chavila_5: { name: "חבילה 5", description: "פעילות 24 שעות — מבוגרים" },
  chavila_6: { name: "חבילה 6", description: "פעילות מבוגרים — פינת קפה ותוכן" },
};
const ADDON_CATALOG_PDF = {
  meal_breakfast:           { label: "ארוחת בוקר",                               group: "ארוחות" },
  meal_lunch:               { label: "ארוחת צהריים",                              group: "ארוחות" },
  meal_dinner:              { label: "ארוחת ערב",                                 group: "ארוחות" },
  karmelim:                 { label: "כרמלים/ גלואו — לינה + 3 ארוחות",           group: "כרמלים/ גלואו" },
  agad:                     { label: "אגד/ סוכנים אחרים — לילה תלמידים",          group: "אגד/ סוכנים אחרים" },
  content_student_workshop: { label: "סדנת תוכן בית הדור הבא — תלמידים",           group: "תוכן" },
  content_adult_workshop:   { label: "סדנת תוכן בית הדור הבא — מבוגרים",          group: "תוכן" },
  content_shirley_lecture:  { label: "הרצאה של שירלי בבית — כולם",               group: "תוכן" },
};

const LOGO_URL_FALLBACK   = "https://media.base44.com/images/public/69ea08de3791d203c52ea3cc/107796e98_quote-logo.png";
const FOOTER_URL_FALLBACK = "https://media.base44.com/images/public/69ea08de3791d203c52ea3cc/c500ec249_quote-footer-photo.jpg";

// ── Safe resolvers ────────────────────────────────────────────────────────────
export function resolveQuotePdfData(quote, group) {
  let snap = null;
  try { snap = quote?.snapshot ? JSON.parse(quote.snapshot) : null; } catch {}

  const studentLines   = parse(quote?.student_lodging_lines);
  const adultLines     = parse(quote?.adult_lodging_lines);
  const workshopLines  = parse(quote?.workshop_lines);
  const lectureLines   = parse(quote?.lecture_lines);
  const addonLines     = parse(quote?.addon_lines);
  const adjustLines    = parse(quote?.adjustment_lines).filter(r => {
    const lineTotal = (r.unit_price !== undefined || r.quantity !== undefined)
      ? (Number(r.unit_price || 0) * Number(r.quantity ?? 1))
      : Number(r.amount || 0);
    return lineTotal !== 0;
  });
  const surchargeLines = parse(quote?.surcharge_lines).filter(r => Number(r.amount || 0) !== 0);
  const coffeeCornerPax = Number(quote?.coffee_corner_pax || 0);
  const packageLines   = parse(quote?.package_lines);
  const newAddonLines  = parse(quote?.new_addon_lines);

  const isDayUse = (quote?.quote_type === "day_use") ||
    (group?.group_type === "DAY_USE") ||
    (studentLines.length > 0 && studentLines[0].rate_type === "day_activity");

  const arrival   = quote?.arrival_date   || snap?.startDate   || group?.arrival_date   || "";
  const departure = isDayUse ? arrival : (quote?.departure_date || snap?.endDate || group?.departure_date || "");
  const nights = getQuoteNights(arrival, departure, isDayUse ? "day_use" : "lodging");

  const STUDENT_RATES = {
    day_activity:    { label: "יום פעילות",        rate: 125 },
    midweek_lodging: { label: "לינה אמצע שבוע",    rate: 190 },
    weekend_lodging: { label: "לינה סוף שבוע",      rate: 250 },
  };
  const ADULT_RATES = {
    BED3:  { label: "אוהל 3 מיטות",   rate: 340 },
    BED68: { label: "אוהל 6/8 מיטות", rate: 250 },
  };

  const lineItems = [];

  // New catalog package lines
  packageLines.forEach(r => {
    const pkg = PACKAGE_CATALOG_PDF[r.package_id];
    if (!pkg) return;
    const baseQty = Number(r.quantity || 0);
    const unitPrice = Number(r.unit_price || 0);
    const catalogPackage = PACKAGE_CATALOG.find(item => item.id === r.package_id);
    const qty = baseQty * (catalogPackage?.billing_period === "per_night" ? nights : 1);
    const total = calcPackageLine({ ...r, shirley_addon: false }, nights);
    lineItems.push({ name: pkg.name, description: pkg.description, qty, unitPrice, total, vatAmount: null });
    if (r.shirley_addon) {
      lineItems.push({ name: "תוספת הרצאה של שירלי", qty: 1, unitPrice: 5000, total: 5000, vatAmount: null });
    }
  });

  // New addon lines — split by category for grouped rendering
  const operatorAddonIds = new Set(["karmelim", "agad"]);
  newAddonLines.forEach(r => {
    const item = ADDON_CATALOG_PDF[r.addon_id];
    const baseQty = Number(r.quantity || 0);
    const unitPrice = Number(r.unit_price || 0);
    const catalogItem = OPERATOR_ADDON_CATALOG.find(entry => entry.id === r.addon_id);
    const qty = baseQty * (catalogItem?.billing_period === "per_night" ? nights : 1);
    const total = calcAddonLine(r, nights);
    const isOperator = operatorAddonIds.has(r.addon_id);
    lineItems.push({ name: item?.label || r.addon_id, qty, unitPrice, total, vatAmount: null, isOperator });
  });

  studentLines.forEach(r => {
    const rateInfo = STUDENT_RATES[r.rate_type];
    const isDay = r.rate_type === "day_activity";
    const unitRate = rateInfo?.rate ?? Number(r.rate ?? 0);
    const qty = isDay ? Number(r.pax) : Number(r.pax) * nights;
    const total = calcStudentLodgingLine(r, nights);
    const label = (rateInfo?.label || r.rate_type) + " - אירוח";
    lineItems.push({ name: label, qty, unitPrice: unitRate, total, vatAmount: null });
  });

  adultLines.forEach(r => {
    const rateInfo = ADULT_RATES[r.tent_type];
    const rate = rateInfo?.rate ?? Number(r.rate_per_tent_per_night ?? 0);
    const qty = Number(r.tent_count) * nights;
    const total = calcAdultLodgingLine(r, nights);
    lineItems.push({ name: rateInfo?.label || r.tent_type, qty, unitPrice: rate, total, vatAmount: null });
  });

  workshopLines.forEach(r => {
    lineItems.push({ name: `סדנה: ${r.name}`, qty: 1, unitPrice: Number(r.rate ?? 0), total: Number(r.rate ?? 0), vatAmount: null });
  });

  lectureLines.forEach(r => {
    const base = Number(r.base_price ?? 0);
    const vatAmount = r.vat_included ? Math.round(base * 0.18) : null;
    const total = r.vat_included ? base + vatAmount : base;
    const label = r.vat_included ? `הרצאה: ${r.name} (+ מע״מ)` : `הרצאה: ${r.name}`;
    lineItems.push({ name: label, qty: 1, unitPrice: base, total, vatAmount });
  });

  if (coffeeCornerPax > 0) {
    lineItems.push({ name: "פינת קפה ועוגיות", qty: coffeeCornerPax, unitPrice: 15, total: coffeeCornerPax * 15, vatAmount: null });
  }

  addonLines.forEach(r => {
    const qty = Number(r.quantity ?? 1);
    const unit = Number(r.unit_price ?? 0);
    lineItems.push({ name: r.description || "תוספת", qty, unitPrice: unit, total: qty * unit, vatAmount: null });
  });

  // Adjustments — unified shape { description, unit_price, quantity }.
  // Legacy rows only had { amount }; treat amount as a flat line total (qty 1).
  adjustLines.forEach(r => {
    const hasNewShape = r.unit_price !== undefined || r.quantity !== undefined;
    const qty        = hasNewShape ? (Number(r.quantity ?? 1)) : 1;
    const unitPrice  = hasNewShape ? (Number(r.unit_price || 0)) : Number(r.amount || 0);
    const total      = hasNewShape ? unitPrice * qty : Number(r.amount || 0);
    lineItems.push({ name: r.description || "התאמה", qty, unitPrice, total, vatAmount: null, isAdjustment: true });
  });

  // Surcharges (positive, appear as normal line items)
  surchargeLines.forEach(r => {
    const amt = Number(r.amount || 0);
    if (amt > 0) {
      lineItems.push({ name: r.description || "תוספת תשלום", qty: 1, unitPrice: amt, total: amt, vatAmount: null, isSurcharge: true });
    }
  });

  // פריסה — 2.5 ₪ per participant
  const totalPaxForPrisa = Number(quote?.estimated_pax ?? group?.total_pax ?? 0);
  if (quote?.includes_prisa && totalPaxForPrisa > 0) {
    const prisaTotal = Math.round(totalPaxForPrisa * 2.5);
    lineItems.push({ name: "פריסה", qty: totalPaxForPrisa, unitPrice: 2.5, total: prisaTotal, vatAmount: null });
  }

  const subtotal    = Number(quote?.subtotal ?? 0);
  const discountPct = Number(quote?.discount_percent ?? 0);
  const discountAmt = Number(quote?.discount_amount ?? 0);
  const totalPrice  = Number(quote?.total_price ?? 0);
  const advance     = Number(quote?.advance_payment ?? Math.round(totalPrice * 0.3));
  const balance     = Number(quote?.balance_payment ?? (totalPrice - advance));

  const activityTypeLabel = packageLines.length > 0
    ? (PACKAGE_CATALOG_PDF[packageLines[0].package_id]?.name || "חבילה")
    : studentLines.length > 0
      ? (STUDENT_RATES[studentLines[0].rate_type]?.label || studentLines[0].rate_type)
      : (isDayUse ? "יום סמינר" : "לינה");

  const STATUS_HE = { DRAFT: "טיוטה", SENT: "נשלח", APPROVED: "מאושר", REJECTED: "נדחה", EXPIRED: "פג תוקף" };

  // Contact person: use dedicated field first, never use client_name as first fallback
  const contactPerson =
    quote?.contact_person ||
    quote?.client_contact_name ||
    quote?.contact_name ||
    group?.contact_name ||
    "";

  return {
    clientName:   snap?.clientName  || quote?.client_name  || "—",
    clientOrg:    snap?.clientOrg   || group?.group_name   || quote?.client_name   || "—",
    clientPhone:  snap?.clientPhone || quote?.client_phone || group?.contact_phone || "—",
    clientEmail:  snap?.clientEmail || quote?.client_email || group?.contact_email || "—",
    clientTaxId:  snap?.clientTaxId || quote?.client_tax_id || "",
    contactPerson,
    groupName:    quote?.group_name?.trim() || "",
    audience:     getQuoteAudienceContent(quote?.quote_audience_type),
    activityTypeLabel,
    arrival,
    departure,
    nights,
    isDayUse,
    totalPax:     snap?.totalPax ?? quote?.estimated_pax ?? group?.total_pax ?? "—",
    lineItems,
    subtotal,
    discountPct,
    discountAmt,
    totalPrice,
    advance,
    balance,
    requiresAdvancePayment: quote?.requires_advance_payment !== false,
    paymentTerms: quote?.payment_terms || "",
    quoteNumber:  quote?.quote_number || "",
    version:      quote?.version ?? 1,
    status:       STATUS_HE[quote?.status] || quote?.status || "",
    validUntil:   quote?.valid_until || "",
    clientNotes:  quote?.client_notes || "",
    optionNotes:  quote?.option_notes || "",
  };
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const HEADING_FONT = '"Kav16", "Arial Hebrew", Arial, sans-serif';
const BODY_FONT = '"SimplerPro", "Arial Hebrew", Arial, sans-serif';
const BLUE = "#1a56a0";

const pageStyle = {
  width: "210mm",
  minHeight: "297mm",
  padding: "10mm 16mm 36mm 16mm",
  boxSizing: "border-box",
  fontFamily: BODY_FONT,
  fontSize: 12,
  lineHeight: 1.5,
  direction: "rtl",
  backgroundColor: "#fff",
  position: "relative",
  color: "#1a1a1a",
};

function LegalFooter() {
  return (
    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, direction: "rtl" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 14px", borderTop: "1px solid #dde8f5", fontSize: 9.5, fontFamily: BODY_FONT, color: "#555" }}>
        <span style={{ fontWeight: 700, fontFamily: HEADING_FONT }}>בית הדור הבא - מקום לחוויות ישראליות</span>
        <span style={{ direction: "ltr" }}>www.keren-hador.org • aharonsonhome@keren-hador.com</span>
      </div>
      <div style={{ background: BLUE, color: "#fff", padding: "5px 14px", fontSize: 9, fontFamily: BODY_FONT, textAlign: "center", lineHeight: 1.5 }}>
        כל המסמכים שהועברו על ידי העמותה, הם רכושה הבלעדי של העמותה ואסור להעתיק ו/או להשתמש בהם, כולם או מקצתם, ללא הסכמת העמותה.
      </div>
    </div>
  );
}

function CoverHeader({ quoteNumber, logoUrl }) {
  return (
    <div style={{ textAlign: "center", marginBottom: 16, direction: "ltr" }}>
      <img
        src={logoUrl || LOGO_URL_FALLBACK}
        alt="בית הדור הבא"
        style={{ height: 110, width: "auto", display: "block", margin: "0 auto 14px auto" }}
        onError={e => { e.target.style.display = "none"; }}
      />
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: HEADING_FONT, color: BLUE, marginBottom: 4, direction: "rtl", letterSpacing: "-0.5px" }}>
        בית הדור הבא – חוות אהרונסון
      </div>
      {quoteNumber && (
        <div style={{ fontSize: 11, color: "#666", marginTop: 2, direction: "rtl", fontFamily: BODY_FONT }}>מס׳ הצעה: {quoteNumber}</div>
      )}
    </div>
  );
}

function CompactHeader({ quoteNumber, logoUrl }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `2px solid ${BLUE}`, paddingBottom: 8, marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, fontFamily: HEADING_FONT, color: BLUE }}>בית הדור הבא – חוות אהרונסון</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {quoteNumber && <span style={{ fontSize: 11, color: "#666", fontFamily: BODY_FONT }}>מס׳ הצעה: {quoteNumber}</span>}
        <img src={logoUrl || LOGO_URL_FALLBACK} alt="" style={{ height: 40, width: "auto" }} onError={e => { e.target.style.display = "none"; }} />
      </div>
    </div>
  );
}

function SectionHeading({ children }) {
  return (
    <div style={{ fontSize: 14, fontWeight: 700, fontFamily: HEADING_FONT, color: BLUE, borderBottom: `2px solid ${BLUE}`, paddingBottom: 4, marginTop: 14, marginBottom: 8 }}>
      {children}
    </div>
  );
}

function DetailTable({ rows }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5, lineHeight: 1.6 }}>
      <tbody>
        {rows.filter(r => r.value && r.value !== "—").map(({ label, value }, i) => (
          <tr key={i} style={{ borderBottom: "1px solid #dde8f5" }}>
            <td style={{ padding: "6px 10px", fontWeight: 700, fontFamily: HEADING_FONT, color: "#333", width: "35%", textAlign: "right" }}>{label}:</td>
            <td style={{ padding: "6px 10px", fontFamily: BODY_FONT, color: "#1a1a1a", textAlign: "right" }}>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Table styles ──────────────────────────────────────────────────────────────
const tdBase = { padding: "7px 10px", borderBottom: "1px solid #dde8f5", fontSize: 11.5, lineHeight: 1.5, verticalAlign: "middle", fontFamily: BODY_FONT, color: "#1a1a1a" };
const thBase = { padding: "8px 10px", background: BLUE, color: "#fff", fontWeight: 700, fontSize: 11.5, textAlign: "right", fontFamily: HEADING_FONT };

// ── Page 1: intro + client + activity + pricing + notes ───────────────────────
export function QuotePricingPage({ d, logoUrl, optionLabel, showShared = true }) {
  const deposit = d.advance || Math.round(d.totalPrice * 0.3);
  const balance = d.balance || (d.totalPrice - deposit);
  const dateDisplay = d.isDayUse ? fmtDate(d.arrival) : `${fmtDate(d.arrival)} – ${fmtDate(d.departure)}`;
  return (
    <div style={{ ...pageStyle, pageBreakAfter: "always" }}>
      {showShared ? <>
        <CoverHeader quoteNumber={d.quoteNumber} logoUrl={logoUrl} />
        <div style={{ textAlign: "center", fontSize: 13, fontWeight: 700, fontFamily: HEADING_FONT, color: BLUE }}>{d.audience.subtitle}</div>
        <p style={{ fontSize: 11.5, fontFamily: BODY_FONT, lineHeight: 1.7, textAlign: "center" }}>{d.audience.intro}</p>
        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ flex: 1 }}><SectionHeading>פרטי לקוח</SectionHeading><DetailTable rows={[{ label: "שם לקוח / ארגון", value: d.clientName }, { label: "איש קשר", value: d.contactPerson }, { label: "טלפון", value: d.clientPhone }, { label: "דוא״ל", value: d.clientEmail }, { label: "ח.פ / ע.מ", value: d.clientTaxId }]} /></div>
          <div style={{ flex: 1 }}><SectionHeading>פרטי פעילות</SectionHeading><DetailTable rows={[{ label: "שם קבוצה", value: d.groupName }, { label: "סוג פעילות", value: d.activityTypeLabel }, { label: d.isDayUse ? "תאריך פעילות" : "תאריכים", value: dateDisplay }, { label: "מס׳ לילות", value: d.isDayUse ? null : String(d.nights || "") }, { label: "סה״כ משתתפים", value: String(d.totalPax || "") }]} /></div>
        </div>
      </> : <CompactHeader quoteNumber={d.quoteNumber} logoUrl={logoUrl} />}
      {optionLabel && <SectionHeading>{optionLabel}</SectionHeading>}
      <SectionHeading>פירוט תמחור</SectionHeading>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}><thead><tr><th style={{ ...thBase, width: "44%" }}>פריט</th><th style={{ ...thBase, textAlign: "center" }}>כמות</th><th style={{ ...thBase, textAlign: "center" }}>מחיר יחידה</th><th style={{ ...thBase, textAlign: "left" }}>סה״כ</th></tr></thead><tbody>
        {d.lineItems.map((item, index) => <tr key={index} style={{ background: index % 2 === 0 ? "#fff" : "#f5f8ff" }}><td style={tdBase}><strong>{item.name}</strong>{item.description && <div style={{ fontSize: 10, color: "#555" }}>{item.description}</div>}</td><td style={{ ...tdBase, textAlign: "center" }}>{item.qty}</td><td style={{ ...tdBase, textAlign: "center" }}>₪{fmtUnit(item.unitPrice)}</td><td style={{ ...tdBase, textAlign: "left", fontWeight: 600 }}>{item.total < 0 ? `-₪${fmt(Math.abs(item.total))}` : `₪${fmt(item.total)}`}</td></tr>)}
        {d.discountAmt > 0 && <><tr><td colSpan={3} style={tdBase}>סה״כ לפני הנחה</td><td style={{ ...tdBase, textAlign: "left" }}>₪{fmt(d.subtotal)}</td></tr><tr><td colSpan={3} style={{ ...tdBase, color: "#c00" }}>הנחה {d.discountPct}%</td><td style={{ ...tdBase, textAlign: "left", color: "#c00" }}>-₪{fmt(d.discountAmt)}</td></tr></>}
        <tr style={{ background: "#e8f0fc" }}><td colSpan={3} style={{ ...tdBase, fontWeight: 800, color: BLUE }}>סה״כ לתשלום</td><td style={{ ...tdBase, textAlign: "left", fontWeight: 800, color: BLUE }}>₪{fmt(d.totalPrice)}</td></tr>
      </tbody></table>
      {(d.requiresAdvancePayment || d.paymentTerms) && <div style={{ marginTop: 12, fontSize: 11.5, fontFamily: BODY_FONT }}><strong style={{ color: BLUE }}>תנאי תשלום: </strong>{d.requiresAdvancePayment && <>מקדמה: <strong>₪{fmt(deposit)}</strong> | יתרה: <strong>₪{fmt(balance)}</strong></>}{d.requiresAdvancePayment && d.paymentTerms && <span> | </span>}{d.paymentTerms && <span>{d.paymentTerms}</span>}</div>}
      <div style={{ marginTop: 8, fontSize: 10.5, color: "#555" }}><strong>ח.פ:</strong> קרן שמש הדור הבא (ע״ר) — 580786812 | <strong>בנק הפועלים:</strong> סניף 170 חשבון 368365 | גרסה: {d.version} | סטטוס: {d.status}</div>
      {showShared && d.clientNotes && <><SectionHeading>הערות כלליות ללקוח</SectionHeading><div style={{ whiteSpace: "pre-wrap" }}>{d.clientNotes}</div></>}
      {d.optionNotes && <><SectionHeading>הערות לאפשרות</SectionHeading><div style={{ whiteSpace: "pre-wrap" }}>{d.optionNotes}</div></>}
      <LegalFooter />
    </div>
  );
}

// ── Page 2: terms ─────────────────────────────────────────────────────────────
function TermBlock({ title, bullets }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, fontFamily: HEADING_FONT, color: BLUE, marginBottom: 6 }}>{title}</div>
      {bullets.map((b, i) => (
        <div key={i} style={{ fontSize: 12, fontFamily: BODY_FONT, color: "#2a2a2a", lineHeight: 1.7, paddingRight: 4, marginBottom: 4 }}>
          {bullets.length > 1 ? `• ${b}` : b}
        </div>
      ))}
    </div>
  );
}

function SigLine({ label, wide }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "flex-end", gap: 8, marginLeft: wide ? 0 : 24, marginBottom: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 600, fontFamily: BODY_FONT, whiteSpace: "nowrap" }}>{label}:</span>
      <span style={{ display: "inline-block", width: wide ? 180 : 120, borderBottom: "1px solid #555" }}>&nbsp;</span>
    </div>
  );
}

export function QuoteTermsPage({ logoUrl, quoteNumber, footerUrl, requiresAdvancePayment = true }) {
  return (
    <div style={{ ...pageStyle }}>
      <CompactHeader quoteNumber={quoteNumber} logoUrl={logoUrl} />

      <SectionHeading>תנאי ההסכם</SectionHeading>
      <div style={{ marginTop: 10 }}>
        <TermBlock title="כללי" bullets={[
          "הצעת המחיר תקפה למשך 14 יום מיום שליחתה בכתב.",
          "רק שליחה חזרה של מסמך זה חתום משמעה סגירת ההזמנה.",
        ]} />
        {requiresAdvancePayment && <TermBlock title="תשלום" bullets={[
          "תשלום מקדמה - בסך 30% מערך העסקה - ישולם חודש לפני הגעה | שאר התשלום - 70% מערך העסקה - ישולם ביום ההגעה.",
        ]} />}
        <TermBlock title="ביטול עסקה" bullets={[
          "עד 7 ימים לפני ההגעה - ייגבו דמי ביטול בסך 5% או 100 ש״ח - הנמוך מביניהם",
          "פחות מ-7 ימים לפני ההגעה - ייגבו דמי ביטול בסך של 25% מערך ההזמנה",
        ]} />
        <TermBlock title="שינויים" bullets={[
          "ניתן לעשות שינויים בהזמנה לרבות מספר משתתפים וארוחות עד 10 ימים לפני הפעילות בבית",
          "דרישת התשלום תישלח לפי מספר המשתתפים שנמסר 10 ימים לפני תחילת הפעילות או לפי מספר המגיעים בפועל - לפי הגבוה מביניהם",
          "ניתן לעדכן בהעדפות ואלרגיות למזון עד 10 ימים לפני, לאחר מכן לא ניתן להבטיח שיהיה אוכל מתאים",
        ]} />
        <TermBlock title="כללי הבית" bullets={[
          "לא ניתן להכניס אוכל מכל סוג לבית הדור הבא",
          "כל נזק לציוד או מתקני הבית יחויב בעלות תיקון הנזק",
        ]} />
      </div>

      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, fontFamily: HEADING_FONT, color: BLUE, marginBottom: 14 }}>אישור ההצעה וחתימה</div>
        <div style={{ marginBottom: 18 }}>
          <SigLine label="שם מלא" />
          <SigLine label="תפקיד" />
          <SigLine label="חתימה" />
        </div>
        <div>
          <SigLine label="שם הגוף המשלם" wide />
          <SigLine label="ח.פ / ע.ר" wide />
        </div>
      </div>

      <div style={{ marginTop: 28, textAlign: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 700, fontFamily: HEADING_FONT, color: BLUE, marginBottom: 12 }}>מחכים לכם בבית הדור הבא</div>
        <div style={{ display: "inline-block", width: "65%" }}>
          <img
            src={footerUrl || FOOTER_URL_FALLBACK}
            alt="חוות אהרונסון"
            style={{ width: "100%", height: "auto", maxHeight: 220, objectFit: "cover", borderRadius: 6, display: "block" }}
            onError={e => { e.target.parentElement.style.display = "none"; }}
          />
        </div>
      </div>
      <LegalFooter />
    </div>
  );
}

// ── Page 3: content & workshops catalog ──────────────────────────────────────
const CONTENT_CATALOG = [
  {
    category: 'חברה ישראלית',
    subtitle: '"ואהבת לרעך כמוך"',
    description: 'מסע בזהות, שייכות ואחריות חברתית',
    workshops: [
      { name: 'ענייני פנים | ענייני חוץ', desc: 'מסע בזהות ושייכות אישית, משפחתית ולאומית' },
      { name: 'יוצרים תקווה', desc: 'תקווה כפעולה: איך מדמיינים עתיד טוב ומתחילים לבנות אותו' },
      { name: 'שירארץ', desc: 'היסטוריה חיה של ישראל דרך השירים שליוו אותנו' },
      { name: 'מי שרוצה מצליח?', desc: 'סדנה על פערים כלכליים-חברתיים ושוויון הזדמנויות (לצעירים)' },
    ],
    lectures: [
      { name: 'פדגוגיה של תקווה', presenter: 'שירלי רימון ברכה' },
      { name: 'לצאת מדעתנו', presenter: 'מירב לשם גונן' },
    ],
  },
  {
    category: 'חינוך פוליטי',
    subtitle: 'מה למעלה ומה למטה',
    description: 'אוריינות פוליטית וחשיבות הקול האישי',
    workshops: [
      { name: 'סדנת סטיקרים', desc: 'היסטוריה חיה דרך הסטיקרים שעיצבו את השיח הציבורי' },
      { name: 'הקול שלי במרחב', desc: 'הקשבה וקריאה מעמיקה במגילת העצמאות (לצעירים)' },
      { name: 'סדנת נרטיבים', desc: 'פיתוח חשיבה ביקורתית על מסרים מסביבנו (לצעירים)' },
    ],
    lectures: [
      { name: 'חינוך כמעשה נרטיבי', presenter: 'שירלי רימון ברכה' },
    ],
  },
  {
    category: 'פדגוגיה של מורכבות',
    subtitle: '"מחלוקת לשם שמיים"',
    description: 'איך מנהלים שיח של מחלוקות בחדר מורים או בכיתה',
    workshops: [
      { name: 'סדנת אומץ', desc: '"איך לא להסכים נכון" | מרחב פתוח למפגש בין זהויות ודעות' },
    ],
    lectures: [],
  },
  {
    category: 'חלומות ערים',
    subtitle: 'אסטרטגיה וחשיבה יצירתית',
    description: 'פיתוח צוותים, חזון ויכולת שינוי',
    workshops: [
      { name: 'סדנת חלימה — Dragon Dreaming', desc: 'חשיבה אסטרטגית משותפת על חזון ויעדים (למבוגרים)' },
      { name: 'מעגל הזהב — למה, איך ומה', desc: 'מציאת הכוח הפנימי ליצירת שינוי (סיימון סינק — לצעירים)' },
      { name: 'קפסולת זמן', desc: 'תמונת עתיד ואחריות אישית (לצעירים)' },
      { name: 'סדנת עיבוד', desc: 'תרבות ארגונית תומכת חלומות (למבוגרים)' },
    ],
    lectures: [
      { name: 'בניית אקוסיסטם חינוכי', presenter: 'רותי אנזל' },
      { name: 'פדגוגיה של חוויה', presenter: 'עדי פאר' },
      { name: 'מסע של שינוי — הובלת שינוי ארגוני', presenter: 'שירלי רימון ברכה' },
      { name: 'POV: מבוגר אחראי', presenter: 'סדנה לצוותי חינוך שמנגישה את דור ה-Z' },
    ],
  },
  {
    category: 'שניים אוחזין',
    subtitle: 'יהודית ודמוקרטית',
    description: 'עיסוק בגם וגם — איך ישראל יכולה להמשיך להיות יהודית ודמוקרטית גם בעתיד',
    workshops: [],
    lectures: [
      { name: 'יהודית ודמוקרטית — הגם וגם כדרך חיים', presenter: 'שירלי רימון ברכה' },
    ],
  },
];

export function QuoteContentCatalogPage({ logoUrl, quoteNumber }) {
  return (
    <div style={{ ...pageStyle, pageBreakBefore: "always", padding: "8mm 16mm 36mm 16mm" }}>
      <CompactHeader quoteNumber={quoteNumber} logoUrl={logoUrl} />

      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: HEADING_FONT, color: BLUE, borderBottom: `2px solid ${BLUE}`, paddingBottom: 4, marginBottom: 10 }}>
        אפשרויות תוכן וסדנאות
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px" }}>
        {CONTENT_CATALOG.map((cat, ci) => (
          <div key={ci} style={{ pageBreakInside: "avoid", breakInside: "avoid", border: "1px solid #dde8f5", borderRadius: 6, overflow: "hidden" }}>
            {/* Category header */}
            <div style={{ background: BLUE, color: "#fff", padding: "4px 8px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, fontFamily: HEADING_FONT }}>{cat.category}</div>
              <div style={{ fontSize: 9.5, fontFamily: BODY_FONT, opacity: 0.88 }}>{cat.subtitle}</div>
            </div>

            <div style={{ padding: "5px 8px" }}>
              {cat.description && (
                <div style={{ fontSize: 9.5, fontFamily: BODY_FONT, color: "#555", marginBottom: 4, lineHeight: 1.4 }}>{cat.description}</div>
              )}

              {cat.workshops.length > 0 && (
                <>
                  <div style={{ fontSize: 9.5, fontWeight: 700, fontFamily: HEADING_FONT, color: BLUE, marginBottom: 2 }}>סדנאות</div>
                  {cat.workshops.map((w, wi) => (
                    <div key={wi} style={{ marginBottom: 3, paddingRight: 5, borderRight: `2px solid ${BLUE}` }}>
                      <span style={{ fontSize: 10, fontWeight: 700, fontFamily: HEADING_FONT, color: "#1a1a1a" }}>{w.name}</span>
                      {w.desc && (
                        <div style={{ fontSize: 9, fontFamily: BODY_FONT, color: "#555", lineHeight: 1.3 }}>{w.desc}</div>
                      )}
                    </div>
                  ))}
                </>
              )}

              {cat.lectures.length > 0 && (
                <>
                  <div style={{ fontSize: 9.5, fontWeight: 700, fontFamily: HEADING_FONT, color: "#1a7a4a", marginTop: cat.workshops.length > 0 ? 5 : 0, marginBottom: 2 }}>הרצאות</div>
                  {cat.lectures.map((l, li) => (
                    <div key={li} style={{ marginBottom: 2, paddingRight: 5, borderRight: "2px solid #1a7a4a" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, fontFamily: HEADING_FONT, color: "#1a1a1a" }}>{l.name}</span>
                      {l.presenter && (
                        <span style={{ fontSize: 9, fontFamily: BODY_FONT, color: "#666" }}> — {l.presenter}</span>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 8, fontSize: 9.5, fontFamily: BODY_FONT, color: "#888", borderTop: "1px solid #e5e5e5", paddingTop: 6, lineHeight: 1.5 }}>
        כל הסדנאות וההרצאות מותאמות לצרכי הקבוצה ולגיל המשתתפים. לפרטים נוספים וסיוע בבניית תכנית — צרו קשר.
      </div>
      <LegalFooter />
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function QuotePdfTemplate({ quote, group, logoUrl, footerUrl }) {
  const d = resolveQuotePdfData(quote, group);
  return (
    <div id="quote-pdf-root" style={{ background: "#fff" }}>
      <QuotePricingPage d={d} logoUrl={logoUrl} />
      <QuoteTermsPage logoUrl={logoUrl} quoteNumber={d.quoteNumber} footerUrl={footerUrl} requiresAdvancePayment={d.requiresAdvancePayment} />
      <QuoteContentCatalogPage logoUrl={logoUrl} quoteNumber={d.quoteNumber} />
    </div>
  );
}