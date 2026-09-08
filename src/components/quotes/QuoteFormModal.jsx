import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, CalendarDays, Users, Coffee, BookOpen, Mic2, Tag, SlidersHorizontal, ChevronDown, ChevronUp, Package } from "lucide-react";
import CapacityWarningBanner from "./CapacityWarningBanner";
import PackageLinesSection from "./PackageLinesSection";
import AdjustmentsSection, { calcAdjustmentLine, normalizeAdjustmentRow } from "./AdjustmentsSection";
import { useRoleContext } from "@/lib/RoleContext";
import { calcAdultLodgingLine, calcStudentLodgingLine, getQuoteNights, priceQuoteParts, repriceOptionPayload } from "@/lib/quotePricing";
import { isQuotePreparationEnabled } from "@/lib/quotePreparationFlow";
import { getEffectiveQuoteGroupName } from "@/lib/quoteAudience";
import { isQuoteMultiOptionEnabled } from "@/lib/quoteMultiOption";
import { extractQuoteOptionPayload, applyOptionPayloadToQuote, createEmptyQuoteOption, isOptionDraftSemanticallyEqual } from "@/lib/quoteOptions";
import { normalizeCatalogLines, normalizeOptionPayload, syncOptionPayloadPax } from "@/lib/quoteQuantityMode";
import QuoteAudienceSelector from "./QuoteAudienceSelector";
import QuoteOptionTabs from "./QuoteOptionTabs";
import QuoteOptionPreviewSelector from "./QuoteOptionPreviewSelector";
import { toast } from "sonner";
import { isValidDateString } from "@/lib/groupStayPeriods";

// ── Catalog ───────────────────────────────────────────────────────────────────
const STUDENT_LODGING_RATES = {
  day_activity:    { label: "יום פעילות",       rate: 125 },
  midweek_lodging: { label: "לינה אמצע שבוע",   rate: 190 },
  weekend_lodging: { label: "לינה סוף שבוע",     rate: 250 },
};
const ADULT_TENT_RATES = {
  BED3:  { label: "אוהל 3 מיטות",   rate: 340, capacity: 3 },
  BED68: { label: "אוהל 6/8 מיטות", rate: 250, capacity: 6 },
};
const WORKSHOP_CATALOG = [
  { name: "ענייני פנים ענייני חוץ", students: 750, adults: 1500 },
  { name: "יוצרים תקווה",           students: 750, adults: 1500 },
  { name: "מי שרוצה מצליח",         students: 750, adults: null },
  { name: "שירארץ",                  students: 750, adults: 1500 },
  { name: "סדנת סטיקרים",           students: 750, adults: 1500 },
  { name: "הקול שלי במרחב",         students: 750, adults: null },
  { name: "סדנת נרטיבים",           students: 750, adults: null },
  { name: "סדנת אומץ",              students: 750, adults: 1500 },
  { name: "פדגוגיה של חוויה",       students: 750, adults: 1500 },
];
const LECTURE_CATALOG = [
  { name: "פדגוגיה של תקווה",      lecturer: "שירלי רימון ברכה", base_price: 2500, vat_included: false },
  { name: "חינוך כמעשה נרטיבי",    lecturer: "שירלי רימון ברכה", base_price: 2500, vat_included: false },
  { name: "יהודית ודמוקרטית",      lecturer: "שירלי רימון ברכה", base_price: 2500, vat_included: false },
  { name: "בניית אקוסיסטם חינוכי", lecturer: "רותי אנזל",         base_price: 1500, vat_included: false },
  { name: "לצאת מדעתנו",           lecturer: "מירב לשם גונן",     base_price: 5000, vat_included: true  },
];
const VAT_RATE = 0.18;
const COFFEE_CORNER_RATE = 15;
const PRISA_RATE = 2.5;

// ── Helpers ───────────────────────────────────────────────────────────────────
const parse = (str, fallback) => { try { const r = JSON.parse(str); return Array.isArray(r) ? r : fallback; } catch { return fallback; } };
const parseOptionPayload = str => { try { return JSON.parse(str || "{}"); } catch { return {}; } };
const fmtMoney = (n) => `₪${Math.round(Number(n) || 0).toLocaleString("he-IL")}`;
const fmtDate  = (d) => { if (!d) return null; try { return new Date(d).toLocaleDateString("he-IL"); } catch { return d; } };

const suggestLodgingRateType = (arrivalDate, groupType) => {
  if (groupType === "DAY_USE") return "day_activity";
  if (!arrivalDate) return "midweek_lodging";
  const day = new Date(arrivalDate).getDay();
  return (day === 4 || day === 5) ? "weekend_lodging" : "midweek_lodging";
};
const calcWorkshop = (r) => Number(r.rate ?? 0);
const calcLecture  = (r) => { const base = Number(r.base_price ?? 0); return r.vat_included ? base * (1 + VAT_RATE) : base; };
const calcAddon    = (r) => Number(r.quantity) * Number(r.unit_price);

// ── Design tokens ─────────────────────────────────────────────────────────────
const CARD = "bg-white rounded-2xl border border-slate-200 shadow-sm";
const SEC_TITLE = "flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3";

// ── Reusable UI atoms ─────────────────────────────────────────────────────────
function FieldLabel({ children }) {
  return <div className="text-[11px] text-slate-400 font-medium mb-0.5">{children}</div>;
}

function SectionCard({ icon: Icon, title, subtitle, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={CARD}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-right"
      >
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-primary/70" />}
          <span className="font-semibold text-sm text-slate-700">{title}</span>
          {subtitle && <span className="text-xs text-slate-400 font-normal">{subtitle}</span>}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && <div className="px-5 pb-5 space-y-3">{children}</div>}
    </div>
  );
}

function RowTotal({ amount }) {
  return <div className="text-xs font-semibold text-primary whitespace-nowrap">{fmtMoney(amount)}</div>;
}

