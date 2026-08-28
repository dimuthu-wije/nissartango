/**
 * The shapes the pages actually want, assembled once.
 * Keeps getCollection() plumbing out of the templates.
 */
import { getCollection } from 'astro:content';
import { upcoming, expand } from './occurrences.js';

/** An Astro entry back into a plain database row: db_id becomes id again. */
export function toRow(entry: { data: Record<string, any> }) {
  const { db_id, ...rest } = entry.data;
  return { id: db_id, ...rest };
}

export async function loadAgenda(now = new Date()) {
  const [eventEntries, organizerEntries, exceptionEntries] = await Promise.all([
    getCollection('events'),
    getCollection('organizers'),
    getCollection('exceptions'),
  ]);

  // db_id -> id, so occurrences.js and the pages work with the row as the
  // database describes it. See the note in content.config.ts.
  const events = eventEntries.map((e) => toRow(e));
  const organizers = new Map(organizerEntries.map((o) => [o.data.db_id, toRow(o)]));

  const exceptionsByEvent = new Map<string, any[]>();
  for (const x of exceptionEntries) {
    const list = exceptionsByEvent.get(x.data.event_id) ?? [];
    list.push(x.data);
    exceptionsByEvent.set(x.data.event_id, list);
  }

  return {
    events,
    organizers,
    exceptionsByEvent,
    occurrences: upcoming(events, exceptionsByEvent, { now }),
  };
}

export { expand };

/** Social handles are stored as handles; links are built here, once. */
export function socialLinks(o: any) {
  if (!o) return [];
  return [
    o.website && { label: 'Site', href: o.website },
    o.instagram && { label: 'Instagram', href: `https://instagram.com/${o.instagram}` },
    o.facebook && { label: 'Facebook', href: `https://facebook.com/${o.facebook}` },
    o.tiktok && { label: 'TikTok', href: `https://tiktok.com/@${o.tiktok}` },
  ].filter(Boolean) as { label: string; href: string }[];
}

export const TYPE_LABELS: Record<string, string> = {
  cours: 'Cours', practica: 'Practica', milonga: 'Milonga',
  stage: 'Stage', demo: 'Démonstration', festival: 'Festival',
};

/** "12 € / 10 € adhérent", or the free-text note when there is no number. */
export function priceSummary(e: any): string | null {
  const n = (v: any) => (v == null ? null : `${Number(v).toFixed(2).replace(/\.00$/, '')} €`);
  const full = n(e.price_full);
  const member = n(e.price_member);
  if (!full && !member) return e.price_note ?? null;
  return [full, member && `${member} adhérent`].filter(Boolean).join(' / ');
}

/**
 * Formatting is always done in the EVENT's timezone, never the builder's.
 * Same reason the expansion is: the Cloudflare builder runs in UTC, and a
 * formatter without an explicit timeZone would print 19:00 for a 21:00
 * milonga -- correct on your laptop, wrong in production, half the year.
 */
const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(kind: 'day' | 'full' | 'time', tz: string) {
  const key = `${kind}:${tz}`;
  let f = cache.get(key);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions =
      kind === 'time'
        ? { hour: '2-digit', minute: '2-digit', timeZone: tz }
        : kind === 'day'
          ? { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }
          : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz };
    f = new Intl.DateTimeFormat('fr-FR', opts);
    cache.set(key, f);
  }
  return f;
}

export const fmtDay = (d: Date, tz = 'Europe/Paris') => fmt('day', tz).format(d);
export const fmtFull = (d: Date, tz = 'Europe/Paris') => fmt('full', tz).format(d);
export const fmtTime = (d: Date, tz = 'Europe/Paris') => fmt('time', tz).format(d);

/** ISO 8601 with the correct local offset, for schema.org startDate. */
export function isoWithOffset(d: Date, tz = 'Europe/Paris'): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d).reduce<Record<string, string>>((a, x) => {
    if (x.type !== 'literal') a[x.type] = x.value;
    return a;
  }, {});

  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offsetMin = Math.round((asUtc - d.getTime()) / 60000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}` +
         `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
