# nissartango-cron

One Worker, deliberately separate from the site. It runs a **reconciliation
loop**, not a notification pipeline.

| cron (UTC) | does |
|---|---|
| `*/10 * * * *` | read the database; compare against the deployed site; rebuild on drift |
| `15 3 * * *` | rebuild unconditionally |

## The idea

Every ten minutes it reads two facts and compares them:

    the checksum the live site says it was built from   /build-info.json
    the checksum the database says its content is now   public.content_checksum

Different → POST the deploy hook. That is the entire mechanism. Nothing is
stored in the database, nothing is cleared, nothing acknowledges anything.

**Why not a database webhook.** pg_net does not retry — `net.http_post` is
fire-and-forget with a 2s default timeout — so a webhook can be silently lost,
and the fix for that is a reconciliation loop anyway. Given the loop, the
webhook buys ten minutes of latency and costs a Database Webhook, three
SECURITY DEFINER triggers, two Vault entries, a shared secret, an inbound
endpoint, and a Durable Object to debounce it.

**Why not a flag in a table.** A flag has to be cleared, and something that
must be cleared forces a write path from a Worker into the database. Comparing
two read-only facts has nothing to clear, so every Worker here stays read-only
and no secret key exists to be misused.

## The three things that stop it burning build minutes

A loop that rebuilds on disagreement is hostile if it can disagree forever.

1. **`/build-info.json` must not be cached.** A stale copy reports drift that
   was already fixed, every ten minutes, for as long as the cache lives.
   `public/_headers` marks it `no-store`, the Worker sends `cache: 'no-store'`
   plus a cache-buster, and `npm run verify:build` fails if that header rule
   ever goes missing.

2. **Backoff on a checksum that will not clear.** If the same checksum is still
   drifting after a trigger, the build it asked for failed. Waiting 30 → 60 →
   120 → 240 → 360 minutes caps that at about ten wasted builds a day instead
   of 144. A *different* checksum is exempt: it means someone published, and
   making them wait out a cooldown would turn the ten-minute promise into a
   forty-minute one. State lives in one KV key, `rebuild:last`. It is a cache,
   not a source of truth — losing it costs at most one extra build.

3. **A project mismatch stops the loop rather than driving it.** Checksums from
   two different Supabase projects can never agree, so a Worker pointed at a
   project the site was not built from would rebuild every cooldown window
   forever, slowly, until someone noticed. `build-info.json` records the
   `project_ref` it was built from; a mismatch throws and fires nothing.

## Keep-alive

There is no separate keep-alive job any more, because the poll is one. Free
plan projects pause after 7 days of inactivity and are restored by hand; this
reads the database 144 times a day. That read happens **first on every
invocation and is never skipped** — not for a failing build, not for an
unreachable site. A fortnight of broken deploys must not also cost a paused
database.

## Why the daily rebuild survives

Events falling into the past change the agenda and move no checksum: time
passing is not a row anyone updates. Nothing in the loop can see it, so 03:15
rebuilds unconditionally — no drift check, no cooldown.

Cron triggers are UTC-only; there is no timezone option. 03:15 UTC is 05:15 in
Paris in summer and 04:15 in winter. The hour does not matter, so this drifts
rather than chasing local time with two schedules. Please don't "fix" it.

## Setting it up, once

**1. Apply the checksum migration first.** `npm run build` fetches
`public.content_checksum` and fails without it — which is the correct failure:
Cloudflare keeps serving the previous deployment.

    supabase db push

**2. Build variables for the site.** Workers & Pages → your site Worker →
Settings → Build → Variables and Secrets. Add, as plain text:

    SUPABASE_URL        https://eqcgeqzzuzcwrflwasjo.supabase.co
    SUPABASE_ANON_KEY   sb_publishable_...

The **same project** as `vars.SUPABASE_URL` in `wrangler.jsonc` — see point 3
above. Both values are public by design (the publishable key ships in
browsers), and `npm run verify:build` fails if either reaches `dist/`.

**3. Create the deploy hook.** Same Worker → Settings → Builds → Deploy Hooks.
Name it `rebuild`, branch `main`. Copy the URL.