// ── Section sub-components (logic unchanged) ──────────────────────────────────
function StudentLodgingSection({ lines, setLines, suggestedRateType, groupType, defaultPax, defaultNights }) {
  const isDayUse = groupType === "DAY_USE";
  const update = (idx, field, val) => setLines(prev => prev.map((r, i) => i !== idx ? r : { ...r, [field]: val }));
  const addRow = () => {
    const rateType = suggestedRateType || "midweek_lodging";
    const isDay = rateType === "day_activity";
    setLines(p => [...p, { rate_type: rateType, pax: defaultPax || 0, nights: isDay ? 1 : (defaultNights || 1) }]);
  };
  return (
    <div className="space-y-2">
      {lines.map((r, idx) => {
        const isDay = r.rate_type === "day_activity";
        return (
          <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-slate-50 rounded-xl p-2.5">
            <div className="col-span-4 space-y-0.5">
              <FieldLabel>סוג</FieldLabel>
              <Select value={r.rate_type} onValueChange={v => update(idx, "rate_type", v)} disabled={isDayUse}>
                <SelectTrigger className="h-8 text-xs bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STUDENT_LODGING_RATES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label} — ₪{v.rate}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-0.5">
              <FieldLabel>תלמידים</FieldLabel>
              <Input className="h-8 text-xs bg-white" type="number" min="0" value={r.pax} onChange={e => update(idx, "pax", e.target.value)} />
            </div>
            {!isDay && (
              <div className="col-span-2 space-y-0.5">
                <FieldLabel>לילות</FieldLabel>
                <div className="h-8 flex items-center rounded-md border bg-white px-3 text-xs font-semibold">{defaultNights}</div>
              </div>
            )}
            <div className={!isDay ? "col-span-3" : "col-span-5"} />
            <div className="col-span-1 flex items-center gap-1 justify-end">
              <RowTotal amount={calcStudentLodgingLine(r, defaultNights)} />
              <button type="button" onClick={() => setLines(p => p.filter((_, i) => i !== idx))} className="text-slate-300 hover:text-red-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={addRow} className="gap-1.5 text-xs h-7 border-dashed">
        <Plus className="w-3 h-3" /> הוסף שורה
      </Button>
    </div>
  );
}

function AdultLodgingSection({ lines, setLines, defaultNights, adultsCount }) {
  const update = (idx, field, val) => setLines(prev => prev.map((r, i) => i !== idx ? r : { ...r, [field]: val }));
  const allocatedBeds = lines.reduce((sum, r) => {
    const cap = r.tent_type === "BED68" ? (r.actual_beds || 6) : (ADULT_TENT_RATES[r.tent_type]?.capacity ?? 0);
    return sum + (Number(r.tent_count) * cap);
  }, 0);
  const remaining = adultsCount - allocatedBeds;
  return (
    <div className="space-y-2">
      {adultsCount > 0 && (
        <div className={`text-xs px-3 py-1.5 rounded-lg font-medium inline-flex ${
          remaining > 0 ? "bg-amber-50 text-amber-700 border border-amber-200" :
          remaining === 0 ? "bg-green-50 text-green-700 border border-green-200" :
          "bg-blue-50 text-blue-600 border border-blue-200"
        }`}>
          {remaining > 0 ? `חסרות ${remaining} מקומות` : remaining === 0 ? `✓ כל ${adultsCount} מקומות מכוסות` : `עודף ${Math.abs(remaining)} מקומות`}
        </div>
      )}
      {lines.map((r, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-slate-50 rounded-xl p-2.5">
          <div className="col-span-4 space-y-0.5">
            <FieldLabel>סוג אוהל</FieldLabel>
            <Select value={r.tent_type} onValueChange={v => update(idx, "tent_type", v)}>
              <SelectTrigger className="h-8 text-xs bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ADULT_TENT_RATES).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label} — ₪{v.rate}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-0.5">
            <FieldLabel>אוהלים</FieldLabel>
            <Input className="h-8 text-xs bg-white" type="number" min="0" value={r.tent_count} onChange={e => update(idx, "tent_count", e.target.value)} />
          </div>
          {r.tent_type === "BED68" && (
            <div className="col-span-2 space-y-0.5">
              <FieldLabel>מיטות</FieldLabel>
              <Select value={String(r.actual_beds || 6)} onValueChange={v => update(idx, "actual_beds", Number(v))}>
                <SelectTrigger className="h-8 text-xs bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="6">6 מיטות</SelectItem>
                  <SelectItem value="8">8 מיטות</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="col-span-2 space-y-0.5">
            <FieldLabel>לילות</FieldLabel>
            <div className="h-8 flex items-center rounded-md border bg-white px-3 text-xs font-semibold">{defaultNights}</div>
          </div>
          <div className={r.tent_type === "BED68" ? "col-span-1" : "col-span-3"} />
          <div className="col-span-1 flex items-center gap-1 justify-end">
            <RowTotal amount={calcAdultLodgingLine(r, defaultNights)} />
            <button type="button" onClick={() => setLines(p => p.filter((_, i) => i !== idx))} className="text-slate-300 hover:text-red-400">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => setLines(p => [...p, { tent_type: "BED3", tent_count: 0, nights: defaultNights || 1 }])} className="gap-1.5 text-xs h-7 border-dashed">
        <Plus className="w-3 h-3" /> הוסף שורה
      </Button>
    </div>
  );
}

function WorkshopSection({ lines, setLines }) {
  const update = (idx, field, val) => setLines(prev => prev.map((r, i) => {
    if (i !== idx) return r;
    const u = { ...r, [field]: val };
    if (field === "name" || field === "audience") {
      const cat = WORKSHOP_CATALOG.find(c => c.name === (field === "name" ? val : u.name));
      if (cat) { const aud = field === "audience" ? val : u.audience; u.rate = aud === "STUDENTS" ? (cat.students ?? 0) : (cat.adults ?? 0); }
    }
    return u;
  }));
  const addRow = () => { const cat = WORKSHOP_CATALOG[0]; setLines(p => [...p, { name: cat.name, audience: "STUDENTS", rate: cat.students }]); };
  return (
    <div className="space-y-2">
      {lines.map((r, idx) => {
        const cat = WORKSHOP_CATALOG.find(c => c.name === r.name);
        return (
          <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-slate-50 rounded-xl p-2.5">
            <div className="col-span-5 space-y-0.5">
              <FieldLabel>סדנה</FieldLabel>
              <Select value={r.name} onValueChange={v => update(idx, "name", v)}>
                <SelectTrigger className="h-8 text-xs bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{WORKSHOP_CATALOG.map(c => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-3 space-y-0.5">
              <FieldLabel>קהל</FieldLabel>
              <Select value={r.audience} onValueChange={v => update(idx, "audience", v)} disabled={cat && cat.adults === null}>
                <SelectTrigger className="h-8 text-xs bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="STUDENTS">תלמידים</SelectItem>
                  {cat?.adults !== null && <SelectItem value="ADULTS">מבוגרים</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-0.5">
              <FieldLabel>מחיר (₪)</FieldLabel>
              <Input className="h-8 text-xs bg-white" type="number" min="0" value={r.rate} onChange={e => update(idx, "rate", Number(e.target.value))} />
            </div>
            <div className="col-span-2 flex items-center gap-1 justify-end">
              <RowTotal amount={calcWorkshop(r)} />
              <button type="button" onClick={() => setLines(p => p.filter((_, i) => i !== idx))} className="text-slate-300 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={addRow} className="gap-1.5 text-xs h-7 border-dashed"><Plus className="w-3 h-3" /> הוסף סדנה</Button>
    </div>
  );
}

function LectureSection({ lines, setLines }) {
  const update = (idx, field, val) => setLines(prev => prev.map((r, i) => {
    if (i !== idx) return r;
    const u = { ...r, [field]: val };
    if (field === "name") { const cat = LECTURE_CATALOG.find(c => c.name === val); if (cat) { u.lecturer = cat.lecturer; u.base_price = cat.base_price; u.vat_included = cat.vat_included; } }
    return u;
  }));
  const addRow = () => { const cat = LECTURE_CATALOG[0]; setLines(p => [...p, { name: cat.name, lecturer: cat.lecturer, base_price: cat.base_price, vat_included: cat.vat_included }]); };
  return (
    <div className="space-y-2">
      {lines.map((r, idx) => {
        const vatAmount = r.vat_included ? Math.round(Number(r.base_price) * VAT_RATE) : 0;
        return (
          <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-slate-50 rounded-xl p-2.5">
            <div className="col-span-5 space-y-0.5">
              <FieldLabel>הרצאה</FieldLabel>
              <Select value={r.name} onValueChange={v => update(idx, "name", v)}>
                <SelectTrigger className="h-8 text-xs bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{LECTURE_CATALOG.map(c => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-0.5">
              <FieldLabel>מרצה</FieldLabel>
              <div className="h-8 flex items-center text-xs text-slate-400 border rounded-lg px-2 bg-white truncate">{r.lecturer}</div>
            </div>
            <div className="col-span-2 space-y-0.5">
              <FieldLabel>מחיר בסיס (₪)</FieldLabel>
              <Input className="h-8 text-xs bg-white" type="number" min="0" value={r.base_price} onChange={e => update(idx, "base_price", Number(e.target.value))} />
            </div>
            <div className="col-span-1 flex flex-col items-center gap-0.5 pt-4">
              <FieldLabel>מע״מ</FieldLabel>
              <input type="checkbox" checked={r.vat_included} onChange={e => update(idx, "vat_included", e.target.checked)} className="w-4 h-4 accent-primary" />
            </div>
            <div className="col-span-2 flex items-end gap-1 justify-end">
              <div className="text-right">
                <RowTotal amount={calcLecture(r)} />
                {r.vat_included && <div className="text-[10px] text-slate-400">+₪{vatAmount.toLocaleString()} מע״מ</div>}
              </div>
              <button type="button" onClick={() => setLines(p => p.filter((_, i) => i !== idx))} className="text-slate-300 hover:text-red-400 mb-0.5"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={addRow} className="gap-1.5 text-xs h-7 border-dashed"><Plus className="w-3 h-3" /> הוסף הרצאה</Button>
    </div>
  );
}

function AddonSection({ lines, setLines }) {
  const update = (idx, field, val) => setLines(prev => prev.map((r, i) => i !== idx ? r : { ...r, [field]: val }));
  return (
    <div className="space-y-2">
      {lines.map((r, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-slate-50 rounded-xl p-2.5">
          <div className="col-span-5"><Input className="h-8 text-xs bg-white" placeholder="תיאור" value={r.description} onChange={e => update(idx, "description", e.target.value)} /></div>
          <div className="col-span-2 space-y-0.5"><FieldLabel>כמות</FieldLabel><Input className="h-8 text-xs bg-white" type="number" min="0" value={r.quantity} onChange={e => update(idx, "quantity", e.target.value)} /></div>
          <div className="col-span-2 space-y-0.5"><FieldLabel>מחיר יחידה</FieldLabel><Input className="h-8 text-xs bg-white" type="number" min="0" value={r.unit_price} onChange={e => update(idx, "unit_price", e.target.value)} /></div>
          <div className="col-span-2 flex items-end justify-end gap-1"><RowTotal amount={calcAddon(r)} /><button type="button" onClick={() => setLines(p => p.filter((_, i) => i !== idx))} className="text-slate-300 hover:text-red-400 mb-0.5"><Trash2 className="w-3.5 h-3.5" /></button></div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => setLines(p => [...p, { description: "", quantity: 1, unit_price: 0 }])} className="gap-1.5 text-xs h-7 border-dashed"><Plus className="w-3 h-3" /> הוסף תוספת</Button>
    </div>
  );
}

// ── Right Sidebar ─────────────────────────────────────────────────────────────
function CalendarCard({ arrival, departure, nights, isDayUse }) {
  const hasDate = arrival;
  return (
    <div className={`${CARD} p-4`}>
      <div className={SEC_TITLE}><CalendarDays className="w-4 h-4 text-primary" />תאריכי פעילות</div>
      {hasDate ? (
        <div className="space-y-2">
          {isDayUse ? (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">תאריך פעילות</span>
              <span className="font-semibold text-slate-700">{fmtDate(arrival)}</span>
            </div>
          ) : (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">הגעה</span>
                <span className="font-semibold text-slate-700">{fmtDate(arrival)}</span>
              </div>
              {departure && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">עזיבה</span>
                  <span className="font-semibold text-slate-700">{fmtDate(departure)}</span>
                </div>
              )}
            </>
          )}
          <div className="mt-2 bg-primary/5 border border-primary/15 rounded-xl py-2 text-center">
            <div className="text-lg font-bold text-primary">{isDayUse ? "יום פעילות" : `לילות: ${nights}`}</div>
          </div>
        </div>
      ) : (
        <div className="text-sm text-slate-400 text-center py-4">בחר תאריך בטופס</div>
      )}
    </div>
  );
}

function SummaryCard({ groupName, activityType, totalPax, staffCount, participantCount, workshops, lectures, coffeeEnabled }) {
  return (
    <div className={`${CARD} p-4`}>
      <div className={SEC_TITLE}><Users className="w-4 h-4 text-primary" />סיכום קבוצה</div>
      <div className="space-y-2 text-sm">
        {groupName && <div className="font-semibold text-slate-700 truncate">{groupName}</div>}
        {activityType && <div className="text-xs text-slate-400">{activityType}</div>}
        <div className="border-t border-slate-100 pt-2 space-y-1.5">
          {totalPax > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-400">סה״כ משתתפים</span>
              <span className="font-medium">{totalPax}</span>
            </div>
          )}
          {staffCount > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-400">צוות</span>
              <span className="font-medium">{staffCount}</span>
            </div>
          )}
          {participantCount > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-400">חניכים</span>
              <span className="font-medium">{participantCount}</span>
            </div>
          )}
        </div>
        {(workshops.length > 0 || lectures.length > 0 || coffeeEnabled) && (
          <div className="border-t border-slate-100 pt-2 space-y-1">
            {workshops.map((w, i) => <div key={i} className="text-xs text-slate-500 flex items-center gap-1"><BookOpen className="w-3 h-3" />{w.name}</div>)}
            {lectures.map((l, i) => <div key={i} className="text-xs text-slate-500 flex items-center gap-1"><Mic2 className="w-3 h-3" />{l.name}</div>)}
            {coffeeEnabled && <div className="text-xs text-slate-500 flex items-center gap-1"><Coffee className="w-3 h-3" />פינת קפה</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function PricingCard({ subtotal, discountAmount, discountPct, totalPrice, advance, balance, requiresAdvancePayment }) {
  const hasDiscount = discountAmount > 0;
  return (
    <div className={`${CARD} p-4 border-primary/20`}>
      <div className={SEC_TITLE}><Tag className="w-4 h-4 text-primary" />תמחור חי</div>
      <div className="space-y-2 text-sm">
        {hasDiscount && (
          <div className="flex justify-between text-slate-500">
            <span>סכום לפני הנחה</span>
            <span>{fmtMoney(subtotal)}</span>
          </div>
        )}
        {hasDiscount && (
          <div className="flex justify-between text-red-500">
            <span>הנחה {discountPct}%</span>
            <span>−{fmtMoney(discountAmount)}</span>
          </div>
        )}
        {!hasDiscount && (
          <div className="flex justify-between text-slate-500">
            <span>סכום ביניים</span>
            <span>{fmtMoney(subtotal)}</span>
          </div>
        )}

        {/* Big total */}
        <div className="bg-primary rounded-xl px-4 py-3 flex justify-between items-center">
          <span className="text-white font-semibold text-sm">סה״כ לתשלום</span>
          <span className="text-white font-bold text-lg">{fmtMoney(totalPrice)}</span>
        </div>

        {requiresAdvancePayment && (
          <div className="border-t border-slate-100 pt-2 space-y-1.5">
            <div className="flex justify-between text-slate-500 text-xs">
              <span>מקדמה 30%</span>
              <span className="font-medium text-slate-700">{fmtMoney(advance)}</span>
            </div>
            <div className="flex justify-between text-slate-500 text-xs">
              <span>יתרה 70%</span>
              <span className="font-medium text-slate-700">{fmtMoney(balance)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function QuoteFormModal({ quote, group, onClose, onSaved, returnToQuotes = false }) {
  const isEdit = !!quote;
  const isNewGroupFlow = !group;
  const navigate = useNavigate();
  const { role } = useRoleContext();
  const preparationFlowEnabled = isQuotePreparationEnabled(role);
  const multiOptionFeatureEnabled = isQuoteMultiOptionEnabled(role);

  // New-group flow: group shell fields. Group name, client organization and contact stay separate.
  const [groupForm, setGroupForm] = useState({
    group_type: "LODGING",
    contact_name: "", contact_phone: "", contact_email: "", client_tax_id: "",
  });

  const groupType = isNewGroupFlow ? groupForm.group_type : (group?.group_type || "LODGING");
  const isDayUse = groupType === "DAY_USE";
  const setGroupField = (k, v) => setGroupForm(f => ({ ...f, [k]: v }));

  const handleGroupNameChange = (v) => setForm(f => ({ ...f, group_name: v }));

  // Contact person fields mirror into quote client_phone/email but NOT client_name
  const handleGroupContactChange = (k, v) => {
    setGroupField(k, v);
    const mirrorMap = { contact_phone: "client_phone", contact_email: "client_email", client_tax_id: "client_tax_id" };
    if (mirrorMap[k]) setForm(f => ({ ...f, [mirrorMap[k]]: v }));
  };

  // C. Track whether user manually overrode expiration date
  const expiryAutoGenRef = useRef(!quote?.valid_until); // true = was auto-generated or empty

  const [form, setForm] = useState({
    group_name:      quote?.group_name      || "",
    quote_number:    quote?.quote_number    || "",
    quote_audience_type: quote ? (quote.quote_audience_type || "EDUCATION_STAFF") : "",
    version:         quote?.version         || 1,
    status:          quote?.status          || "DRAFT",
    client_name:     quote?.client_name     || group?.group_name    || "",
    contact_person:  quote?.contact_person  || group?.contact_name  || "",
    client_phone:    quote?.client_phone    || group?.contact_phone || "",
    client_email:    quote?.client_email    || group?.contact_email || "",
    client_tax_id:   quote?.client_tax_id   || "",
    client_notes:    quote?.client_notes    || "",
    arrival_date:    quote?.arrival_date    || group?.arrival_date   || "",
    departure_date:  quote?.departure_date  || group?.departure_date || "",
    arrival_time:    quote?.arrival_time    || group?.arrival_time   || "",
    departure_time:  quote?.departure_time  || group?.departure_time || "",
    estimated_pax:   quote?.estimated_pax   ?? group?.total_pax     ?? "",
    staff_count:     quote?.staff_count     ?? group?.staff_count   ?? "",
    discount_percent: quote?.discount_percent ?? 0,
    requires_advance_payment: quote?.requires_advance_payment !== false,
    payment_terms:   quote?.payment_terms   || "",
    valid_until:     quote?.valid_until     || "",
    internal_notes:  quote?.internal_notes  || "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const [coffeeEnabled, setCoffeeEnabled] = useState(quote ? (quote.coffee_corner_pax > 0) : false);
  const [coffeeCornerPax, setCoffeeCornerPax] = useState(Number(quote?.coffee_corner_pax || 0));
  const [prisaEnabled, setPrisaEnabled] = useState(quote ? (quote.includes_prisa === true) : false);
  // ── Quote type (for catalog organization) ────────────────────────────────────
  const deriveQuoteType = () => {
    if (quote?.quote_type) return quote.quote_type;
    const gt = isNewGroupFlow ? groupForm.group_type : (group?.group_type || "LODGING");
    if (gt === "LODGING") return "lodging";
    if (gt === "DAY_USE") return "day_use";
    return "custom";
  };
  const [quoteType, setQuoteType] = useState(deriveQuoteType);

  const initArrival    = quote?.arrival_date    || group?.arrival_date    || "";
  const initDeparture  = quote?.departure_date  || group?.departure_date  || "";
  const initNights     = getQuoteNights(initArrival, initDeparture, deriveQuoteType()) || 1; // default 1 for row init
  const initEstPax     = Number(quote?.estimated_pax ?? group?.total_pax    ?? 0);
  const initStaff      = Number(quote?.staff_count   ?? group?.staff_count  ?? 0);
  const initParticipants = Math.max(0, initEstPax - initStaff);
  const initRateType   = suggestLodgingRateType(initArrival, group?.group_type || "LODGING");

  const initStudentLodging = () => {
    const saved = parse(quote?.student_lodging_lines, null);
    if (saved !== null) return saved;
    const effectiveGroupType = isNewGroupFlow ? groupForm.group_type : (group?.group_type || "LODGING");
    const effectiveRateType = suggestLodgingRateType(initArrival, effectiveGroupType);
    const isDay = effectiveRateType === "day_activity";
    // Always seed a row for DAY_USE; for LODGING only if there are participants
    if (!isDay && initParticipants === 0) return [];
    return [{ rate_type: effectiveRateType, pax: initParticipants, nights: isDay ? 1 : initNights }];
  };

  const [studentLodging, setStudentLodging] = useState(initStudentLodging);
  const [adultLodging,   setAdultLodging]   = useState(parse(quote?.adult_lodging_lines, []));
  const [workshops,      setWorkshops]      = useState(parse(quote?.workshop_lines,       []));
  const [lectures,       setLectures]       = useState(parse(quote?.lecture_lines,        []));
  const [addons,         setAddons]         = useState(parse(quote?.addon_lines,          []));
  // Unified manual adjustments — merge legacy adjustment_lines + surcharge_lines,
  // normalizing every row to { description, unit_price, quantity } (old data preserved).
  const [adjustments, setAdjustments] = useState(() => {
    const legacyAdjust    = parse(quote?.adjustment_lines, []).map(r => normalizeAdjustmentRow(r));
    const legacySurcharge = parse(quote?.surcharge_lines,  []).map(r => normalizeAdjustmentRow(r));
    return [...legacyAdjust, ...legacySurcharge];
  });
  // New catalog lines — legacy rows infer AUTO only when their saved quantity matches saved pax.
  const initialCatalogLines = useRef(normalizeCatalogLines(
    parse(quote?.package_lines, []), parse(quote?.new_addon_lines, []), initEstPax
  )).current;
  const [packageLines,   setPackageLines]   = useState(initialCatalogLines.packageLines);
  const [newAddonLines,  setNewAddonLines]  = useState(initialCatalogLines.addonLines);
  const [saving, setSaving] = useState(false);
  const [optionBusy, setOptionBusy] = useState(false);
  const optionCreateLockRef = useRef(false);
  const [optionLoading, setOptionLoading] = useState(() => Boolean(multiOptionFeatureEnabled && quote?.id && quote.multi_option_enabled));
  const [optionLoadError, setOptionLoadError] = useState("");
  const [optionNotes, setOptionNotes] = useState("");
  const [activeOptionKey, setActiveOptionKey] = useState("A");
  const [previewMode, setPreviewMode] = useState("A");
  const [hasOptionB, setHasOptionB] = useState(false);
  const [optionDrafts, setOptionDrafts] = useState({});
  const optionDraftsRef = useRef({});
  const optionLoadedQuoteRef = useRef(null);
  const optionLoadRequestRef = useRef(0);
  const previousPaxRef = useRef(initEstPax);
  const previousStaffRef = useRef(initStaff);
  const [audienceError, setAudienceError] = useState(false);
  const [availabilityResult, setAvailabilityResult] = useState(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);

  // ── Live calcs (must be before useCallback that references them) ─────────────
  const estimatedPax     = Number(form.estimated_pax || 0);
  const staffCount       = Number(form.staff_count   || 0);
  // A. participantCount is always calculated — never editable
  const participantCount = Math.max(0, estimatedPax - staffCount);
  const nights = getQuoteNights(form.arrival_date, form.departure_date, quoteType);
  const staffExceedsTotal = staffCount > estimatedPax && estimatedPax > 0;
  const datesReversed = quoteType !== "day_use" && isValidDateString(form.arrival_date) && isValidDateString(form.departure_date) &&
    form.departure_date < form.arrival_date;
  // B. Default pax for catalog lines: always use estimated_pax (total participants)
  const catalogDefaultPax = estimatedPax || 0;

  // ── Capacity check ───────────────────────────────────────────────────────────
  const checkAvailability = useCallback(async () => {
    const pax = Number(form.estimated_pax);
    if (!form.arrival_date || !pax || !groupType) return;
    setCheckingAvailability(true);
    // includes_meals: true for LODGING groups (they always have meals)
    const includesMeals = groupType === "LODGING";
    try {
      const res = await base44.functions.invoke("checkSiteAvailability", {
        arrival_date:      form.arrival_date,
        departure_date:    form.departure_date || form.arrival_date,
        total_pax:         pax,
        participant_count: participantCount || undefined,
        staff_count:       Number(form.staff_count) || undefined,
        group_type:        groupType,
        includes_meals:    includesMeals,
        exclude_quote_id:  quote?.id || undefined,
        exclude_group_id:  group?.id || undefined,
        adult_lodging_lines: JSON.stringify(adultLodging),
      });
      setAvailabilityResult(res.data);
    } catch { /* fail silently */ }
    setCheckingAvailability(false);
  }, [form.arrival_date, form.departure_date, form.estimated_pax, participantCount, form.staff_count, groupType, quote?.id, group?.id, adultLodging]);

  useEffect(() => {
    const timer = setTimeout(checkAvailability, 700);
    return () => clearTimeout(timer);
  }, [checkAvailability]);

  // C. Auto-set expiration = arrival + 14 days when arrival changes
  useEffect(() => {
    if (!form.arrival_date || !isValidDateString(form.arrival_date)) return;
    if (!expiryAutoGenRef.current) return; // user manually set it, don't override
    const [year, month, day] = form.arrival_date.split("-").map(Number);
    const d = new Date(Date.UTC(year, month - 1, day));
    d.setUTCDate(d.getUTCDate() + 14);
    set("valid_until", d.toISOString().slice(0, 10));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.arrival_date]);

  const suggestedRateType = suggestLodgingRateType(form.arrival_date, groupType);
  const priced = priceQuoteParts({
    studentLodging, adultLodging, workshops, lectures, addons, adjustments,
    packageLines, newAddonLines, coffeeEnabled, staffCount, prisaEnabled, estimatedPax,
  }, nights, quoteType === "day_use");
  const studentLodgingTotal = priced.student;
  const adultLodgingTotal = priced.adult;
  const workshopTotal = priced.workshops;
  const lectureTotal = priced.lectures;
  const coffeeTotal = priced.coffee;
  const addonTotal = priced.addons;
  const adjustmentTotal = priced.adjustments;
  const packageLinesTotal = priced.packages;
  const newAddonLinesTotal = priced.catalogAddons;
  const prisaTotal = priced.prisa;
  const subtotal = priced.subtotal;
  const discountAmount      = Math.round(subtotal * Number(form.discount_percent || 0) / 100);
  const total_price         = subtotal - discountAmount;
  const advance             = Math.round(total_price * 0.3);
  const balance             = total_price - advance;

  const captureCurrentOptionPayload = () => extractQuoteOptionPayload({
    package_lines: JSON.stringify(packageLines), new_addon_lines: JSON.stringify(newAddonLines),
    student_lodging_lines: JSON.stringify(studentLodging), adult_lodging_lines: JSON.stringify(adultLodging),
    workshop_lines: JSON.stringify(workshops), lecture_lines: JSON.stringify(lectures),
    coffee_corner_pax: coffeeEnabled ? coffeeCornerPax : 0, includes_prisa: prisaEnabled,
    addon_lines: JSON.stringify(addons), adjustment_lines: JSON.stringify(adjustments), surcharge_lines: JSON.stringify([]),
    discount_percent: Number(form.discount_percent || 0), subtotal, discount_amount: discountAmount,
    total_price, advance_payment: advance, balance_payment: balance,
    payment_terms: form.payment_terms, option_notes: optionNotes,
  });

  const replaceOptionDrafts = drafts => {
    optionDraftsRef.current = drafts;
    setOptionDrafts(drafts);
  };

  const captureActiveOptionDraft = () => {
    const captured = captureCurrentOptionPayload();
    const stored = optionDraftsRef.current[activeOptionKey];
    return stored && isOptionDraftSemanticallyEqual(captured, stored) ? stored : captured;
  };

  const applyOptionDraft = (payload = {}) => {
    setPackageLines(parse(payload.package_lines, [])); setNewAddonLines(parse(payload.new_addon_lines, []));
    setStudentLodging(parse(payload.student_lodging_lines, [])); setAdultLodging(parse(payload.adult_lodging_lines, []));
    setWorkshops(parse(payload.workshop_lines, [])); setLectures(parse(payload.lecture_lines, []));
    setAddons(parse(payload.addon_lines, [])); setAdjustments(parse(payload.adjustment_lines, []));
    setCoffeeEnabled(Number(payload.coffee_corner_pax || 0) > 0); setCoffeeCornerPax(Number(payload.coffee_corner_pax || 0));
    setPrisaEnabled(payload.includes_prisa === true);
    set("discount_percent", payload.discount_percent ?? 0); set("payment_terms", payload.payment_terms || ""); setOptionNotes(payload.option_notes || "");
  };

  useEffect(() => {
    if (previousPaxRef.current === estimatedPax) return;
    const previousPax = previousPaxRef.current;
    previousPaxRef.current = estimatedPax;
    const current = captureCurrentOptionPayload();
    const prisaDelta = current.includes_prisa ? (estimatedPax - previousPax) * PRISA_RATE : 0;
    const drafts = { ...optionDraftsRef.current, [activeOptionKey]: { ...current, subtotal: Number(current.subtotal || 0) - prisaDelta } };
    const syncedDrafts = Object.fromEntries(Object.entries(drafts).map(([key, payload]) => [key, syncOptionPayloadPax(payload, estimatedPax, previousPax, nights, quoteType === "day_use")]));
    replaceOptionDrafts(syncedDrafts);
    applyOptionDraft(syncedDrafts[activeOptionKey]);
  // An explicit shared pax change synchronizes each draft once; tab navigation never does.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimatedPax]);

  useEffect(() => {
    if (previousStaffRef.current === staffCount) return;
    previousStaffRef.current = staffCount;
    if (coffeeEnabled) setCoffeeCornerPax(staffCount);
  }, [staffCount, coffeeEnabled]);

  useEffect(() => {
    if (!multiOptionFeatureEnabled || !quote?.id || !quote.multi_option_enabled || optionLoadedQuoteRef.current === quote.id) return;
    const requestId = ++optionLoadRequestRef.current;
    setOptionLoading(true); setOptionLoadError("");
    base44.entities.QuoteOption.filter({ quote_id: quote.id }).then(rows => {
      if (requestId !== optionLoadRequestRef.current) return;
      const optionA = rows.filter(row => row.option_key === "A"); const optionB = rows.filter(row => row.option_key === "B");
      if (rows.length !== 2 || optionA.length !== 1 || optionB.length !== 1) throw new Error(optionA.length > 1 || optionB.length > 1 ? "DUPLICATE_QUOTE_OPTION" : "BOTH_OPTIONS_REQUIRED");
      const drafts = {
        A: normalizeOptionPayload(parseOptionPayload(optionA[0].option_payload), initEstPax),
        B: normalizeOptionPayload(parseOptionPayload(optionB[0].option_payload), initEstPax),
      };
      optionLoadedQuoteRef.current = quote.id; replaceOptionDrafts(drafts); setHasOptionB(true); applyOptionDraft(drafts.A);
    }).catch(error => { setOptionLoadError(error.message); toast.error("טעינת אפשרויות ההצעה נכשלה"); }).finally(() => { if (requestId === optionLoadRequestRef.current) setOptionLoading(false); });
  // Backend option payloads initialize once per opened Quote; local edits must never be overwritten.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiOptionFeatureEnabled, quote?.id, quote?.multi_option_enabled]);

  const switchOption = key => {
    if (key === activeOptionKey) { setPreviewMode(key); return; }
    const current = captureActiveOptionDraft();
    const drafts = { ...optionDraftsRef.current, [activeOptionKey]: current };
    const target = drafts[key];
    if (!target) return;
    replaceOptionDrafts(drafts);
    applyOptionDraft(target);
    setActiveOptionKey(key); setPreviewMode(key);
  };

  const addOptionB = async () => {
    if (optionBusy || hasOptionB || optionCreateLockRef.current) return;
    optionCreateLockRef.current = true;
    const current = captureActiveOptionDraft();
    if (!quote?.id) {
      const emptyOptionB = createEmptyQuoteOption("B");
      replaceOptionDrafts({ A: current, B: emptyOptionB }); setHasOptionB(true); setActiveOptionKey("B"); setPreviewMode("B"); applyOptionDraft(emptyOptionB);
      toast.success("אפשרות ב׳ נוצרה כאפשרות חדשה וריקה");
      optionCreateLockRef.current = false;
      return;
    }
    setOptionBusy(true);
    try {
      const res = await base44.functions.invoke("manageQuoteOptions", { action: "materialize", quote_id: quote.id, option_a_payload: current });
      const drafts = Object.fromEntries((res.data?.options || []).map(row => [row.option_key, normalizeOptionPayload(parseOptionPayload(row.option_payload), initEstPax)]));
      if (!drafts.A || !drafts.B) throw new Error("BOTH_OPTIONS_REQUIRED");
      replaceOptionDrafts(drafts); setHasOptionB(true); setActiveOptionKey("B"); setPreviewMode("B"); applyOptionDraft(drafts.B);
      toast.success("אפשרות ב׳ נוצרה כאפשרות חדשה וריקה");
    } catch { toast.error("יצירת אפשרות ב׳ נכשלה"); }
    finally { setOptionBusy(false); optionCreateLockRef.current = false; }
  };

  const deleteOptionB = async () => {
    if (!window.confirm("האם למחוק את אפשרות ב׳?\nהנתונים של אפשרות א׳ לא יושפעו.")) return;
    if (!quote?.id) {
      const optionA = activeOptionKey === "A" ? captureActiveOptionDraft() : optionDraftsRef.current.A;
      applyOptionDraft(optionA); replaceOptionDrafts({ A: optionA }); setActiveOptionKey("A"); setPreviewMode("A"); setHasOptionB(false);
      return;
    }
    setOptionBusy(true);
    try {
      const res = await base44.functions.invoke("manageQuoteOptions", { action: "delete_b", quote_id: quote.id });
      if (!res.data?.success) { setOptionBusy(false); return toast.error(res.data?.error === "APPROVED_OPTION_CANNOT_BE_DELETED" ? "לא ניתן למחוק אפשרות ב׳ שאושרה" : "מחיקת אפשרות ב׳ נכשלה"); }
      const optionA = activeOptionKey === "A" ? captureActiveOptionDraft() : optionDraftsRef.current.A;
      applyOptionDraft(optionA); replaceOptionDrafts({ A: optionA }); setActiveOptionKey("A"); setPreviewMode("A"); setHasOptionB(false);
    } catch { toast.error("מחיקת אפשרות ב׳ נכשלה"); }
    setOptionBusy(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (optionLoading || optionLoadError) return toast.error("לא ניתן לשמור לפני טעינת אפשרויות ההצעה");
    if (!form.quote_audience_type) {
      setAudienceError(true);
      return;
    }
    setAudienceError(false);
    const dateFields = [
      ["arrival_date", "תאריך ההגעה אינו תקין"],
      ["departure_date", "תאריך העזיבה אינו תקין"],
      ["valid_until", "תוקף ההצעה אינו תקין"],
    ];
    const invalidDate = dateFields.find(([field]) => form[field] && !isValidDateString(form[field]));
    if (invalidDate) {
      toast.error(invalidDate[1]);
      return;
    }
    setSaving(true);
    try {
      const usePreparationFlow = preparationFlowEnabled && isNewGroupFlow;
      let resolvedGroupId = group?.id;
      if (isNewGroupFlow && !usePreparationFlow) {
        const totalPax = Number(form.estimated_pax || 0);
        const staffPax = Number(form.staff_count || 0);
        const newGroup = await base44.entities.Group.create({
          group_name: getEffectiveQuoteGroupName(form),
          group_type: groupForm.group_type,
          arrival_date: form.arrival_date || undefined,
          departure_date: form.departure_date || undefined,
          arrival_time: form.arrival_time || undefined,
          departure_time: form.departure_time || undefined,
          total_pax: totalPax || undefined,
          staff_count: staffPax || undefined,
          participant_count: Math.max(0, totalPax - staffPax) || undefined,
          contact_name: groupForm.contact_name || undefined,
          contact_phone: groupForm.contact_phone || undefined,
          contact_email: groupForm.contact_email || undefined,
          status: "DRAFT",
        });
        resolvedGroupId = newGroup.id;
      }
      const activeOptionPayload = captureActiveOptionDraft();
      const rawDraftsToSave = { ...optionDraftsRef.current, [activeOptionKey]: activeOptionPayload };
      const draftsToSave = Object.fromEntries(Object.entries(rawDraftsToSave).map(([key, payload]) => [key, repriceOptionPayload(payload, nights, quoteType === "day_use", estimatedPax)]));
      let quotePayload = {
        ...form,
        client_name: form.client_name.trim(),
        group_name: form.group_name.trim(),
        ...(resolvedGroupId ? { group_id: resolvedGroupId } : {}),
        ...(usePreparationFlow ? { preparation_flow_enabled: true, status: "DRAFT" } : {}),
        student_lodging_lines: quoteType === "day_use" ? JSON.stringify([]) : JSON.stringify(studentLodging.map(line => line.rate_type === "day_activity" ? line : { ...line, nights })),
        adult_lodging_lines: quoteType === "day_use" ? JSON.stringify([]) : JSON.stringify(adultLodging.map(line => ({ ...line, nights }))),
        workshop_lines: JSON.stringify(workshops), lecture_lines: JSON.stringify(lectures),
        addon_lines: JSON.stringify(addons), adjustment_lines: JSON.stringify(adjustments), surcharge_lines: JSON.stringify([]),
        package_lines: JSON.stringify(packageLines), new_addon_lines: JSON.stringify(newAddonLines),
        quote_type: quoteType, contact_person: form.contact_person || undefined, client_notes: form.client_notes || undefined,
        arrival_time: form.arrival_time || undefined, departure_time: form.departure_time || undefined,
        subtotal, discount_amount: discountAmount, total_price, advance_payment: advance, balance_payment: balance,
        version: Number(form.version), estimated_pax: estimatedPax || undefined, staff_count: staffCount || undefined,
        participant_count: participantCount || undefined, coffee_corner_pax: coffeeEnabled ? staffCount : 0,
        nights, includes_prisa: prisaEnabled, discount_percent: Number(form.discount_percent || 0),
      };
      if (hasOptionB) { const legacyOptionA = { ...draftsToSave.A }; delete legacyOptionA.option_notes; quotePayload = applyOptionPayloadToQuote(quotePayload, legacyOptionA); }
      const savedQuote = isEdit
        ? await base44.entities.Quote.update(quote.id, quotePayload)
        : await base44.entities.Quote.create(quotePayload);
      let finalSavedQuote = savedQuote;
      let savedOptions = [];
      if (hasOptionB) {
        const optionsRes = await base44.functions.invoke("manageQuoteOptions", { action: "save", quote_id: savedQuote.id, options: draftsToSave });
        if (!optionsRes.data?.success) throw new Error(optionsRes.data?.error || "OPTION_SAVE_FAILED");
        savedOptions = optionsRes.data.options || [];
        finalSavedQuote = { ...savedQuote, multi_option_enabled: true };
      }
      if (usePreparationFlow || quote?.preparation_flow_enabled) {
        const ensured = await base44.functions.invoke("ensureQuotePreparationGroup", { quote_id: savedQuote.id });
        if (!ensured.data?.success) throw new Error(ensured.data?.error || "PREPARATION_INIT_FAILED");
        resolvedGroupId = ensured.data.group?.id;
        finalSavedQuote = ensured.data.quote || finalSavedQuote;
      }
      setSaving(false);
      if (returnToQuotes) onSaved(finalSavedQuote, savedOptions);
      else if (usePreparationFlow && resolvedGroupId) { navigate(`/groups/${resolvedGroupId}`); onClose(); }
      else onSaved(finalSavedQuote, savedOptions);
    } catch (error) {
      setSaving(false);
      toast.error(error?.message === "FEATURE_DISABLED" ? "זרימת ההכנה מושבתת כרגע" : error?.message === "PREPARATION_INIT_FAILED" ? "יצירת קבוצת ההכנה נכשלה" : "שמירת הצעת המחיר נכשלה");
    }
  };

  const groupNameDisplay = form.group_name.trim() || form.client_name.trim() || group?.group_name;
  const repricedOptionDrafts = Object.fromEntries(Object.entries(optionDrafts).map(([key, payload]) => [key, repriceOptionPayload(payload, nights, quoteType === "day_use", estimatedPax)]));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent
        className="w-full max-w-[95vw] sm:w-[1100px] h-dvh sm:h-auto sm:max-h-[95vh] overflow-hidden p-0 flex flex-col"
        dir="rtl"
      >
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-200 bg-white shrink-0">
          <DialogTitle className="text-base font-bold text-slate-800">
            {isEdit ? "עריכת הצעת מחיר" : isNewGroupFlow ? "הצעת מחיר — לקוח חדש" : "הצעת מחיר חדשה"}
          </DialogTitle>
          <div className="flex items-center gap-2 text-sm">
            {form.quote_number && <span className="text-slate-400 font-mono hidden sm:inline">{form.quote_number}</span>}
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              form.status === "APPROVED" ? "bg-green-100 text-green-700" :
              form.status === "SENT"     ? "bg-blue-100 text-blue-700" :
              form.status === "REJECTED" ? "bg-red-100 text-red-700" :
              "bg-slate-100 text-slate-600"
            }`}>{form.status}</span>
          </div>
        </div>

        {/* Body — desktop: two columns | mobile: single scrollable column */}
        <div className="flex-1 overflow-y-auto sm:overflow-hidden flex flex-col sm:flex-row">

          {/* ── Form (scrollable) ── */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
            <form id="quote-form" onSubmit={handleSubmit} className="space-y-4">

              {/* Group shell (new-group flow) */}
              {isNewGroupFlow && (
                <SectionCard icon={Users} title="פרטי קבוצה" subtitle="חדש">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs text-slate-500">שם לקוח / ארגון *</Label>
                      <Input required value={form.client_name} onChange={e => set("client_name", e.target.value)} />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs text-slate-500">שם קבוצה</Label>
                      <Input value={form.group_name} onChange={e => handleGroupNameChange(e.target.value)} placeholder="שם הקבוצה שתגיע, אם שונה משם הלקוח" />
                      <p className="text-[11px] text-slate-400">אופציונלי — יש למלא רק אם שם הקבוצה שונה משם הלקוח</p>
                    </div>
                    {/* group_type is kept in state but driven by the quoteType pill selector below */}
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-500">ח.פ / ע.מ</Label>
                      <Input value={groupForm.client_tax_id} onChange={e => handleGroupContactChange("client_tax_id", e.target.value)} placeholder="מספר חברה / עוסק" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-500">איש קשר (מופיע ב-PDF)</Label>
                      <Input value={groupForm.contact_name} onChange={e => {
                        setGroupField("contact_name", e.target.value);
                        set("contact_person", e.target.value);
                      }} placeholder="שם מלא של איש הקשר" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-500">טלפון</Label>
                      <Input value={groupForm.contact_phone} onChange={e => handleGroupContactChange("contact_phone", e.target.value)} />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs text-slate-500">אימייל</Label>
                      <Input type="email" value={groupForm.contact_email} onChange={e => handleGroupContactChange("contact_email", e.target.value)} />
                    </div>
                  </div>
                </SectionCard>
              )}

              <QuoteAudienceSelector
                value={form.quote_audience_type}
                onChange={value => { set("quote_audience_type", value); setAudienceError(false); }}
                error={audienceError}
              />

              {/* Quote type selector */}
              <div className={`${CARD} px-5 py-4`}>
                <div className={SEC_TITLE}><Package className="w-4 h-4 text-primary" />סוג פעילות</div>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { id: "lodging",  label: "קבוצה עם לינה" },
                    { id: "day_use",  label: "פעילות יום" },
                    { id: "custom",   label: "מותאם אישית" },
                  ].map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setQuoteType(opt.id);
                        // Sync internal group_type so downstream logic stays consistent
                        if (opt.id === "lodging") {
                          setGroupField("group_type", "LODGING");
                          // Clear departure=arrival override if switching back to lodging
                        } else if (opt.id === "day_use") {
                          setGroupField("group_type", "DAY_USE");
                          // Mirror arrival → departure for day-use
                          if (form.arrival_date) set("departure_date", form.arrival_date);
                        }
                        // custom: leave existing group_type unchanged
                      }}
                      className={`px-4 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        quoteType === opt.id
                          ? "bg-primary text-white border-primary"
                          : "bg-white text-slate-600 border-slate-200 hover:border-primary/50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quote meta */}
              <SectionCard icon={SlidersHorizontal} title="פרטי הצעה" defaultOpen={true}>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">מספר הצעה</Label>
                    <Input value={form.quote_number} onChange={e => set("quote_number", e.target.value)} placeholder="Q-2026-001" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">גרסה</Label>
                    <Input type="number" min="1" value={form.version} onChange={e => set("version", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">סטטוס</Label>
                    <Select value={form.status} onValueChange={v => set("status", v)} disabled={quote?.preparation_flow_enabled || (preparationFlowEnabled && isNewGroupFlow)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{["DRAFT","SENT","APPROVED","REJECTED","EXPIRED"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {quoteType === "day_use" ? (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">תאריך פעילות</Label>
                        <Input type="date" value={form.arrival_date} onChange={e => { expiryAutoGenRef.current = true; set("arrival_date", e.target.value); set("departure_date", e.target.value); }} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">בתוקף עד</Label>
                        <Input type="date" value={form.valid_until} onChange={e => { expiryAutoGenRef.current = false; set("valid_until", e.target.value); }} />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">תאריך הגעה</Label>
                        <Input type="date" value={form.arrival_date} onChange={e => { expiryAutoGenRef.current = true; set("arrival_date", e.target.value); }} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">תאריך עזיבה</Label>
                        <Input
                          type="date"
                          value={form.departure_date}
                          min={form.arrival_date || undefined}
                          onChange={e => set("departure_date", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">בתוקף עד</Label>
                        <Input type="date" value={form.valid_until} onChange={e => { expiryAutoGenRef.current = false; set("valid_until", e.target.value); }} />
                      </div>
                    </>
                  )}
                </div>

                {/* Client fields */}
                <div className="border-t border-slate-100 pt-3 grid grid-cols-2 gap-3">
                  {!isNewGroupFlow && <div className="col-span-2 space-y-1"><Label className="text-xs text-slate-500">שם קבוצה</Label><Input value={form.group_name} onChange={e => handleGroupNameChange(e.target.value)} placeholder="שם הקבוצה שתגיע, אם שונה משם הלקוח" /><p className="text-[11px] text-slate-400">אופציונלי — יש למלא רק אם שם הקבוצה שונה משם הלקוח</p></div>}
                  {!isNewGroupFlow && <div className="space-y-1">
                    <Label className="text-xs text-slate-500">שם לקוח / ארגון *</Label>
                    <Input required value={form.client_name} onChange={e => set("client_name", e.target.value)} />
                  </div>}
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">איש קשר (מופיע ב-PDF)</Label>
                    <Input value={form.contact_person} onChange={e => set("contact_person", e.target.value)} placeholder="שם מלא של איש הקשר" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">טלפון</Label>
                    <Input value={form.client_phone} onChange={e => set("client_phone", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">אימייל</Label>
                    <Input type="email" value={form.client_email} onChange={e => set("client_email", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">ח.פ / ע.מ</Label>
                    <Input value={form.client_tax_id} onChange={e => set("client_tax_id", e.target.value)} />
                  </div>
                </div>

                {/* Arrival/departure times */}
                <div className="border-t border-slate-100 pt-3 grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">שעת הגעה <span className="text-slate-300">(אופציונלי)</span></Label>
                    <Input type="time" value={form.arrival_time} onChange={e => set("arrival_time", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">שעת יציאה <span className="text-slate-300">(אופציונלי)</span></Label>
                    <Input type="time" value={form.departure_time} onChange={e => set("departure_time", e.target.value)} />
                  </div>
                </div>

                {/* Headcounts — A. total + staff editable, students calculated */}
                <div className="border-t border-slate-100 pt-3 grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">סה״כ משתתפים</Label>
                    <Input type="number" min="0" value={form.estimated_pax} onChange={e => set("estimated_pax", e.target.value)} disabled={optionLoading} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">צוות / מלווים</Label>
                    <Input type="number" min="0" value={form.staff_count} onChange={e => set("staff_count", e.target.value)} disabled={optionLoading} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">חניכים / תלמידים (מחושב)</Label>
                    <div className="h-9 flex items-center px-3 rounded-md border bg-primary/5 text-sm font-semibold text-primary">{participantCount}</div>
                  </div>
                </div>
                {staffExceedsTotal && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    ⚠️ מספר הצוות ({staffCount}) גדול מסה״כ המשתתפים ({estimatedPax})
                  </div>
                )}
                {datesReversed && (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                    ⚠️ תאריך עזיבה ({form.departure_date}) קודם לתאריך הגעה ({form.arrival_date}) — נא לתקן
                  </div>
                )}
              </SectionCard>

              {optionLoading && <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">טוען את אפשרויות ההצעה — העריכה תיפתח מיד כשהטעינה תושלם.</div>}
              <fieldset disabled={optionLoading || Boolean(optionLoadError)} className="contents">
              {multiOptionFeatureEnabled && (
                <QuoteOptionTabs
                  active={activeOptionKey}
                  hasB={hasOptionB}
                  totals={{ A: activeOptionKey === "A" ? total_price : repricedOptionDrafts.A?.total_price, B: activeOptionKey === "B" ? total_price : repricedOptionDrafts.B?.total_price }}
                  onSelect={switchOption}
                  onAdd={addOptionB}
                  onDelete={deleteOptionB}
                  busy={optionBusy}
                  loading={optionLoading}
                  error={optionLoadError}
                  />
              )}

              {/* ── NEW CATALOG PACKAGES ── */}
              <SectionCard icon={Package} title="חבילות ומוצרים" defaultOpen={true}>
                <PackageLinesSection
                  packageLines={packageLines}
                  setPackageLines={setPackageLines}
                  addonLines={newAddonLines}
                  setAddonLines={setNewAddonLines}
                  defaultPax={catalogDefaultPax}
                  quoteType={quoteType}
                  nights={quoteType === "day_use" ? 1 : nights}
                />
              </SectionCard>

              {/* ── LEGACY sections — only show if they have existing saved data ── */}
              {studentLodging.length > 0 && (
                <SectionCard icon={CalendarDays} title="לינה — תלמידים (ישן)"
                  subtitle={suggestedRateType === "weekend_lodging" ? "סוף שבוע" : "אמצע שבוע"}
                  defaultOpen={true}>
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-2">
                    שורות מהצעה ישנה — ניתן לערוך או למחוק
                  </div>
                  <StudentLodgingSection lines={studentLodging} setLines={setStudentLodging}
                    suggestedRateType={suggestedRateType} groupType={groupType}
                    defaultPax={participantCount} defaultNights={nights} />
                </SectionCard>
              )}
              {adultLodging.length > 0 && (
                <SectionCard icon={Users} title="לינה — מבוגרים (ישן)" defaultOpen={true}>
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-2">
                    שורות מהצעה ישנה — ניתן לערוך או למחוק
                  </div>
                  <AdultLodgingSection lines={adultLodging} setLines={setAdultLodging} defaultNights={nights} adultsCount={staffCount} />
                </SectionCard>
              )}
              {workshops.length > 0 && (
                <SectionCard icon={BookOpen} title="סדנאות (ישן)" defaultOpen={true}>
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-2">
                    שורות מהצעה ישנה — ניתן לערוך או למחוק
                  </div>
                  <WorkshopSection lines={workshops} setLines={setWorkshops} />
                </SectionCard>
              )}
              {lectures.length > 0 && (
                <SectionCard icon={Mic2} title="הרצאות (ישן)" defaultOpen={true}>
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-2">
                    שורות מהצעה ישנה — ניתן לערוך או למחוק
                  </div>
                  <LectureSection lines={lectures} setLines={setLectures} />
                </SectionCard>
              )}

              {/* Coffee — show only if enabled or legacy has data */}
              {(coffeeEnabled || (isEdit && quote?.coffee_corner_pax > 0)) && (
                <SectionCard icon={Coffee} title="פינת קפה" subtitle={`₪${COFFEE_CORNER_RATE} לאיש צוות`} defaultOpen={coffeeEnabled}>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={coffeeEnabled} onChange={e => { setCoffeeEnabled(e.target.checked); setCoffeeCornerPax(e.target.checked ? staffCount : 0); }} className="w-4 h-4 accent-primary" />
                    <span className="text-sm">כלול פינת קפה</span>
                  </label>
                  {coffeeEnabled && staffCount > 0 && (
                    <div className="text-sm text-slate-500 mt-1">{staffCount} אנשי צוות × ₪{COFFEE_CORNER_RATE} = <span className="font-semibold text-slate-700">₪{coffeeTotal.toLocaleString()}</span></div>
                  )}
                  {coffeeEnabled && staffCount === 0 && <p className="text-xs text-amber-600">הזן מספר אנשי צוות לחישוב</p>}
                </SectionCard>
              )}

              {/* ── פריסה ── */}
              <div className={`${CARD} px-5 py-4`}>
                <div className={SEC_TITLE}><Tag className="w-4 h-4 text-primary" />פריסה</div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={prisaEnabled} onChange={e => setPrisaEnabled(e.target.checked)} className="w-4 h-4 accent-primary" />
                  <span className="text-sm">פריסה — ₪2.5 למשתתף</span>
                </label>
                {prisaEnabled && (
                  <div className="text-sm text-slate-500 mt-1">
                    {estimatedPax > 0
                      ? <>{estimatedPax} משתתפים × ₪2.5 = <span className="font-semibold text-slate-700">₪{prisaTotal.toLocaleString("he-IL")}</span></>
                      : <span className="text-amber-600 text-xs">הזן סה״כ משתתפים לחישוב</span>
                    }
                  </div>
                )}
              </div>

              {addons.length > 0 && (
                <SectionCard icon={Tag} title="תוספות חופשיות (ישן)" defaultOpen={true}>
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-2">
                    שורות מהצעה ישנה — ניתן לערוך או למחוק
                  </div>
                  <AddonSection lines={addons} setLines={setAddons} />
                </SectionCard>
              )}

              <SectionCard icon={SlidersHorizontal} title="התאמות / תוספות" defaultOpen={adjustments.length > 0}>
                <AdjustmentsSection lines={adjustments} setLines={setAdjustments} defaultQty={catalogDefaultPax} />
              </SectionCard>

              {/* Discount + payment terms */}
              <div className={`${CARD} px-5 py-4`}>
                <div className={SEC_TITLE}><Tag className="w-4 h-4 text-primary" />הנחה ותנאי תשלום</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">הנחה (%)</Label>
                    <Input type="number" min="0" max="100" value={form.discount_percent} onChange={e => set("discount_percent", e.target.value)} />
                    {discountAmount > 0 && <div className="text-xs text-red-500">−{fmtMoney(discountAmount)}</div>}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">תנאי תשלום</Label>
                    <Input value={form.payment_terms} onChange={e => set("payment_terms", e.target.value)} />
                  </div>
                </div>
                <label className="mt-3 flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={form.requires_advance_payment} onChange={e => set("requires_advance_payment", e.target.checked)} className="w-4 h-4 accent-primary" />
                  <span className="text-sm">דרישת מקדמה של 30%</span>
                </label>
              </div>

              {multiOptionFeatureEnabled && hasOptionB && <div className={`${CARD} px-5 py-4`}><Label className="text-xs text-slate-500 mb-1 block">הערות לאפשרות {activeOptionKey === "A" ? "א׳" : "ב׳"}</Label><Textarea rows={2} value={optionNotes} onChange={e => setOptionNotes(e.target.value)} className="text-sm" /></div>}
              </fieldset>

              {/* Client-visible shared notes */}
              <div className={`${CARD} px-5 py-4`}>
                <Label className="text-xs text-slate-500 mb-1 block">הערות ללקוח</Label>
                <Textarea rows={2} value={form.client_notes} onChange={e => set("client_notes", e.target.value)} className="text-sm" placeholder="הערות שיופיעו בהצעת המחיר ללקוח" />
              </div>

              {/* Internal notes */}
              <div className={`${CARD} px-5 py-4`}>
                <Label className="text-xs text-slate-500 mb-1 block">הערות פנימיות (לא מופיע ב-PDF)</Label>
                <Textarea rows={2} value={form.internal_notes} onChange={e => set("internal_notes", e.target.value)} className="text-sm" />
              </div>

            </form>
          </div>

          {/* ── Sidebar — right on desktop, bottom section on mobile ── */}
          <div className="w-full sm:w-72 sm:flex-shrink-0 bg-slate-50 sm:border-r border-t sm:border-t-0 border-slate-200 sm:overflow-y-auto px-4 py-5 space-y-4">

            {multiOptionFeatureEnabled && <QuoteOptionPreviewSelector mode={previewMode} hasB={hasOptionB} totals={{ A: activeOptionKey === "A" ? total_price : repricedOptionDrafts.A?.total_price, B: activeOptionKey === "B" ? total_price : repricedOptionDrafts.B?.total_price }} onChange={key => key === "COMBINED" ? setPreviewMode(key) : switchOption(key)} />}

            <CalendarCard arrival={form.arrival_date} departure={form.departure_date} nights={nights} isDayUse={quoteType === "day_use"} />

            <CapacityWarningBanner availabilityResult={availabilityResult} loading={checkingAvailability} />

            <SummaryCard
              groupName={groupNameDisplay}
              activityType={STUDENT_LODGING_RATES[suggestedRateType]?.label}
              totalPax={estimatedPax}
              staffCount={staffCount}
              participantCount={participantCount}
              workshops={workshops}
              lectures={lectures}
              coffeeEnabled={coffeeEnabled}
            />

            <PricingCard
              subtotal={subtotal}
              discountAmount={discountAmount}
              discountPct={form.discount_percent}
              totalPrice={total_price}
              advance={advance}
              balance={balance}
              requiresAdvancePayment={form.requires_advance_payment}
            />

            {/* Breakdown mini */}
            {subtotal > 0 && (
              <div className={`${CARD} px-4 py-3`}>
                <div className="text-xs font-semibold text-slate-500 mb-2">פירוט</div>
                <div className="space-y-1 text-xs text-slate-500">
                  {packageLinesTotal    > 0 && <div className="flex justify-between"><span>חבילות</span><span className="font-medium text-slate-700">{fmtMoney(packageLinesTotal)}</span></div>}
                  {newAddonLinesTotal  > 0 && <div className="flex justify-between"><span>תוספות קטלוג</span><span className="font-medium text-slate-700">{fmtMoney(newAddonLinesTotal)}</span></div>}
                  {studentLodgingTotal > 0 && <div className="flex justify-between"><span>לינה תלמידים</span><span className="font-medium text-slate-700">{fmtMoney(studentLodgingTotal)}</span></div>}
                  {adultLodgingTotal   > 0 && <div className="flex justify-between"><span>לינה מבוגרים</span><span className="font-medium text-slate-700">{fmtMoney(adultLodgingTotal)}</span></div>}
                  {workshopTotal       > 0 && <div className="flex justify-between"><span>סדנאות</span><span className="font-medium text-slate-700">{fmtMoney(workshopTotal)}</span></div>}
                  {lectureTotal        > 0 && <div className="flex justify-between"><span>הרצאות</span><span className="font-medium text-slate-700">{fmtMoney(lectureTotal)}</span></div>}
                  {coffeeTotal         > 0 && <div className="flex justify-between"><span>פינת קפה</span><span className="font-medium text-slate-700">{fmtMoney(coffeeTotal)}</span></div>}
                  {(addonTotal + adjustmentTotal) !== 0 && <div className="flex justify-between"><span>התאמות / תוספות</span><span className="font-medium text-slate-700">{fmtMoney(addonTotal + adjustmentTotal)}</span></div>}
                  {prisaTotal     > 0 && <div className="flex justify-between"><span>פריסה</span><span className="font-medium text-slate-700">{fmtMoney(prisaTotal)}</span></div>}
                </div>
              </div>
            )}

            {/* Save button */}
            <Button
              type="submit"
              form="quote-form"
              disabled={saving || optionLoading || Boolean(optionLoadError)}
              className="w-full h-11 text-sm font-semibold"
            >
              {saving ? "שומר..." : isEdit ? "שמור הצעת מחיר" : "צור הצעת מחיר"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} className="w-full text-sm">
              ביטול
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}