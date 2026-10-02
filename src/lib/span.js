// When an occurrence starts and when it ends, as a reader sees it.
//
// WHY THIS DID NOT EXIST. `duration_minutes` had exactly one use in the whole
// site: computing schema.org's `endDate`. It appeared nowhere in the rendered
// page, so a reader saw "à 18:00" and no end at all, while the markup told
// aggregators the event lasted an hour. A field that is public to machines and
// invisible to people is wrong only where nobody looks -- measured 2026-10-02 on
// the Mauro et Sol workshop, whose markup said three one-hour sessions for 120 €.
//
// PURE .js, like zone.js, price.js, payment.js and format.js, so Node can test
// it: content.ts imports astro:content and cannot be loaded outside a build.
// It formats with the SAME locale and options as content.ts's fmtTime, so a
// start time rendered through either reads identically.
//
// NO DURATION IS A REAL ANSWER, not a missing value. A multi-day workshop whose
// days differ in length cannot be described by one duration -- `duration_minutes`
// is a single column on the event -- so leaving it empty and putting the
// schedule in the description is the sanctioned shape. The label then says only
// when it starts, and no `endDate` is published at all, which beats publishing
// an end nobody chose.

import { localDateKey } from './zone.js';

const cache = new Map();
function hhmm(tz) {
  let f = cache.get(tz);
  if (!f) {
    // Same locale and options as fmtTime in content.ts. Do not "simplify" to
    // en-GB: the two must agree, because both render start times on one page.
    f = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz });
    cache.set(tz, f);
  }
  return f;
}

/**
 * The instant an occurrence ends, or null when the length is unknown.
 *
 * Zero and negative are treated as unknown rather than as an instant event:
 * the column's CHECK is `> 0 and <= 10080`, so neither can be stored, and a
 * span of "de 18:00 à 18:00" would be worse than no span.
 */
export function endOf(start, durationMinutes) {
  const minutes = Number(durationMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return new Date(start.getTime() + minutes * 60_000);
}

/**
 * @returns {{start: string, end: string|null, nextDay: boolean}}
 *
 * `nextDay` is computed by comparing LOCAL DATE KEYS, not by adding hours: a
 * milonga from 22:00 to 03:00 ends the following day, and "de 22:00 à 03:00"
 * with nothing else said reads as a five-hour event that went backwards.
 */
export function timeSpan(start, durationMinutes, tz = 'Europe/Paris') {
  const end = endOf(start, durationMinutes);
  return {
    start: hhmm(tz).format(start),
    end: end ? hhmm(tz).format(end) : null,
    nextDay: Boolean(end) && localDateKey(end, tz) !== localDateKey(start, tz),
  };
}

/**
 * The fragment that follows a date: "à 18:00", "de 18:00 à 21:00", or
 * "de 22:00 à 03:00 (le lendemain)".
 *
 * A FRAGMENT AND NOT A SENTENCE, because the caller has already written the
 * date: "vendredi 2 octobre 2026 de 18:00 à 21:00".
 */
export function spanLabel(start, durationMinutes, tz = 'Europe/Paris') {
  const s = timeSpan(start, durationMinutes, tz);
  if (!s.end) return `à ${s.start}`;
  return s.nextDay
    ? `de ${s.start} à ${s.end} (le lendemain)`
    : `de ${s.start} à ${s.end}`;
}
