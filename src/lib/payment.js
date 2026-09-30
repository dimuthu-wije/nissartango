/**
 * Payment methods, for the page.
 *
 * A separate .js module, like price.js and occurrences.js: content.ts imports
 * `astro:content`, which Node cannot resolve, so anything living there cannot
 * be unit-tested.
 */

/**
 * Payment methods, slug -> what a reader sees.
 *
 * The database stores ASCII slugs and constrains them with
 * events_payment_methods_known; the accents live here. A slug with no label
 * falls back to itself rather than vanishing, so a value added to the
 * constraint and not to this map still shows something true.
 */
export const PAYMENT_LABELS = {
  especes: 'espèces',
  cb: 'carte bancaire',
  cheque: 'chèque',
  virement: 'virement',
};

/** "espèces, carte bancaire" — or null when the organizer did not say. */
export function paymentSummary(e) {
  const list = (e?.payment_methods ?? [])
    .map((m) => PAYMENT_LABELS[m] ?? m)
    .filter(Boolean);
  return list.length ? list.join(', ') : null;
}
