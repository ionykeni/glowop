const normalizeText = value => String(value ?? "").trim().toLocaleLowerCase("he-IL");
const normalizePhone = value => String(value ?? "").replace(/\D/g, "");

export function matchesQuoteSearch(quote, rawTerm) {
  const term = normalizeText(rawTerm);
  if (!term) return true;

  const textFields = [
    quote.quote_number,
    quote.id,
    quote.group_name,
    quote.client_name,
    quote.contact_person,
    quote.client_email,
    quote.client_notes,
    quote.internal_notes,
  ];
  if (textFields.some(value => normalizeText(value).includes(term))) return true;

  const phoneTerm = normalizePhone(term);
  return phoneTerm.length >= 3 && normalizePhone(quote.client_phone).includes(phoneTerm);
}