/**
 * Recurrence expansion over database rows.
 *
 * Ported from the markdown-era src/lib/events.ts, with two corrections:
 *   - the old version stepped with Date.setDate(), which is local-time
 *     arithmetic: correct on a laptop set to Europe/Paris, an hour out on a
 *     Cloudflare builder running UTC, and only for half the year;
 *   - occurrences are now keyed by their local date, so exceptions match.
 *
 * A series stays ONE event with one detail page. Expansion produces agenda
 * rows, never pages.
 */

import { partsInZone, zonedToInstant, localDateKey, shiftParts } from './zone.js';

const HORIZON_MONTHS = 6;
const MAX_OCCURRENCES = 200;

/** @typedef {{ id:string, slug:string, title:string, type:string, starts_at:string,
 *   duration_minutes:number|null, timezone:string, recurrence:string,
 *   recurrence_end:string|null, cancelled_at:string|null, cancellation_note:string|null,
 *   [k:string]: any }} EventRow */
/** @typedef {{ event_id:string, occurrence_date:string, kind:'cancelled'|'moved',
 *   note:string|null, moved_starts_at:string|null }} ExceptionRow */
/** @typedef {{ event:EventRow, start:Date, dateKey:string, cancelled:boolean,
 *   moved:boolean, note:string|null }} Occurrence */

const STEP = {
  weekly: { days: 7 },
  biweekly: { days: 14 },
  monthly: { months: 1 },
};

/**
 * Every occurrence of one event inside the horizon, in order.
 * Cancelled ones are RETURNED, flagged — "pas de practica le 15 août" is more
 * use to a reader than a week that silently isn't there. The caller decides
 * whether to render them.
 *
 * @param {EventRow} event
 * @param {ExceptionRow[]} exceptions
 * @param {{ now?: Date, horizonMonths?: number }} [opts]
 * @returns {Occurrence[]}
 */
export function expand(event, exceptions = [], opts = {}) {
  const now = opts.now ?? new Date();
  const horizonMonths = opts.horizonMonths ?? HORIZON_MONTHS;
  const tz = event.timezone || 'Europe/Paris';
  const first = new Date(event.starts_at);

  const byDate = new Map(exceptions.map((x) => [x.occurrence_date, x]));

  const horizon = new Date(now);
  horizon.setUTCMonth(horizon.getUTCMonth() + horizonMonths);

  // recurrence_end is a DATE in the event's zone: include the whole of that day.
  const endLimit = event.recurrence_end
    ? zonedToInstant(
        { ...datePartsFromIso(event.recurrence_end), hour: 23, minute: 59, second: 59 }, tz)
    : null;
  const limit = endLimit && endLimit < horizon ? endLimit : horizon;

  const step = STEP[event.recurrence];
  if (!step) return [occurrence(event, first, tz, byDate)];

  const base = partsInZone(first, tz);
  const out = [];

  for (let n = 0; out.length < MAX_OCCURRENCES; n++) {
    const parts = shiftParts(base, {
      days: (step.days ?? 0) * n,
      months: (step.months ?? 0) * n,
    });

    // A monthly series that started on the 31st has no occurrence in a 30-day
    // month. Date.UTC would roll it into the next month, which is wrong: skip.
    if (step.months && parts.day !== base.day) continue;

    const start = zonedToInstant(parts, tz);
    if (start > limit) break;
    out.push(occurrence(event, start, tz, byDate));

    if (n > MAX_OCCURRENCES * 2) break; // paranoia against a bad step
  }
  return out;
}

function datePartsFromIso(isoDate) {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number);
  return { year, month, day };
}

/** @returns {Occurrence} */
function occurrence(event, start, tz, byDate) {
  const dateKey = localDateKey(start, tz);
  const x = byDate.get(dateKey);

  if (x && x.kind === 'moved' && x.moved_starts_at) {
    const movedStart = new Date(x.moved_starts_at);
    return {
      event, start: movedStart, dateKey: localDateKey(movedStart, tz),
      cancelled: false, moved: true, note: x.note ?? null,
      // The date this occurrence WOULD have fallen on. schema.org's
      // previousStartDate wants it, and it is the only place it still exists.
      previousStart: start,
    };
  }
  return {
    event, start, dateKey,
    cancelled: Boolean(x && x.kind === 'cancelled'),
    moved: false,
    note: x?.note ?? null,
  };
}

/**
 * The agenda: every future occurrence of every event, in time order.
 * An event with cancelled_at set is off entirely — it keeps its page, and
 * the page says Annulé, but it does not occupy a slot in the listing.
 *
 * @param {EventRow[]} events
 * @param {Map<string, ExceptionRow[]>} exceptionsByEvent
 * @param {{ now?: Date, includeCancelled?: boolean }} [opts]
 * @returns {Occurrence[]}
 */
export function upcoming(events, exceptionsByEvent = new Map(), opts = {}) {
  const now = opts.now ?? new Date();
  const includeCancelled = opts.includeCancelled ?? true;

  return events
    .flatMap((e) => expand(e, exceptionsByEvent.get(e.id) ?? [], { now }))
    .filter((o) => o.start >= now)
    .filter((o) => includeCancelled || (!o.cancelled && !o.event.cancelled_at))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Next occurrence at or after `now`, falling back to the series start.
 * Skips cancelled dates: "prochaine date" must not name one that is off.
 *
 * @param {EventRow} event @param {ExceptionRow[]} exceptions
 * @param {{ now?: Date }} [opts] @returns {Date}
 */
export function nextDate(event, exceptions = [], opts = {}) {
  const now = opts.now ?? new Date();
  const found = expand(event, exceptions, { now })
    .find((o) => o.start >= now && !o.cancelled);
  return found ? found.start : new Date(event.starts_at);
}

export const RECURRENCE_LABELS = {
  weekly: 'Chaque semaine',
  biweekly: 'Toutes les deux semaines',
  monthly: 'Chaque mois',
};
