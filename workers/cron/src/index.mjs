/**
 * nissartango-cron — the jobs that have to happen whether or not anyone is
 * looking. Deliberately a SEPARATE Worker from the public site: the site
 * deploys as static assets with no script at all, which is what makes
 * "nothing in the public path calls Supabase at runtime" structural rather
 * than remembered. Putting a scheduled handler on it would undo that.
 *
 * It runs a RECONCILIATION LOOP, not a notification pipeline. Every ten
 * minutes it reads two facts and compares them:
 *
 *     the checksum the live site says it was built from   (/build-info.json)
 *     the checksum the database says its content is now   (content_checksum)
 *
 * Different -> POST the deploy hook. That is the whole mechanism.
 *
 * Why not a database webhook. pg_net does not retry: net.http_post is
 * fire-and-forget with a 2s default timeout, so a webhook can be silently
 * lost and the fix for that is a reconciliation loop anyway. Given the loop,
 * the webhook buys ten minutes of latency and costs a Database Webhook, three
 * SECURITY DEFINER triggers, two Vault entries, a shared secret, an inbound
 * endpoint and a Durable Object to debounce it.
 *
 * The property that makes this cheap is that it compares two READ-ONLY facts.
 * A flag in a table would work too, but a flag has to be cleared, and
 * something that must be cleared forces a write path from a Worker into the
 * database. Nothing here is cleared, so every Worker stays read-only and no
 * secret key exists to be misused.
 *
 * KEEP-ALIVE falls out of it. Free-tier projects pause after 7 days of
 * inactivity and are restored by hand; the poll reads Supabase 144 times a
 * day. That read happens FIRST on every invocation and is never skipped for
 * any reason -- not a failing build, not an unreachable site. A fortnight of
 * broken deploys must not also cost a paused database.
 *
 * THE DAILY REBUILD STAYS. Events falling into the past change the agenda and
 * move no checksum: time passing is not a row anyone updates. Nothing in this
 * loop can see it, so 03:15 rebuilds unconditionally.
 *
 * Crons are UTC -- Cloudflare has no timezone option -- so 03:15 is 05:15 in
 * Paris in summer and 04:15 in winter. The hour does not matter. Do not
 * "fix" the drift.
 */

const DAILY_CRON = '15 3 * * *';    // must match wrangler.jsonc
const POLL_CRON = '*/10 * * * *';

const KV_KEY = 'rebuild:last';

/**
 * Backoff for a checksum that has been triggered before and is STILL drifting
 * -- which means the build it asked for did not fix anything, i.e. it failed.
 * Left alone, a failing build re-fires every ten minutes: 144 builds a day
 * against a free-tier monthly allowance a build eats about a minute of.
 *
 * A DIFFERENT checksum is not subject to any of this. It means somebody has
 * published new content since the last trigger, and making them wait out a
 * cooldown would turn the ten-minute promise into a forty-minute one.
 */
const BACKOFF_MINUTES = [30, 60, 120, 240, 360];

const backoffFor = (attempts) =>
  BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1] ?? 30;

/**
 * The database's current answer, through the same view and the same public
 * key the build uses. This IS the keep-alive: if it fails, the build would
 * have failed too.
 */
export async function readDatabaseChecksum(env, fetchImpl = fetch) {
  const url = `${env.SUPABASE_URL}/rest/v1/content_checksum?select=*`;
  const res = await fetchImpl(url, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`content_checksum read failed: ${res.status} ${await res.text()}`);
  }
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.checksum) throw new Error('content_checksum returned no checksum');
  return row;
}

/**
 * What the live site says it was built from.
 *
 * cache: 'no-store' AND a cache-busting parameter, belt and braces, alongside
 * the no-store rule in public/_headers. A cached copy of this file is the one
 * failure that makes the loop hostile instead of idle: it would report drift
 * that has already been fixed, every ten minutes, for as long as the cache
 * lives.
 *
 * A missing or unparseable file returns null, which reads as drift. That is
 * correct on the deploy that first introduces the endpoint, and it is held in
 * check by the same backoff as any other repeated trigger.
 */
export function projectRef(url) {
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (/^(127\.|localhost|\[?::1)/.test(host)) return 'local';
  return host.split('.')[0] || 'unknown';
}

export async function readDeployedChecksum(env, fetchImpl = fetch) {
  const url = `${env.SITE_URL}/build-info.json?t=${Date.now()}`;
  try {
    const res = await fetchImpl(url, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', pragma: 'no-cache' },
    });
    if (!res.ok) return { checksum: null, projectRef: null, reason: `HTTP ${res.status}` };
    const body = await res.json();
    return {
      checksum: body?.checksum ?? null,
      projectRef: body?.project_ref ?? null,
      reason: body?.checksum ? null : 'no checksum field',
    };
  } catch (err) {
    return { checksum: null, projectRef: null, reason: String(err) };
  }
}

/**
 * POST the deploy hook. No Authorization header: the id in the URL is the
 * credential, which is why it is a secret and not a var.
 */
