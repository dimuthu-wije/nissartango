import type { CollectionEntry } from 'astro:content';

export type Occurrence = { entry: CollectionEntry<'events'>; date: Date };

const HORIZON_MONTHS = 6;
const MAX_OCCURRENCES = 200;

export function expand(entry: CollectionEntry<'events'>): Occurrence[] {
  const { date, recurrence, recurrenceEnd, exceptions } = entry.data;
  if (recurrence === 'none') return [{ entry, date }];

  const horizon = new Date();
  horizon.setMonth(horizon.getMonth() + HORIZON_MONTHS);
  const limit = recurrenceEnd && recurrenceEnd < horizon ? recurrenceEnd : horizon;

  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const skip = new Set(exceptions.map(key));

  const out: Occurrence[] = [];
  const cursor = new Date(date);

  while (cursor <= limit && out.length < MAX_OCCURRENCES) {
    if (!skip.has(key(cursor))) out.push({ entry, date: new Date(cursor) });
    if (recurrence === 'weekly') cursor.setDate(cursor.getDate() + 7);
    else if (recurrence === 'biweekly') cursor.setDate(cursor.getDate() + 14);
    else cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

export function upcoming(entries: CollectionEntry<'events'>[]): Occurrence[] {
  const now = new Date();
  return entries
    .flatMap(expand)
    .filter((o) => o.date >= now)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Next occurrence at or after now, falling back to the entry's own date. */
export function nextDate(entry: CollectionEntry<'events'>): Date {
  const now = new Date();
  return expand(entry).find((o) => o.date >= now)?.date ?? entry.data.date;
}

export const RECURRENCE_LABELS: Record<string, string> = {
  weekly: 'Chaque semaine',
  biweekly: 'Toutes les deux semaines',
  monthly: 'Chaque mois',
};
