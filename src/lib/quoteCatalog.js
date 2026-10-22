/**
 * Quote Product Catalog — New naming system
 * Legacy alias mapping kept for backward compatibility reference only.
 * Visible UI names are the new names exclusively.
 */

// ── Legacy alias map (for reference / migration notes only) ──────────────────
// Old: שיבולת       → New: חבילה 1
// Old: אלומה 1      → New: חבילה 2
// Old: אלומה 2      → New: חבילה 3
// Old: שדה 1        → New: חבילה 4
// Old: שדה 2        → New: חבילה 5
// Old: כרמלים/גלואו → New: כרמלים/ גלואו (unchanged)
// Old: אגד/סוכנים   → New: אגד/ סוכנים אחרים (unchanged)

export const PACKAGE_CATALOG = [
  {
    id: "chavila_1",
    name: "חבילה 1",
    legacy_alias: "שיבולת",
    description: "לינה - תלמידים ותלמידות - 17:00 עד 11:00 למחרת",
    target_audience: "לינה של תלמידים ומכינות בטיולים",
    content_includes: "לינה 17:00 עד 11:00 למחרת + סדנה אחת",
    pricing_type: "per_person_seasonal",
    pricing_note: "220 אמצ״ש / 250 סופ״ש / 270 יולי-אוגוסט לאדם",
    pricing_options: [
      { id: "weekday",        label: "אמצע שבוע",       rate: 220 },
      { id: "weekend",        label: "סוף שבוע",        rate: 250 },
      { id: "july_august",   label: "יולי–אוגוסט",     rate: 270 },
    ],
    default_quantity_source: "participant_count",
    allow_unit_price_override: true,
    billing_period: "per_night",
  },
  {
    id: "chavila_2",
    name: "חבילה 2",
    legacy_alias: "אלומה 1",
    description: "יום סיור, ארוחה ושיחה על המכינות",
    target_audience: "סיור ושיחה על המכינות",
    content_includes: "סיור ושיחה",
    pricing_type: "per_person_variant",
    pricing_note: "99 עם ארוחת בוקר/ערב / 111 עם ארוחת צהריים לאדם",
    pricing_options: [
      { id: "breakfast_dinner", label: "עם ארוחת בוקר / ערב", rate: 99  },
      { id: "lunch",            label: "עם ארוחת צהריים",     rate: 111 },
    ],
    default_quantity_source: "participant_count",
    allow_unit_price_override: true,
  },
  {
    id: "chavila_3",
    name: "חבילה 3",
    legacy_alias: "אלומה 2",
    description: "פעילות יום לצוותים",
    target_audience: "פעילות יום לצוותים",
    content_includes: "הרצאה + 2 סדנאות",
    pricing_type: "per_person_threshold",
    pricing_note: "285 לאדם (25 ומעלה) / 295 לאדם (עד 24) + תוספת שירלי אופציונלית",
    pricing_options: [
      { id: "above_25",  label: "25 משתתפים ומעלה", rate: 285 },
      { id: "below_25",  label: "עד 24 משתתפים",    rate: 295 },
    ],
    threshold: { pax: 25, rate_above: 285, rate_below: 295 },
    addon_shirley: { label: "תוספת הרצאה של שירלי", fixed_price: 5000 },
    default_quantity_source: "participant_count",
    allow_unit_price_override: true,
  },
  {
    id: "chavila_4",
    name: "חבילה 4",
    legacy_alias: "שדה 1",
    description: "פעילות של 24 שעות - תלמידים ומכינות",
    target_audience: "24 שעות לתלמידים או מכינות",
    content_includes: "3 סדנאות + סדנת סיכום",
    pricing_type: "per_person_fixed",
    pricing_note: "430 לאדם",
    pricing_options: [
      { id: "standard", label: "תלמידים / מכינות", rate: 430 },
    ],
    default_quantity_source: "participant_count",
    allow_unit_price_override: true,
  },
  {
    id: "chavila_5",
    name: "חבילה 5",
    legacy_alias: "שדה 2",
    description: "פעילות של 24 שעות - מבוגרים",
    target_audience: "24 שעות למבוגרים",
    content_includes: "3 סדנאות וסדנת סיכום",
    pricing_type: "per_person_tent_type",
    pricing_note: "560 אוהלי צוות / 480 אוהלי 6/8 לאדם",
    pricing_options: [
      { id: "staff_tents",  label: "אוהלי צוות",  rate: 560 },
      { id: "bed68_tents",  label: "אוהלי 6/8",   rate: 480 },
    ],
    default_quantity_source: "participant_count",
    allow_unit_price_override: true,
  },
  {
    id: "chavila_6",
    name: "חבילה 6",
    legacy_alias: null,
    description: "פעילות מבוגרים — פינת קפה ותוכן",
    target_audience: "פעילות מבוגרים",
    content_includes: "פינת קפה + תוכן בהתאם לעלות",
    pricing_type: "flexible",
    pricing_note: "מחיר חופשי — ניתן להוסיף פריטים ידנית",
    pricing_options: [],
    default_quantity_source: "participant_count",
    allow_unit_price_override: true,
  },
];

