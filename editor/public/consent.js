// What to send for a published contact detail, and its consent stamp.
//
// Split out of organizer.js for the same reason pkce.js and expiry.js were:
// organizer.js needs the DOM, localStorage and absolute-path imports, and none
// of that is necessary to answer this question. Node can test it, and this is
// the part of the organizer form most worth testing.
//
// THE RULE IT MIRRORS. organizers_contact_email_needs_consent and its phone
// twin are one-directional:
//
//     contact_email IS NULL OR contact_email_consent_at IS NOT NULL
//
// A value requires a stamp. A stamp without a value is permitted, and that
// asymmetry is deliberate -- it is the shape a WITHDRAWAL leaves behind.
//
// THREE CASES, and the middle one is the one that gets written wrong:
//
//   1. newly published   stamp now()
//   2. still published   keep the ORIGINAL stamp. Re-saving an unchanged row
//                        must not rewrite when the person agreed, because when
//                        they agreed is the entire content of the column. A
//                        naive `consent_at: now()` on every save looks correct
//                        on screen and quietly destroys the record.
//   3. withdrawn         value null, stamp KEPT. Nothing is published any more
//                        and the fact that consent was once given survives.
//                        Nulling the stamp too would erase the only evidence
//                        that the publication was ever agreed to.
//
// `now` is injected so a test is not a coin toss on the clock.

/**
 * @param {string|null|undefined} value   what is typed in the field
 * @param {boolean} ticked                the consent box
 * @param {string|null} wasConsentAt      the stamp the database already holds
 * @param {Date} [now]
 * @returns {{value: string|null, consentAt: string|null}}
 */
export function consentFor(value, ticked, wasConsentAt, now = new Date()) {
  const v = (value ?? '').trim() || null;
  const was = wasConsentAt ?? null;
  if (v && ticked) return { value: v, consentAt: was ?? now.toISOString() };
  // Not published: either nothing was typed, or the box is not ticked. Either
  // way the value does not go out, and the stamp is left exactly as it was.
  return { value: null, consentAt: was };
}
