import test from "node:test";
import assert from "node:assert/strict";
import { resolveQuoteDiscount, normalizeDiscountType } from "./quoteDiscount.js";
import { isOptionDraftSemanticallyEqual, extractQuoteOptionPayload } from "./quoteOptions.js";

test("percentage discount unchanged for legacy quotes (no discount_type)", () => {
  const d = resolveQuoteDiscount({ discount_percent: 10 }, 1000);
  assert.equal(d.type, "PERCENT");
  assert.equal(d.amount, 100);
  assert.equal(d.total, 900);
});

test("fixed discount subtracts exactly the entered NIS amount", () => {
  const d = resolveQuoteDiscount({ discount_type: "FIXED", discount_amount: 500 }, 2000);
  assert.equal(d.amount, 500);
  assert.equal(d.total, 1500);
});

test("only the selected discount type is applied", () => {
  const percentMode = resolveQuoteDiscount({ discount_type: "PERCENT", discount_percent: 10, discount_amount: 500 }, 1000);
  assert.deepEqual([percentMode.amount, percentMode.total], [100, 900]);
  const fixedMode = resolveQuoteDiscount({ discount_type: "FIXED", discount_percent: 10, discount_amount: 500 }, 1000);
  assert.deepEqual([fixedMode.amount, fixedMode.total], [500, 500]);
});

test("discount is capped at the subtotal and never negative", () => {
  const capped = resolveQuoteDiscount({ discount_type: "FIXED", discount_amount: 5000 }, 1200);
  assert.deepEqual([capped.amount, capped.total], [1200, 0]);
  const negative = resolveQuoteDiscount({ discount_type: "FIXED", discount_amount: -300 }, 1200);
  assert.deepEqual([negative.amount, negative.total], [0, 1200]);
  const overPercent = resolveQuoteDiscount({ discount_type: "PERCENT", discount_percent: 150 }, 1000);
  assert.deepEqual([overPercent.amount, overPercent.total], [1000, 0]);
});

test("unknown discount types fall back to percentage", () => {
  assert.equal(normalizeDiscountType("bogus"), "PERCENT");
  assert.equal(normalizeDiscountType(undefined), "PERCENT");
  assert.equal(normalizeDiscountType("FIXED"), "FIXED");
});

test("discount type and fixed amount round-trip through the option payload", () => {
  const payload = extractQuoteOptionPayload({ discount_type: "FIXED", discount_percent: 0, discount_amount: 500, total_price: 1500 });
  assert.equal(payload.discount_type, "FIXED");
  assert.equal(payload.discount_amount, 500);
});

test("fixed amount changes are detected as draft changes; percentage ones stay derived", () => {
  const base = { discount_type: "FIXED", discount_amount: 500, package_lines: "[]" };
  assert.equal(isOptionDraftSemanticallyEqual(base, { ...base, discount_amount: 300 }), false);
  const percentBase = { discount_type: "PERCENT", discount_percent: 10, discount_amount: 100, package_lines: "[]" };
  assert.equal(isOptionDraftSemanticallyEqual(percentBase, { ...percentBase, discount_amount: 999 }), true);
  assert.equal(isOptionDraftSemanticallyEqual(percentBase, { ...percentBase, discount_percent: 20 }), false);
});