/**
 * What a reader sees about money.
 *
 * A separate .js module and not part of content.ts for the same reason
 * occurrences.js and zone.js are: content.ts imports `astro:content`, which
 * Node cannot resolve, so anything living there cannot be unit-tested. This
 * has no imports at all.
 */

// French money: a COMMA for the decimal and a narrow no-break space before the
// symbol, both of which Intl gets right and `${v} €` did not -- it printed
// "12.50 €" on a French site. Whole euros keep no decimals, because "12,00 €"
// for a 12 € milonga is noise; anything with centimes gets both, because
// "12,5 €" is not how a price is written.
const EUR = new Intl.NumberFormat('fr-FR', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2,
});
const EUR_CENTIMES = new Intl.NumberFormat('fr-FR', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function priceSummary(e) {
  const n = (v) => {
    if (v == null) return null;
    const num = Number(v);
    if (Number.isNaN(num)) return null;
    return (Number.isInteger(num) ? EUR : EUR_CENTIMES).format(num);
  };
  const full = n(e.price_full);
  const member = n(e.price_member);
  const note = e.price_note?.trim() || null;

  // THE NOTE IS ALWAYS SHOWN, not only when there is no number.
  //
  // It used to be a fallback -- `if (!full && !member) return note` -- so an
  // organizer who entered 10 € AND "gratuit pour les étudiants" had the second
  // half silently dropped from the agenda. The detail page showed it; the
  // listing did not, which is the worse way round, because the listing is what
  // people read. Whatever they typed about price goes out.
  const numbers = [full, member && `${member} adhérent`].filter(Boolean).join(' / ');
  return [numbers || null, note].filter(Boolean).join(' — ') || null;
}
