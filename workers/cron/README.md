# nissartango-cron

Two jobs, one Worker, deliberately separate from the site.

| cron (UTC) | does |
|---|---|
| `15 3 * * *` | keep-alive, then trigger a rebuild via the deploy hook |
| `15 9 * * *` | keep-alive only |

The **keep-alive** is one read of `events_public` with the publishable key.
Free-plan projects pause after 7 days of inactivity and are restored by hand
from the dashboard, so this is what stands between a quiet fortnight and a
manual recovery. It runs on both crons and always before the rebuild, because
it is the job that must not be taken down by the other one.

The **rebuild** exists because events falling into the past changes the agenda
and emits no database webhook — time passing is not an event anyone sends.
Without it, an event-driven-only site lists last Thursday's milonga forever.

Cron triggers are UTC-only; there is no timezone option. 03:15 UTC is 05:15 in
Paris in summer and 04:15 in winter. The hour does not matter, so this drifts
rather than chasing local time with two schedules. Please don't "fix" it.

## Setting it up, once

**1. Build variables for the site** (this is what makes a Cloudflare build
possible at all). Workers & Pages → your site Worker → Settings → Build →
Variables and Secrets. Add, as plain text:

    SUPABASE_URL        https://eqcgeqzzuzcwrflwasjo.supabase.co
    SUPABASE_ANON_KEY   sb_publishable_...

Same two values as your local `.env`. Both are public by design — the
publishable key ships in browsers — and `npm run verify:build` fails if either
ever reaches `dist/`.

**2. Create the deploy hook.** Same Worker → Settings → Builds → Deploy Hooks.
Name it `daily-rebuild`, branch `main`. Copy the URL it gives you.

Treat that URL as a credential: it carries no `Authorization` header because
the id inside it *is* the authentication. Anyone holding it can trigger builds.
If it leaks, delete it and make another.

**3. Give it to the cron Worker as a secret** (from the repo root):

    npx wrangler secret put DEPLOY_HOOK_URL --config workers/cron/wrangler.jsonc

It prompts, and the value is never written to disk or to git.

**4. Deploy the cron Worker:**

    npm run deploy:cron

**5. Turn on build notifications.** Cloudflare dashboard → Notifications → add
one for Workers Builds failures, to your email. Do this now rather than later:
a failed build leaves the previous deployment serving, which is the correct
behaviour and also means a broken build is invisible from the outside. That is
the whole reason the keep-alive is not part of the build.

## Checking it works

Locally, without waiting for 03:15:

    npx wrangler dev --config workers/cron/wrangler.jsonc --test-scheduled
    curl "http://localhost:8787/__scheduled?cron=15+3+*+*+*"

The logic is covered by tests that need no network at all:

    npm test

Ten of them, including the two that matter: a failing deploy hook must not skip
the keep-alive, and a failing keep-alive must not skip the rebuild.

In production: Workers & Pages → nissartango-cron → Logs. You are looking for

    keep-alive ok (1 row)
    rebuild queued (a1b2c3d4-...)

A run that throws is marked failed and shows up in observability, which is what
makes it alertable — both jobs are attempted first, so a failure never hides
the other one's result.

## Not here yet

The debounced database webhook — editor saves triggering a build within
minutes — comes once there are editors to debounce. It will POST the same
deploy hook, which already refuses to start a second build while one is
initialising.
