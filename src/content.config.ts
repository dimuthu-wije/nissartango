import { defineCollection, z } from 'astro:content';
import type { Loader } from 'astro/loaders';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Collections are loaded from data/snapshot.json, which scripts/fetch-content.mjs
 * writes from Supabase before every build.
 *
 * Why the indirection instead of fetching here: one place talks to the
 * database, the snapshot that place produces IS the backup, and the build
 * itself is offline and reproducible. It also means `--from-snapshot` is not a
 * special code path — it is just skipping the fetch.
 */

const SNAPSHOT = path.resolve('./data/snapshot.json');

function snapshotLoader(
  key: 'events' | 'organizers' | 'exceptions',
  idOf: (row: any) => string,
  { renderBody = false } = {},
): Loader {
  return {
    name: `snapshot-${key}`,
    load: async ({ store, parseData, renderMarkdown, generateDigest, logger, watcher }) => {
      const snap = JSON.parse(await readFile(SNAPSHOT, 'utf8'));
      const rows = snap[key] ?? [];
      store.clear();

      for (const row of rows) {
        const id = idOf(row);
        // Astro's content layer owns `id` on an entry: it is the routing key,
        // and it overwrites whatever the source called id. The database's own
        // uuid therefore travels as db_id -- renamed here, once, rather than
        // in every page.
        const { id: dbId, ...rest } = row;
        const data = await parseData({ id, data: { ...rest, db_id: dbId } });
        const entry: Parameters<typeof store.set>[0] = {
          id, data, digest: generateDigest(row),
        };
        if (renderBody && row.body) entry.rendered = await renderMarkdown(row.body);
        store.set(entry);
      }

      logger.info(`${rows.length} ${key} (snapshot of ${snap.fetched_at})`);
      watcher?.add(SNAPSHOT);
    },
  };
}

const nullableString = z.string().nullable().optional();

// NOT z.string().uuid(). Zod enforces RFC 4122 version and variant bits;
// Postgres's uuid type does not, and neither does gen_random_uuid()'s
// contract as far as anything here is concerned. The seed fixtures use
// readable ids like 0a000000-0000-0000-0000-0000000000aa, which are perfectly
// valid uuids to the database and are rejected by zod -- a schema stricter
// than the database it mirrors fails the build on data the database accepted.
const uuid = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'not a uuid',
);

const organizers = defineCollection({
  loader: snapshotLoader('organizers', (r) => r.slug),
  // Note what is absent: email and phone. They are absent from the view too,
  // which is the actual boundary — this schema just documents it.
  schema: z.object({
    db_id: uuid,
    name: z.string(),
    slug: z.string(),
    website: nullableString,
    instagram: nullableString,
    facebook: nullableString,
    tiktok: nullableString,
    created_at: nullableString,
    updated_at: nullableString,
  }),
});

const events = defineCollection({
  loader: snapshotLoader('events', (r) => r.slug, { renderBody: true }),
  schema: z.object({
    db_id: uuid,
    slug: z.string(),
    title: z.string(),
    type: z.enum(['cours', 'practica', 'milonga', 'stage', 'demo', 'festival']),
    starts_at: z.string(),
    duration_minutes: z.number().nullable().optional(),
    timezone: z.string().default('Europe/Paris'),
    recurrence: z.enum(['none', 'weekly', 'biweekly', 'monthly']).default('none'),
    recurrence_end: nullableString,
    location_name: nullableString,
    location_address: nullableString,
    location_postal_code: nullableString,
    city: z.string().default('Nice'),
    organizer_id: uuid,
    teachers: z.array(z.string()).default([]),
    price_full: z.union([z.number(), z.string()]).nullable().optional(),
    price_member: z.union([z.number(), z.string()]).nullable().optional(),
    price_note: nullableString,
    signup_url: nullableString,
    image_path: nullableString,
    image_file: nullableString,
    body: nullableString,
    cancelled_at: nullableString,
    cancellation_note: nullableString,
    created_at: nullableString,
    updated_at: nullableString,
  }),
});

const exceptions = defineCollection({
  loader: snapshotLoader('exceptions', (r) => `${r.event_id}:${r.occurrence_date}`),
  schema: z.object({
    event_id: uuid,
    occurrence_date: z.string(),
    kind: z.enum(['cancelled', 'moved']),
    note: nullableString,
    moved_starts_at: nullableString,
  }),
});

export const collections = { events, organizers, exceptions };