export async function triggerRebuild(env, fetchImpl = fetch) {
  if (!env.DEPLOY_HOOK_URL) {
    throw new Error('DEPLOY_HOOK_URL is not set (wrangler secret put DEPLOY_HOOK_URL)');
  }
  const res = await fetchImpl(env.DEPLOY_HOOK_URL, { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    throw new Error(`deploy hook failed: ${res.status} ${JSON.stringify(body)}`);
  }
  // Triggering again while a build is initialising returns the build already
  // in flight rather than starting a second one.
  return {
    ok: true,
    build: body.result?.build_uuid ?? null,
    alreadyRunning: Boolean(body.result?.already_exists),
  };
}

/**
 * Should a drift on `checksum` fire now, given what KV remembers?
 * Pure, so the policy is testable without a network or a clock.
 */
export function cooldownVerdict(last, checksum, now) {
  if (!last || last.checksum !== checksum) {
    return { fire: true, attempts: 1, why: 'new checksum' };
  }
  const waitMs = backoffFor(last.attempts ?? 1) * 60_000;
  const elapsed = now - (last.at ?? 0);
  if (elapsed >= waitMs) {
    return { fire: true, attempts: (last.attempts ?? 1) + 1, why: 'backoff elapsed' };
  }
  return {
    fire: false,
    attempts: last.attempts ?? 1,
    why: `same checksum still drifting after ${last.attempts ?? 1} attempt(s); ` +
         `${Math.ceil((waitMs - elapsed) / 60_000)} min of backoff left`,
  };
}

async function readState(env) {
  if (!env.REBUILD_STATE) return null;
  try { return await env.REBUILD_STATE.get(KV_KEY, 'json'); } catch { return null; }
}

async function writeState(env, state) {
  if (!env.REBUILD_STATE) return;
  try { await env.REBUILD_STATE.put(KV_KEY, JSON.stringify(state)); } catch { /* not worth failing over */ }
}

export default {
  async scheduled(event, env, ctx) {
    const errors = [];
    const now = Date.now();

    // 1. Always first, never skipped. Keep-alive and one half of the compare.
    let db = null;
    try {
      db = await readDatabaseChecksum(env);
      console.log(`database ok — ${db.checksum} (${db.n_events} events, ` +
                  `${db.n_organizers} organizers, ${db.n_exceptions} exceptions)`);
    } catch (err) {
      console.error(String(err));
      errors.push(err);
    }

    // 2. The daily rebuild answers to nothing here: no drift check, no
    //    cooldown. It exists for the change this loop is blind to.
    if (event.cron === DAILY_CRON) {
      try {
        const r = await triggerRebuild(env);
        console.log(r.alreadyRunning
          ? `daily rebuild already running (${r.build})`
          : `daily rebuild queued (${r.build})`);
        if (db) await writeState(env, { at: now, checksum: db.checksum, attempts: 1, why: 'daily' });
      } catch (err) {
        console.error(String(err));
        errors.push(err);
      }
      if (errors.length) throw errors[0];
      return;
    }

    // 3. The poll.
    if (db) {
      const live = await readDeployedChecksum(env);
      if (live.checksum === db.checksum) {
        console.log('no drift');
      } else {
        const detail = live.checksum ?? `unavailable (${live.reason})`;

        // Two checksums from two different projects can never agree, and this
        // loop's answer to disagreement is to rebuild. Pointed at the wrong
        // project it would rebuild every cooldown window forever, slowly,
        // for as long as nobody looked -- so a mismatch STOPS the loop rather
        // than driving it. Throwing is deliberate: it marks the invocation
        // failed, which is the thing that surfaces in observability.
        const mine = projectRef(env.SUPABASE_URL);
        if (live.projectRef && live.projectRef !== mine) {
          throw new Error(
            `project mismatch: this Worker reads ${mine}, but the deployed ` +
            `site was built from ${live.projectRef}. No rebuild can reconcile ` +
            `that. Fix SUPABASE_URL in Cloudflare's BUILD variables or in ` +
            `workers/cron/wrangler.jsonc so both name one project.`);
        }

        const last = await readState(env);
        const verdict = cooldownVerdict(last, db.checksum, now);
        if (!verdict.fire) {
          console.log(`drift (site ${detail}) but holding off — ${verdict.why}`);
        } else {
          try {
            const r = await triggerRebuild(env);
            console.log(`drift (site ${detail} vs db ${db.checksum}) — ` +
                        `rebuild ${r.alreadyRunning ? 'already running' : 'queued'} ` +
                        `(${r.build}), ${verdict.why}, attempt ${verdict.attempts}`);
            await writeState(env, {
              at: now, checksum: db.checksum, attempts: verdict.attempts, why: verdict.why,
            });
          } catch (err) {
            console.error(String(err));
            errors.push(err);
          }
        }
      }
    }

    // Throwing marks the invocation failed, which is what makes it visible in
    // observability and alertable. Every job has already been attempted.
    if (errors.length) throw errors[0];
  },
};

export { DAILY_CRON, POLL_CRON, KV_KEY, BACKOFF_MINUTES };
