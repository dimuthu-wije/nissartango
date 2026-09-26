import type { APIRoute } from 'astro';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { currentSnapshotPath } from '../lib/snapshot-path.mjs';

/**
 * Which commit produced this deployment.
 *
 * Production builds fire through a deploy hook, and Cloudflare's deployment
 * record for a hook-triggered build carries an EMPTY commit_hash -- so until
 * now nothing anywhere said which code was live. The dashboard cannot answer
 * it and neither could the site.
 *
 * `git rev-parse HEAD` is asked first because it describes the tree actually
 * being built. CF_PAGES_COMMIT_SHA is the fallback and is empty on exactly the
 * hook-triggered builds this exists for. `source` is recorded so that a null
 * is diagnosable rather than mute: a field that can be absent for three
 * different reasons and says which is worth four extra bytes.
 */
function commitInfo(): { commit: string | null; source: string } {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (sha) return { commit: sha, source: 'git' };
  } catch {
    // no git, or no .git directory in the build box
  }
  const env = process.env.CF_PAGES_COMMIT_SHA?.trim();
  if (env) return { commit: env, source: 'CF_PAGES_COMMIT_SHA' };
  return { commit: null, source: 'unavailable' };
}

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
  const { commit, source } = commitInfo();

  const body = {
    project_ref: snap.project_ref ?? null,
    commit,
    commit_source: source,
    checksum: snap.checksum ?? null,
    counts: snap.counts ?? {
      events: snap.events?.length ?? 0,
      organizers: snap.organizers?.length ?? 0,
      exceptions: snap.exceptions?.length ?? 0,
    },
    fetched_at: snap.fetched_at ?? null,
    built_at: new Date().toISOString(),
    // WHICH NODE BUILT THIS. Added with the version pin on 2026-09-26, and the
    // only way to confirm from outside that the pin took: Cloudflare's build
    // image defaults to 24.18.0 and reads .node-version, so a deploy still
    // reporting 24 means the file is not being read. Four bytes that turn "we
    // pinned it" from a claim into an observation.
    node: process.version,
  };

  return new Response(JSON.stringify(body, null, 2) + '\n', {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
};
