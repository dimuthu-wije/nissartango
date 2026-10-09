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

// A NOTE ON THAT CAP, because the archive makes it visible where the agenda
// did not. expand() counts from the series START, so a weekly event running
// longer than 200 occurrences -- about 3.8 years; biweekly 7.6; monthly 16 --
// stops generating before it reaches `now`. Every occurrence it returns is
// then in the past, the agenda shows nothing, and the event silently moves to
// the archive while still running.
//
// Not reachable with today's content: the oldest event here starts in August
// 2026. Left alone deliberately rather than fixed in passing -- the fix is to
// expand from a point near `now` instead of from the series start, which
// changes tested behaviour and deserves its own change. Measured 2026-09-26.

/** @typedef {{ id:string, slug:string, title:string, type:string, starts_at:string,
 *   duration_minutes:number|null, timezone:string, recurrence:string,
 *   recurrence_end:string|null, extra_dates:string[],
 *   cancelled_at:string|null, cancellation_note:string|null,
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
  if (!step) return explicitDates(event, first, tz, byDate);

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

/**
 * A non-recurring event: its own date, plus every day in `extra_dates`.
 *
 * This is how a workshop over several days is ONE event (20261001150000). The
 * array holds the days BESIDES `starts_at`, each taken at `starts_at`'s time of
 * day in the event's own zone — through zonedToInstant, so a workshop spanning
 * the last Sunday of October keeps its local hour instead of sliding an hour.
 *
 * NOT BOUNDED BY THE HORIZON, matching what a single date has always done: the
 * horizon exists to stop a recurrence generating forever, and an explicit list
 * is finite. A workshop eight months out is announced eight months out.
 *
 * SORTED AND DE-DUPLICATED HERE because the database cannot do either — a CHECK
 * may not contain the subquery that distinctness needs (0A000), and comparing a
 * date against `starts_at at time zone timezone` needs a STABLE expression a
 * CHECK will not take. So whatever is stored, what renders is in order and
 * each day appears once. The editor refuses both at the form, with a message;
 * this is what makes the refusal unnecessary for correctness.
 */
