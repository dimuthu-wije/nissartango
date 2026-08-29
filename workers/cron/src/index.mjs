/**
 * nissartango-cron — the two jobs that have to happen whether or not anyone
 * is looking. Deliberately a SEPARATE Worker from the public site.
 *
 * The site is deployed as static assets with no script at all, which is what
 * makes "nothing in the public path calls Supabase at runtime" structural
 * rather than remembered. Putting a scheduled handler on it would undo that.
 *
 * Job 1, KEEP-ALIVE. Free-plan projects pause after 7 days of inactivity and
 * are restored BY HAND from the dashboard. One read a day prevents that. It is
 * kept independent of the build on purpose: if the keep-alive were "the daily
 * build's query", then a fortnight of failing builds would cost you a paused
 * database on top of a stale site, and nothing in that loop self-heals.
 *
 * Job 2, REBUILD. Events falling into the past changes the agenda and fires no
 * database webhook — time passing is not an event anyone emits. Without this,
 * an event-driven-only site silently lists last Thursday's milonga forever.
 *
 * Both crons are UTC, because Cloudflare cron triggers are UTC-only and have
 * no timezone option. 03:15 UTC is 05:15 in Paris in summer and 04:15 in
 * winter; the hour does not matter, so this drifts rather than chasing local
 * time with two schedules. Do not "fix" the drift.
 */

const REBUILD_CRON = '15 3 * * *';   // must match wrangler.jsonc
const KEEPALIVE_CRON = '15 9 * * *';

/**
 * One cheap read through the same public view the site builds from, with the
 * same public key. If this ever fails, the build would have failed too.
 */
export async function keepAlive(env, fetchImpl = fetch) {
  const url = `${env.SUPABASE_URL}/rest/v1/events_public?select=id&limit=1`;
  const res = await fetchImpl(url, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`keep-alive failed: ${res.status} ${await res.text()}`);
  }
  const rows = await res.json();
  return { ok: true, rows: Array.isArray(rows) ? rows.length : 0 };
}

/**
 * POST the deploy hook. No Authorization header: the id in the URL is the
 * credential, which is exactly why it is a secret and not a var.
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
  // Triggering again before a build finishes initialising returns the build
  // already in flight rather than starting a second one. That is the property
  // the debounced database webhook will lean on later.
  return {
    ok: true,
    build: body.result?.build_uuid ?? null,
    alreadyRunning: Boolean(body.result?.already_exists),
  };
}

export default {
  async scheduled(event, env, ctx) {
    const errors = [];

    // Keep-alive runs on BOTH crons and always first. It is the job that must
    // not be taken down by the other one.
    try {
      const r = await keepAlive(env);
      console.log(`keep-alive ok (${r.rows} row)`);
    } catch (err) {
      console.error(String(err));
      errors.push(err);
    }

    if (event.cron === REBUILD_CRON) {
      try {
        const r = await triggerRebuild(env);
        console.log(r.alreadyRunning
          ? `rebuild already running (${r.build})`
          : `rebuild queued (${r.build})`);
      } catch (err) {
        console.error(String(err));
        errors.push(err);
      }
    }

    // Throwing marks the invocation as failed, which is what makes it visible
    // in observability and alertable. Both jobs have already been attempted.
    if (errors.length) throw errors[0];
  },
};