export const MEAL_ADDON_CATALOG = [
  { id: "meal_breakfast", group: "ארוחות", label: "ארוחת בוקר", rate: 50 },
  { id: "meal_lunch",     group: "ארוחות", label: "ארוחת צהריים", rate: 75 },
  { id: "meal_dinner",    group: "ארוחות", label: "ארוחת ערב",    rate: 50 },
];

export const OPERATOR_ADDON_CATALOG = [
  {
    id: "karmelim",
    group: "כרמלים/ גלואו",
    label: "כרמלים/ גלואו",
    description: "לינה + 3 ארוחות רגילות",
    target_audience: "פעילות של מפעיל חיצוני בבית",
    rate: 280,
    pricing_type: "per_person_fixed",
    default_quantity_source: "participant_count",
    billing_period: "per_night",
  },
  {
    id: "agad",
    group: "סוכנים",
    label: "סוכנים",
    description: "לילה תלמידים + סדנה אחת חובה",
    target_audience: "לילה תלמידים",
    rate: 206,
    pricing_type: "per_person_fixed",
    default_quantity_source: "participant_count",
    billing_period: "per_night",
  },
];

export const CONTENT_ADDON_CATALOG = [
  {
    id: "content_student_workshop",
    group: "תוכן",
    label: "סדנת תוכן בית הדור הבא — תלמידים",
    fixed_price: 750,
    max_pax: 30,
    pricing_type: "fixed_per_unit",
  },
  {
    id: "content_adult_workshop",
    group: "תוכן",
    label: "סדנת תוכן בית הדור הבא — מבוגרים",
    fixed_price: 1700,
    max_pax: 30,
    pricing_type: "fixed_per_unit",
  },
  {
    id: "content_shirley_lecture",
    group: "תוכן",
    label: "הרצאה של שירלי בבית — כולם",
    fixed_price: 5000,
    max_pax: null,
    pricing_type: "fixed_per_unit",
  },
];

// ── Calculation helpers ───────────────────────────────────────────────────────

/**
 * Compute line total for a package line.
 * @param {object} line — { package_id, quantity, unit_price, option_id, shirley_addon, fixed_price }
 * @returns {number}
 */
export function calcPackageLine(line, nights = 1) {
  if (!line) return 0;
  const pkg = PACKAGE_CATALOG.find(p => p.id === line.package_id);
  if (!pkg) return 0;

  if (pkg.pricing_type === "flexible") {
    // חבילה 6: manual price
    return Number(line.quantity || 0) * Number(line.unit_price || 0);
  }

  const unitPrice = Number(line.unit_price || 0);
  const qty = Number(line.quantity || 0);
  let total = qty * unitPrice * (pkg.billing_period === "per_night" ? Number(nights || 0) : 1);

  // חבילה 3 Shirley add-on
  if (pkg.addon_shirley && line.shirley_addon) {
    total += pkg.addon_shirley.fixed_price;
  }

  return total;
}

/**
 * Auto-resolve unit price for a package based on option or threshold.
 */
export function resolvePackageUnitPrice(packageId, optionId, pax) {
  const pkg = PACKAGE_CATALOG.find(p => p.id === packageId);
  if (!pkg) return 0;

  // חבילה 3 threshold
  if (pkg.pricing_type === "per_person_threshold" && pkg.threshold) {
    return pax >= pkg.threshold.pax ? pkg.threshold.rate_above : pkg.threshold.rate_below;
  }

  const option = pkg.pricing_options?.find(o => o.id === optionId);
  return option?.rate ?? 0;
}

/**
 * Compute line total for a content/operator addon.
 * @param {object} line — { addon_id, quantity, unit_price }
 */
export function calcAddonLine(line, nights = 1) {
  if (!line) return 0;

  // Content items (fixed per unit)
  const contentItem = CONTENT_ADDON_CATALOG.find(c => c.id === line.addon_id);
  if (contentItem) {
    const units = Number(line.quantity || 1);
    const price = Number(line.unit_price || contentItem.fixed_price);
    return units * price;
  }

  // Meal or operator addons (per person)
  const mealItem = MEAL_ADDON_CATALOG.find(m => m.id === line.addon_id);
  const operatorItem = OPERATOR_ADDON_CATALOG.find(o => o.id === line.addon_id);
  const item = mealItem || operatorItem;
  if (item) {
    const qty = Number(line.quantity || 0);
    const rate = Number(line.unit_price || item.rate);
    return qty * rate * (item.billing_period === "per_night" ? Number(nights || 0) : 1);
  }

  return Number(line.quantity || 0) * Number(line.unit_price || 0);
}