function explicitDates(event, first, tz, byDate) {
  const extra = Array.isArray(event.extra_dates) ? event.extra_dates : [];
  if (!extra.length) return [occurrence(event, first, tz, byDate)];

  const base = partsInZone(first, tz);
  const seen = new Set([localDateKey(first, tz)]);
  const starts = [first];

  for (const value of extra) {
    const key = String(value ?? '').slice(0, 10);
    // A malformed entry is skipped rather than thrown on: this runs at build
    // time over database rows, and one bad date must not take the site down.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || seen.has(key)) continue;
    seen.add(key);
    starts.push(zonedToInstant({
      ...datePartsFromIso(key),
      hour: base.hour, minute: base.minute, second: base.second,
    }, tz));
  }

  starts.sort((a, b) => a - b);
  return starts.map((start) => occurrence(event, start, tz, byDate));
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

/**
 * The LAST occurrence of an event — the date it finished.
 *
 * What the archive sorts and labels by, because "when was this?" about a
 * finished weekly series means the last night it ran, not the first. A single
 * date is its own last.
 *
 * Cancelled occurrences count: a series whose final Tuesday was called off
 * still ended that week, and saying otherwise would move it in the archive for
 * a reason a reader cannot see.
 *
 * Falls back to starts_at when expansion yields nothing, which happens only if
 * MAX_OCCURRENCES is reached before the series ends — see the note there.
 *
 * @param {EventRow} event @param {ExceptionRow[]} exceptions
 * @param {{ now?: Date }} [opts] @returns {Date}
 */
export function lastDate(event, exceptions = [], opts = {}) {
  const all = expand(event, exceptions, opts);
  return all.length ? all[all.length - 1].start : new Date(event.starts_at);
}

/**
 * Split every event into what is still to come and what is not.
 *
 * THE INVARIANT: the two sets are complementary. Every event lands in exactly
 * one of them, so no event can be unreachable and none can appear twice. That
 * is the whole reason this is one function rather than two filters in two
 * pages -- before 2026-09-26 the agenda filtered and nothing else did, and
 * four of five events on this site were in neither set.
 *
 * `archived` is defined as "produced no listed occurrence", never by comparing
 * dates itself. So it cannot drift from the agenda: whatever the agenda shows
 * is current, and everything else is archived, by construction.
 *
 * A wholly-cancelled series is archived even when its dates are still ahead.
 * It has nothing forthcoming, and it needs to be reachable -- somebody linked
 * to that milonga before it was called off.
 *
 * `ended` is when an event STOPPED BEING FORTHCOMING, which is what an archive
 * sorts by: the last night for a completed series, the moment of cancellation
 * for a cancelled one. `shown` is the date to print, which for a cancelled
 * series is when it was DUE to start rather than a night it never reached.
 *
 * @param {EventRow[]} events
 * @param {Map<string, ExceptionRow[]>} exceptionsByEvent
 * @param {{ now?: Date }} [opts]
 */
export function partition(events, exceptionsByEvent = new Map(), opts = {}) {
  const now = opts.now ?? new Date();

  const listed = upcoming(events, exceptionsByEvent, { now })
    .filter((o) => !o.event.cancelled_at);
  const current = new Set(listed.map((o) => o.event.id));

  const archived = events
    .filter((e) => !current.has(e.id))
    .map((e) => {
      const ex = exceptionsByEvent.get(e.id) ?? [];
      const last = lastDate(e, ex, { now });
      const cancelled = e.cancelled_at ? new Date(e.cancelled_at) : null;
      return {
        event: e,
        last,
        ended: cancelled ?? last,
        shown: cancelled ? new Date(e.starts_at) : last,
      };
    })
    .sort((a, b) => b.ended.getTime() - a.ended.getTime());

  return { listed, archived };
}

/**
 * The agenda, split into what is NEWS and what is FURNITURE.
 *
 * THE PROBLEM THIS SOLVES, measured on the live site 2026-10-02: one weekly
 * milonga occupied EIGHT consecutive rows, identical but for the date. At ~200
 * events a year with half a dozen weekly regulars that is several hundred
 * near-identical rows a reader scrolls past to reach the thing that is actually
 * unusual. A weekly practica is not news; it is furniture. A festival on
 * 14 November is news. One chronological stream serves neither.
 *
 * So a recurring event appears ONCE, under its rhythm, and the chronological
 * list holds one-off events plus the dates on which a regular does NOT behave
 * normally -- cancelled or moved.
 *
 * THAT LAST PART IS THE POINT, not a consolation. "Pas de milonga à la Casita
 * ce jeudi" is the single most useful line the agenda can carry about a regular
 * event, and today it is buried among seven identical rows that say the
 * opposite. Collapsing the regulars makes the exception the only time that
 * event appears in the stream, so it cannot be missed.
 *
 * TAKES THE OCCURRENCES partition() ALREADY PRODUCED rather than expanding
 * again. Two expansions of the same events could disagree about which dates
 * exist, and not disagreeing is the whole reason partition() exists.
 *
 * @param {Occurrence[]} occurrences  `listed`, from partition()
 * @returns {{stream: Occurrence[], regulars: {event: EventRow, next: Occurrence|null,
 *            occurrences: Occurrence[]}[]}}
 */
export function sections(occurrences = []) {
  const stream = [];
  const byEvent = new Map();

  for (const o of occurrences) {
    // STEP is the same table expand() generates from, so "is a series" means
    // exactly what it means there. A multi-day workshop is NOT one: its dates
    // are a finite list, few, and every one of them is news.
    //
    // "Each is worth a ROW" is what this used to say, and runs() below now
    // answers that half differently -- measured 2026-10-09, a three-day
    // festival filled three identical rows. Which dates are news and how many
    // rows they are owed turned out to be two questions; this function still
    // answers the first one the same way.
    if (!STEP[o.event.recurrence]) {
      stream.push(o);
      continue;
    }
    if (o.cancelled || o.moved) stream.push(o);

    const key = o.event.id ?? o.event.slug;
    const list = byEvent.get(key) ?? [];
    list.push(o);
    byEvent.set(key, list);
  }

  const regulars = [...byEvent.values()]
    .map((list) => ({
      event: list[0].event,
      // The next date it actually happens. A cancelled one is not a next date;
      // null means every upcoming occurrence is cancelled, which is rare and
      // must still render rather than throw.
      next: list.find((o) => !o.cancelled) ?? null,
      occurrences: list,
    }))
    // Ordered by when each next happens, so the section reads like a week
    // rather than like the order events were entered.
    .sort((a, b) => (a.next ?? a.occurrences[0]).start - (b.next ?? b.occurrences[0]).start);

  return { stream, regulars };
}

const weekdayFmt = new Map();
/**
 * How a regular event reads in the agenda's own voice: "chaque jeudi", not
 * "Chaque semaine".
 *
 * RECURRENCE_LABELS says what the DATABASE value means and is right on an event
 * page, beside a specific next date. In a list of regulars the weekday is the
 * useful half -- a reader is deciding which night to go out, not learning what
 * `weekly` means. The weekday comes from the occurrence, so a series that
 * starts on a Thursday says Thursday without anyone storing that twice.
 */
/**
 * How the stream's occurrences become ROWS.
 *
 * sections() answers which occurrences are news. This answers how many rows
 * they are owed, and those are different questions -- which is why this is a
 * second function and not a change to that one. Its test still asserts that a
 * multi-day workshop contributes each of its dates to the stream, because it
 * does; they simply arrive on one row.
 *
 * Measured 2026-10-09 against sixteen events: a three-day festival produced
 * three identical rows and a two-day workshop produced two. The only thing
 * that differed between them was the date, which is exactly what a range says
 * better.
 *
 * AN EXCEPTIONAL DATE OF A SERIES IS NEVER FOLDED. It is in the stream for one
 * reason -- "pas de milonga à la Casita ce jeudi" is the most useful line the
 * agenda carries about a regular -- and folding it into anything would undo
 * the thing sections() exists to do.
 */
export function runs(stream = []) {
  const rows = [];
  const index = new Map();

  for (const o of stream) {
    if (STEP[o.event.recurrence]) {
      rows.push({ event: o.event, occurrences: [o] });   // a series' odd date: alone
      continue;
    }
    const key = o.event.id ?? o.event.slug;
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, rows.length);
      rows.push({ event: o.event, occurrences: [o] });
    } else {
      rows[at].occurrences.push(o);
    }
  }

  return rows.map(({ event, occurrences }) => {
    const first = occurrences[0];
    const last = occurrences[occurrences.length - 1];
    return {
      event,
      occurrences,
      first,
      last,
      multi: occurrences.length > 1,
      // On a single-date row these are the occurrence's own flags. On a range
      // they mean "every date", which is the only reading under which striking
      // the whole row through is honest.
      cancelled: occurrences.every((x) => x.cancelled),
      moved: occurrences.length === 1 && Boolean(first.moved),
      // Dates within a range that do not behave: rendered as a note rather
      // than as rows of their own, so the range stays one line.
      offDates: occurrences.filter((x) => x.cancelled || x.moved),
    };
  });
}

export function rhythmLabel(recurrence, start, tz = 'Europe/Paris') {
  if (recurrence === 'monthly') return 'chaque mois';
  if (recurrence !== 'weekly' && recurrence !== 'biweekly') return null;

  let f = weekdayFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: tz });
    weekdayFmt.set(tz, f);
  }
  const day = f.format(start);
  return recurrence === 'weekly' ? `chaque ${day}` : `un ${day} sur deux`;
}

export const RECURRENCE_LABELS = {
  weekly: 'Chaque semaine',
  biweekly: 'Toutes les deux semaines',
  monthly: 'Chaque mois',
};
