import { resolveQuotePdfData, QuotePricingPage, QuoteTermsPage, QuoteContentCatalogPage } from "./QuotePdfTemplate";

export default function QuoteCombinedPdfTemplate({ optionA, optionB, group, logoUrl, footerUrl }) {
  const a = resolveQuotePdfData(optionA, group);
  const b = resolveQuotePdfData(optionB, group);
  return <div id="quote-pdf-root" style={{ background: "#fff", direction: "rtl" }}>
    <QuotePricingPage d={a} logoUrl={logoUrl} optionLabel="אפשרות א׳" showShared />
    <QuotePricingPage d={b} logoUrl={logoUrl} optionLabel="אפשרות ב׳" showShared={false} />
    <QuoteTermsPage logoUrl={logoUrl} quoteNumber={a.quoteNumber} footerUrl={footerUrl} requiresAdvancePayment={a.requiresAdvancePayment} />
    <QuoteContentCatalogPage logoUrl={logoUrl} quoteNumber={a.quoteNumber} />
  </div>;
}