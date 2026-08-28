/**
 * Time-zone arithmetic that survives DST, with no dependencies.
 *
 * The rule this file exists to enforce: recurrence is a WALL-CLOCK fact.
 * A 21:00 Tuesday practica is 21:00 every Tuesday, in Nice, forever. Adding
 * 7 * 24h to an instant does not do that -- across the late-October changeover
 * it silently becomes 20:00, and across late March, 22:00.
 *
 * So every step is taken on the calendar, in the event's own zone, and only
 * converted back to an absolute instant at the end.
 *
 * Deliberately no `TZ=Europe/Paris` anywhere. The zone comes from the event's
 * `timezone` column and is passed explicitly, so this behaves identically on
 * a laptop in Nice and a Cloudflare builder running UTC. The tests run under
 * TZ=UTC on purpose.
 */

/** @typedef {{year:number, month:number, day:number, hour:number, minute:number, second:number}} Parts */

const formatters = new Map();

function formatterFor(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/**
 * The wall-clock reading in `timeZone` at a given instant.
 * @param {Date} instant
 * @param {string} timeZone
 * @returns {Parts}
 */
export function partsInZone(instant, timeZone) {
  const out = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(instant)) {
    if (type !== 'literal') out[type] = Number(value);
  }
  return {
    year: out.year, month: out.month, day: out.day,
    hour: out.hour, minute: out.minute, second: out.second,
  };
}

/**
 * How far ahead of UTC `timeZone` is at that instant, in milliseconds.
 * +2h in Paris summer, +1h in winter.
 * @param {Date} instant @param {string} timeZone
 */
export function offsetMs(instant, timeZone) {
  const p = partsInZone(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - instant.getTime();
}

/**
 * The instant at which the clock in `timeZone` reads these parts.
 *
 * Two passes, because the offset depends on the answer: guess using the
 * offset at the naive instant, then re-read the offset at the candidate and
 * correct if the guess landed on the other side of a changeover. Ambiguous
 * wall-clock times (the hour that happens twice in October) resolve to the
 * first, which is what a reader expects from "21:00".
 *
 * @param {Parts} parts @param {string} timeZone @returns {Date}
 */
export function zonedToInstant(parts, timeZone) {
  const naive = Date.UTC(
    parts.year, parts.month - 1, parts.day,
    parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0,
  );
  const firstGuess = naive - offsetMs(new Date(naive), timeZone);
  const corrected = naive - offsetMs(new Date(firstGuess), timeZone);
  return new Date(corrected);
}

/**
 * THE occurrence key. Must match public.occurrence_local_date() in the
 * database exactly -- it is what event_exceptions rows are written against.
 * A 00:30 milonga is stored as 22:30 UTC the previous day; keying off the
 * UTC date would make every exception on such a series match nothing, and a
 * cancelled date would stay quietly on the agenda for half the year.
 *
 * @param {Date} instant @param {string} timeZone @returns {string} YYYY-MM-DD
 */
export function localDateKey(instant, timeZone) {
  const p = partsInZone(instant, timeZone);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * Move a wall-clock reading by whole days or months, on the calendar.
 * Date.UTC normalises overflow (32 January -> 1 February) for us.
 * @param {Parts} parts @param {{days?:number, months?:number}} step
 * @returns {Parts}
 */
export function shiftParts(parts, { days = 0, months = 0 }) {
  const d = new Date(Date.UTC(
    parts.year, parts.month - 1 + months, parts.day + days,
    parts.hour, parts.minute, parts.second,
  ));
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(),
  };
}
