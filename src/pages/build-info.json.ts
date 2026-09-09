import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { currentSnapshotPath } from '../lib/snapshot-path.mjs';

/**
 * What this deployment was built from. Read every ten minutes by the rebuild
 * poller, which compares `checksum` against public.content_checksum in the
 * database and rebuilds when they differ.
 *
 * It is deliberately tiny and deliberately boring: a digest, three counts and
 * a timestamp. No keys, no URLs, no row content. public/_headers marks it
 * no-store -- a cached copy of this file would make the poller compare the
 * database against a stale answer and rebuild every ten minutes forever.
 */
export const prerender = true;

export const GET: APIRoute = async () => {
  const snap = JSON.parse(await readFile(currentSnapshotPath(), 'utf8'));

  const body = {
    project_ref: snap.project_ref ?? null,
    checksum: snap.checksum ?? null,
    counts: snap.counts ?? {
      events: snap.events?.length ?? 0,
      organizers: snap.organizers?.length ?? 0,
      exceptions: snap.exceptions?.length ?? 0,
    },
    fetched_at: snap.fetched_at ?? null,
    built_at: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body, null, 2) + '\n', {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
};
