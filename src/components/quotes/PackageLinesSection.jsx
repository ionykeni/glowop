/**
 * PackageLinesSection — New quote catalog UI (חבילה 1-6 + add-ons)
 * Saved into quote.package_lines (JSON array)
 */
import { useState } from "react";
import { Trash2, Plus, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PACKAGE_CATALOG,
  MEAL_ADDON_CATALOG,
  OPERATOR_ADDON_CATALOG,
  CONTENT_ADDON_CATALOG,
  calcPackageLine,
  calcAddonLine,
  resolvePackageUnitPrice,
} from "@/lib/quoteCatalog";
import ProductInfoPopover from "./ProductInfoPopover";
import { isPaxLinkedAddon } from "@/lib/quoteQuantityMode";

const fmtMoney = (n) => `₪${Math.round(Number(n) || 0).toLocaleString("he-IL")}`;

function FieldLabel({ children }) {
  return <div className="text-[11px] text-slate-400 font-medium mb-0.5">{children}</div>;
}

function RowTotal({ amount }) {
  return <div className="text-xs font-semibold text-primary whitespace-nowrap">{fmtMoney(amount)}</div>;
}

// ── Single package line row ───────────────────────────────────────────────────
function PackageLineRow({ line, index, onUpdate, onRemove, defaultPax, nights }) {
  const pkg = PACKAGE_CATALOG.find(p => p.id === line.package_id);
  if (!pkg) return null;

  const isFlexible = pkg.pricing_type === "flexible";
  const isThreshold = pkg.pricing_type === "per_person_threshold";
  const hasOptions = pkg.pricing_options && pkg.pricing_options.length > 0;
  const pax = Number(line.quantity || defaultPax || 0);

  // Auto-resolve price when option or quantity changes
  const handleOptionChange = (optionId) => {
    // The dropdown's hidden form select emits "" when a reused row receives another package's option
    // (A/B switch, row removal). No real choice is empty — ignore it so selection and price are kept.
    if (!optionId) return;
    const newRate = resolvePackageUnitPrice(pkg.id, optionId, pax);
    onUpdate(index, { ...line, option_id: optionId, unit_price: newRate });
  };

  const handleQtyChange = (val) => {
    const newPax = Number(val) || 0;
    if (!line.price_overridden && !isFlexible) {
      const newRate = resolvePackageUnitPrice(pkg.id, line.option_id, newPax);
      onUpdate(index, { ...line, quantity: newPax, unit_price: newRate, quantity_mode: "MANUAL" });
    } else {
      onUpdate(index, { ...line, quantity: newPax, quantity_mode: "MANUAL" });
    }
  };

  const handlePriceChange = (val) => {
    onUpdate(index, { ...line, unit_price: Number(val) || 0, price_overridden: true });
  };

  const lineTotal = calcPackageLine(line, nights);
  const shirleyAddonTotal = (pkg.addon_shirley && line.shirley_addon) ? pkg.addon_shirley.fixed_price : 0;

  return (
    <div className="bg-slate-50 rounded-xl p-2.5 space-y-2">
      {/* Row 1: name + info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-700">{pkg.name}</span>
          <ProductInfoPopover pkg={pkg} />
        </div>
        <button type="button" onClick={() => onRemove(index)} className="text-slate-300 hover:text-red-400">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="text-[11px] text-slate-400">{pkg.description}{pkg.billing_period === "per_night" && nights > 0 ? ` · ${nights} לילות` : ""}</p>

      {/* Row 2: controls */}
      <div className="grid grid-cols-12 gap-2 items-end">
        {/* Option selector (if applicable) */}
        {!isFlexible && hasOptions && (
          <div className={`${isThreshold ? "col-span-5" : "col-span-5"} space-y-0.5`}>
            <FieldLabel>אפשרות מחיר</FieldLabel>
            <Select value={line.option_id || ""} onValueChange={handleOptionChange}>
              <SelectTrigger className="h-8 text-xs bg-white">
                <SelectValue placeholder="בחר..." />
              </SelectTrigger>
              <SelectContent>
                {pkg.pricing_options.map(o => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label} — ₪{o.rate}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Quantity */}
        <div className={`${!isFlexible && hasOptions ? "col-span-2" : "col-span-4"} space-y-0.5`}>
          <FieldLabel>כמות</FieldLabel>
          <Input
            className="h-8 text-xs bg-white"
            type="number"
            min="0"
            value={line.quantity ?? ""}
            onChange={e => handleQtyChange(e.target.value)}
          />
        </div>

        {/* Unit price (always editable) */}
        <div className="col-span-3 space-y-0.5">
          <FieldLabel>מחיר יחידה {line.price_overridden ? "✎" : ""}</FieldLabel>
          <Input
            className="h-8 text-xs bg-white"
            type="number"
            min="0"
            value={line.unit_price ?? ""}
            onChange={e => handlePriceChange(e.target.value)}
          />
        </div>

        {/* Total */}
        <div className="col-span-2 flex items-end justify-end pb-0.5">
          <RowTotal amount={lineTotal} />
        </div>
      </div>

      {/* חבילה 3: threshold note */}
      {isThreshold && (
        <div className="text-[10px] text-slate-400">
          {pax >= 25
            ? `${pax} משתתפים → ₪285 לאדם`
            : `${pax} משתתפים → ₪295 לאדם`}
        </div>
      )}

      {/* חבילה 3: Shirley add-on */}
      {pkg.addon_shirley && (
        <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-600">
          <input
            type="checkbox"
            checked={!!line.shirley_addon}
            onChange={e => onUpdate(index, { ...line, shirley_addon: e.target.checked })}
            className="w-4 h-4 accent-primary"
          />
          {pkg.addon_shirley.label} (+{fmtMoney(pkg.addon_shirley.fixed_price)})
        </label>
      )}

      {/* חבילה 3 shirley total add-on line */}
      {pkg.addon_shirley && line.shirley_addon && (
        <div className="text-[11px] text-slate-500 flex justify-between px-1">
          <span>{pkg.addon_shirley.label}</span>
          <span className="font-semibold">{fmtMoney(shirleyAddonTotal)}</span>
        </div>
      )}

      {/* Notes */}
      <div>
        <Input
          className="h-7 text-xs bg-white"
          placeholder="הערות לשורה (אופציונלי)"
          value={line.notes || ""}
          onChange={e => onUpdate(index, { ...line, notes: e.target.value })}
        />
      </div>
    </div>
  );
}

// ── Catalog layout per quote type ────────────────────────────────────────────
function getCatalogLayout(quoteType) {
  if (quoteType === "lodging") {
    return {
      primaryPackageIds: ["chavila_1", "chavila_4", "chavila_5"],
      extraPackageIds:   ["chavila_2", "chavila_3", "chavila_6"],
      addonGroups:       ["ארוחות", "תוכן"],
    };
  }
  if (quoteType === "day_use") {
    return {
      primaryPackageIds: ["chavila_2", "chavila_3", "chavila_6"],
      extraPackageIds:   ["chavila_1", "chavila_4", "chavila_5"],
      addonGroups:       ["תוכן", "ארוחות"],
    };
  }
  // custom — show all
  return {
    primaryPackageIds: ["chavila_1", "chavila_2", "chavila_3", "chavila_4", "chavila_5", "chavila_6"],
    extraPackageIds:   [],
    addonGroups:       ["ארוחות", "תוכן"],
  };
}

const ALL_ADDON_BY_GROUP = {
  "ארוחות":               MEAL_ADDON_CATALOG,
  "כרמלים/ גלואו":        OPERATOR_ADDON_CATALOG.filter(o => o.id === "karmelim"),
  "סוכנים":              OPERATOR_ADDON_CATALOG.filter(o => o.id === "agad"),
  "תוכן":                 CONTENT_ADDON_CATALOG,
};

// ── Add package dropdown ──────────────────────────────────────────────────────
function AddPackageDropdown({ onAdd, quoteType }) {
  const [open, setOpen] = useState(false);
  const layout = getCatalogLayout(quoteType);
  const primary = PACKAGE_CATALOG.filter(p => layout.primaryPackageIds.includes(p.id));
  const extra   = PACKAGE_CATALOG.filter(p => layout.extraPackageIds.includes(p.id));

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs h-7 border-dashed"
        onClick={() => setOpen(o => !o)}
      >
        <Plus className="w-3 h-3" />
        הוסף חבילה
        <ChevronDown className="w-3 h-3" />
      </Button>
      {open && (
        <div className="absolute z-50 top-full mt-1 right-0 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[220px]" dir="rtl">
          {primary.map(pkg => (
            <button key={pkg.id} type="button"
              className="w-full text-right px-3 py-2 text-xs hover:bg-slate-50 text-slate-700"
              onClick={() => { onAdd(pkg); setOpen(false); }}>
              <div className="font-semibold">{pkg.name}</div>
              <div className="text-slate-400 text-[10px]">{pkg.description}</div>
            </button>
          ))}
          {extra.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wide border-t border-slate-100">
                אפשרויות נוספות
              </div>
              {extra.map(pkg => (
                <button key={pkg.id} type="button"
                  className="w-full text-right px-3 py-2 text-xs hover:bg-slate-50 text-slate-600"
                  onClick={() => { onAdd(pkg); setOpen(false); }}>
                  <div className="font-semibold">{pkg.name}</div>
                  <div className="text-slate-400 text-[10px]">{pkg.description}</div>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Addon line row ────────────────────────────────────────────────────────────
function AddonLineRow({ line, index, onUpdate, onRemove, defaultPax, nights }) {
  const allAddons = [...MEAL_ADDON_CATALOG, ...OPERATOR_ADDON_CATALOG, ...CONTENT_ADDON_CATALOG];
  const item = allAddons.find(a => a.id === line.addon_id);
  const isContent = CONTENT_ADDON_CATALOG.find(a => a.id === line.addon_id);
  const total = calcAddonLine(line, nights);
  const showMaxWarning = isContent?.max_pax && Number(defaultPax) > isContent.max_pax;

  return (
    <div className="bg-slate-50 rounded-xl p-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-700">{item?.label || line.addon_id}</span>
          {item?.group && (
            <span className="text-[10px] text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">{item.group}{item.billing_period === "per_night" && nights > 0 ? ` · ${nights} לילות` : ""}</span>
          )}
          {isContent && (
            <ProductInfoPopover pkg={{
              name: item?.label,
              target_audience: isContent?.max_pax ? `מקסימום ${isContent.max_pax} משתתפים` : null,
              pricing_note: `₪${isContent.fixed_price} ליחידה`,
              description: item?.group,
            }} />
          )}
        </div>
        <button type="button" onClick={() => onRemove(index)} className="text-slate-300 hover:text-red-400">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {showMaxWarning && (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          ⚠️ מספר המשתתפים גבוה מהמקסימום המומלץ לפריט תוכן זה ({isContent.max_pax}).
        </div>
      )}

      <div className="grid grid-cols-12 gap-2 items-end">
        <div className="col-span-3 space-y-0.5">
          <FieldLabel>{isContent ? "יחידות" : "כמות"}</FieldLabel>
          <Input
            className="h-8 text-xs bg-white"
            type="number"
            min="0"
            value={line.quantity ?? ""}
            onChange={e => onUpdate(index, {
              ...line,
              quantity: Number(e.target.value) || 0,
              ...(isPaxLinkedAddon(line) ? { quantity_mode: "MANUAL" } : {}),
            })}
          />
        </div>
        <div className="col-span-4 space-y-0.5">
          <FieldLabel>מחיר יחידה</FieldLabel>
          <Input
            className="h-8 text-xs bg-white"
            type="number"
            min="0"
            value={line.unit_price ?? (item?.rate ?? item?.fixed_price ?? "")}
            onChange={e => onUpdate(index, { ...line, unit_price: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="col-span-5 flex items-end justify-end pb-0.5">
          <RowTotal amount={total} />
        </div>
      </div>
    </div>
  );
}

// ── Add operator dropdown (כרמלים / אגד) ────────────────────────────────────
function AddOperatorDropdown({ onAdd }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button type="button" variant="outline" size="sm"
        className="gap-1.5 text-xs h-7 border-dashed"
        onClick={() => setOpen(o => !o)}>
        <Plus className="w-3 h-3" />
        הוסף כרמלים / סוכנים
        <ChevronDown className="w-3 h-3" />
      </Button>
      {open && (
        <div className="absolute z-50 top-full mt-1 right-0 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[220px]" dir="rtl">
          {OPERATOR_ADDON_CATALOG.map(item => (
            <button key={item.id} type="button"
              className="w-full text-right px-3 py-2 text-xs hover:bg-slate-50 text-slate-700"
              onClick={() => { onAdd(item); setOpen(false); }}>
              <div className="font-medium">{item.label}</div>
              <div className="text-slate-400 text-[10px]">₪{item.rate} לאדם</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Add addon dropdown (ארוחות + תוכן only) ──────────────────────────────────
function AddAddonDropdown({ onAdd, quoteType }) {
  const [open, setOpen] = useState(false);
  const layout = getCatalogLayout(quoteType);

  return (
    <div className="relative">
      <Button type="button" variant="outline" size="sm"
        className="gap-1.5 text-xs h-7 border-dashed"
        onClick={() => setOpen(o => !o)}>
        <Plus className="w-3 h-3" />
        הוסף תוספת / מוצר
        <ChevronDown className="w-3 h-3" />
      </Button>
      {open && (
        <div className="absolute z-50 top-full mt-1 right-0 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[240px]" dir="rtl">
          {layout.addonGroups.map(label => {
            const items = ALL_ADDON_BY_GROUP[label] || [];
            if (!items.length) return null;
            return (
              <div key={label}>
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wide border-t border-slate-100 first:border-t-0">
                  {label}
                </div>
                {items.map(item => (
                  <button key={item.id} type="button"
                    className="w-full text-right px-3 py-2 text-xs hover:bg-slate-50 text-slate-700"
                    onClick={() => { onAdd(item); setOpen(false); }}>
                    <div className="font-medium">{item.label}</div>
                    <div className="text-slate-400 text-[10px]">
                      {item.rate ? `₪${item.rate} לאדם` : item.fixed_price ? `₪${item.fixed_price} ליחידה` : ""}
                    </div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main exported component ───────────────────────────────────────────────────
export default function PackageLinesSection({
  packageLines,
  setPackageLines,
  addonLines,
  setAddonLines,
  defaultPax,
  quoteType = "custom",
  nights = 1,
}) {
  const handleAddPackage = (pkg) => {
    const defaultOptionId = pkg.pricing_options?.[0]?.id || null;
    // Always use estimated_pax (defaultPax) for per-person packages
    const qty = Number(defaultPax) || 0;
    const defaultRate = pkg.pricing_type === "per_person_threshold"
      ? resolvePackageUnitPrice(pkg.id, defaultOptionId, qty)
      : (pkg.pricing_options?.[0]?.rate ?? 0);

    setPackageLines(prev => [
      ...prev,
      {
        package_id: pkg.id,
        option_id: defaultOptionId,
        quantity: qty,
        unit_price: defaultRate,
        shirley_addon: false,
        price_overridden: false,
        quantity_mode: "AUTO",
        notes: "",
      },
    ]);
  };

  const handleAddAddon = (item) => {
    // fixed_per_unit (content items) → default qty 1
    // all per-person items (meals, operators) → default qty = estimated_pax
    const isFixedUnit = item.pricing_type === "fixed_per_unit";
    setAddonLines(prev => [
      ...prev,
      {
        addon_id: item.id,
        quantity: isFixedUnit ? 1 : Number(defaultPax) || 0,
        unit_price: item.rate ?? item.fixed_price ?? 0,
        ...(!isFixedUnit ? { quantity_mode: "AUTO" } : {}),
        notes: "",
      },
    ]);
  };

  const updatePackageLine = (index, updated) => {
    setPackageLines(prev => prev.map((l, i) => i === index ? updated : l));
  };

  const removePackageLine = (index) => {
    setPackageLines(prev => prev.filter((_, i) => i !== index));
  };

  const updateAddonLine = (index, updated) => {
    setAddonLines(prev => prev.map((l, i) => i === index ? updated : l));
  };

  const removeAddonLine = (index) => {
    setAddonLines(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      {/* Package lines */}
      {packageLines.map((line, i) => (
        <PackageLineRow
          key={i}
          line={line}
          index={i}
          onUpdate={updatePackageLine}
          onRemove={removePackageLine}
          defaultPax={defaultPax}
          nights={nights}
        />
      ))}

      {/* Addon lines — grouped visually: operator (כרמלים/אגד) separate from others */}
      {(() => {
        const operatorIds = new Set(["karmelim", "agad"]);
        const operatorLines = addonLines.filter(l => operatorIds.has(l.addon_id));
        const otherLines    = addonLines.filter(l => !operatorIds.has(l.addon_id));
        return (
          <>
            {operatorLines.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide px-1 pt-1 border-t border-slate-200">כרמלים / סוכנים</div>
                {operatorLines.map(line => {
                  const i = addonLines.indexOf(line);
                  return <AddonLineRow key={i} line={line} index={i} onUpdate={updateAddonLine} onRemove={removeAddonLine} defaultPax={defaultPax} nights={nights} />;
                })}
              </div>
            )}
            {otherLines.length > 0 && (
              <div className="space-y-2">
                {otherLines.length > 0 && operatorLines.length > 0 && (
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide px-1 pt-1 border-t border-slate-200">תוספות</div>
                )}
                {otherLines.map(line => {
                  const i = addonLines.indexOf(line);
                  return <AddonLineRow key={i} line={line} index={i} onUpdate={updateAddonLine} onRemove={removeAddonLine} defaultPax={defaultPax} nights={nights} />;
                })}
              </div>
            )}
          </>
        );
      })()}

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <AddPackageDropdown onAdd={handleAddPackage} quoteType={quoteType} />
        <AddOperatorDropdown onAdd={handleAddAddon} />
        <AddAddonDropdown onAdd={handleAddAddon} quoteType={quoteType} />
      </div>
    </div>
  );
}