Treat that URL as a credential: it carries no `Authorization` header because
the id inside it *is* the authentication. Anyone holding it can trigger builds.
If it leaks, delete it and make another.

**4. Give it to the Worker as a secret** (from the repo root):

    npx wrangler secret put DEPLOY_HOOK_URL --config workers/cron/wrangler.jsonc

It prompts. The value is never written to disk or to git. Note the flag order:
the argument after `secret put` is the secret's NAME, not its value.

**5. Create the KV namespace and paste the id into `wrangler.jsonc`:**

    npx wrangler kv namespace create REBUILD_STATE

**6. Turn on build-failure notifications, and tick the box.** Cloudflare
dashboard → Notifications → add one for Workers Builds failures. Then record it
in `workers/cron/OPERATIONS.md`.

This is a **gate, not a reminder**: `npm run deploy:cron` refuses while any box
in that file is unticked. The Worker's failure mode is a build that fails,
drift that persists, and a cooldown quietly retrying — none of it visible from
outside, because the previous deployment keeps serving a correct-looking site.
The loop is designed to be quiet when nothing is wrong, which means it is also
quiet when everything is wrong. Deploying it without the alert is deploying the
half that hides problems and not the half that reports them.

**7. Deploy.** `npm run deploy:cron` — it also refuses while the KV namespace
id is still a placeholder, so this cannot be half-done.

## Checking it works

### The acceptance test: a real content change, observed reaching the site

**This is the only check that means anything, and it cannot be automated away
— it needs a real content change.** Everything below it is diagnostics.

    1. Note the live checksum:
         curl -s "https://nissartango.fr/build-info.json?t=$(date +%s)"
    2. Change something in Supabase — edit an event's title, then put it back.
    3. Confirm the database checksum has moved:
         psql "$PROD_DB_URL" -c "select checksum from public.content_checksum"
    4. Watch: npx wrangler tail nissartango-cron
    5. Within ten minutes the tail must show the drift branch and a POST, and
       within about two more the live checksum must equal the database's.

Observed on 2026-09-14: invocation at 08:00:05Z logged drift and POSTed, build
ran 08:01:15, deployed 08:01:17, site served the new checksum. **Two minutes
end to end, from a cold KV key.**

Still unexercised: the **cooldown branch**, which only engages when a POST
succeeded and the drift persisted — which happens only when the build itself
fails. Reaching it therefore requires a deliberately broken build, which is
the same experiment as the notifier's acceptance test in
`workers/build-notifier/README.md`. Do them as one run.

### Diagnostics

Confirm both halves name one project — this catches permanent drift before it
starts:

    curl -s "https://nissartango.fr/build-info.json?t=$(date +%s)"

`project_ref` there is what Cloudflare's build actually used. It must match
`vars.SUPABASE_URL` in `wrangler.jsonc`.

A `built_at` or `checksum` that looks stale may be your reader, not the site:
on 13–14 September a caching proxy returned pre-deploy content for a day and a
half and manufactured a poller outage that had not happened. A stale cache can
only return an OLDER value, never a newer one — so a value that HAS moved is
conclusive, and one that has not means "investigate, starting with your own
network".

Locally, without waiting:

    npx wrangler dev --config workers/cron/wrangler.jsonc --test-scheduled
    curl "http://localhost:8787/__scheduled?cron=*/10+*+*+*+*"

The logic is covered by tests that need no network:

    npm test

Thirty-five of them — and be clear about what they are worth. They stub
`fetch` and inject a fake KV, so they prove the handler is self-consistent with
the author's beliefs about the world and nothing whatever about the deployed
Worker. This feature passed all thirty-five while never once having polled
successfully. Treat them as a regression net for the logic, never as evidence
the thing works; that is what the acceptance test above is for. The ones that
matter: a mismatched project fires nothing;
a failing build does not re-trigger every ten minutes; new content published
during that cooldown is *not* made to wait; an unreachable database deploys
nothing but still lets the daily rebuild through.

In production: Workers & Pages → nissartango-cron → Logs.

    database ok — 3f1c… (4 events, 3 organizers, 1 exceptions)
    no drift

A run that throws is marked failed and shows up in observability, which is what
makes it alertable.
