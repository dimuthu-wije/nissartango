# nissartango-build-notifier

Emails you when a Workers build **fails**. Nothing else.

This is the component the rebuild poller's safety story rests on. The poller is
designed to be quiet when nothing is wrong, which means it is also quiet when
everything is wrong: a failed build leaves the previous deployment serving, so
the site looks correct while content changes stop reaching it.

## How it works

    Workers Builds --(event subscription)--> Queue --> this Worker --> Email Routing

- **Events**: Workers Builds event subscriptions publish `started`, `succeeded`,
  `failed` and `canceled` to a Queue. Queues is available on the Workers **Free**
  plan — 10,000 operations/day, 24-hour retention. Build events are a handful a
  day.
- **Email**: Cloudflare Email Routing's `send_email` binding. No third party, no
  API key to rotate or leak, nothing to be switched off underneath us — which is
  what happened to MailChannels' free Workers endpoint on **31 August 2024**. A
  notifier built on that today posts into a void and, if its only failure
  handling is `console.error`, says nothing about it.
- **Failures only.** With the poller running every ten minutes, green mail would
  train you to filter the channel, and a filtered channel is the same as no
  channel on the day it matters.

## Setup, once

**1. Email Routing** — Cloudflare dashboard → `nissartango.fr` → Email Routing.
Enable it, then add **dimuthu.wije@outlook.com** as a destination address and
click the verification link Cloudflare emails you. `send()` throws
`E_SENDER_NOT_VERIFIED` / `E_RECIPIENT_NOT_ALLOWED` until this is done, and
those are permanent errors — they will exhaust the retries and land in the
dead-letter queue.

**2. Queues:**

    npx wrangler queues create nissartango-build-events
    npx wrangler queues create nissartango-build-events-dlq

**3. Deploy the consumer:**

    npm run deploy:notifier

**4. Subscribe the site Worker's builds to the queue.** Cloudflare dashboard →
Workers & Pages → your site Worker → Settings → Builds → event subscriptions,
publishing to `nissartango-build-events`.

> This is the one step in this file I could not verify against documentation —
> the exact dashboard path for creating an event subscription was not in the
> pages I could reach. Follow the UI, or Cloudflare's own
> `workers-builds-notifications-template`, which exists precisely for this and
> ships with a Deploy button. If the path differs from what is written here,
> the file is wrong; fix it.

**5. Do the acceptance test below.** Not optional — see why.

## The acceptance test

**"It deploys" is not the acceptance test.** A notifier that has never
delivered a message is a decoration, and this one exists precisely because
nobody is watching. Every part of the chain — subscription, queue, binding,
verified destination, spam filtering at the far end — fails silently and
independently.

Force a real failure, confirm the mail arrives, then confirm the revert took —
with evidence, not with silence.

```bash
# 0. Record what the site currently says. This is the baseline for step 6.
curl -s "https://nissartango.fr/build-info.json?t=$(date +%s)"
#    -> note built_at

# 1. Break the build deliberately. Cloudflare dashboard -> site Worker ->
#    Settings -> Build -> Variables: set SUPABASE_URL to
#        https://nope.supabase.co
#    scripts/fetch-content.mjs stops with "BUILD STOPPED / could not reach
#    Supabase" -- a realistic failure, on the real path.

# 2. Trigger a build (push, or POST the deploy hook).

# 3. EXPECT AN EMAIL within a minute or two:
#        [nissartango] build FAILED on main — <your commit subject>

# 4. Confirm the site is UNCHANGED and still serving. A failed build must
#    change nothing; that is the whole design.

# 5. Put SUPABASE_URL back. Trigger another build.

# 6. Confirm the revert TOOK, positively:
curl -s "https://nissartango.fr/build-info.json?t=$(date +%s)"
#    -> built_at MUST have moved past the value from step 0,
#       and project_ref must still read eqcgeqzzuzcwrflwasjo.

# 7. And confirm no email arrived for that build.
```

**Step 6 cannot be "trigger again and expect no email".** A broken production
build is invisible from outside precisely because the old deployment keeps
serving — so an absent alarm is exactly what a *still-broken* build looks like
too. Silence is the symptom, not the proof. `built_at` advancing is the only
thing that distinguishes "the build succeeded" from "the build failed again and
the notifier has also stopped working". If you leave the acceptance test after
step 5 having seen no mail, you may have left production broken and disabled
its alarm in the same sitting.

### Your reader may be lying, and it lies in a known direction

`/build-info.json` is served `no-store` (see `public/_headers`), and
`verify-build.mjs` fails the build if that rule ever disappears. That binds
caches which honour it. On 13–14 September one did not: a caching proxy
returned pre-deploy content for a day and a half and manufactured the
appearance of a poller outage that had not happened. Distinct cache-busting
URLs did not defeat it either — it was not keying on the full URL.

This does not weaken the test, because of the direction of the error:

    A stale cache can only ever return an OLDER built_at, never a newer one.

So **step 6 is safe as written**: it demands that `built_at` has MOVED, and no
cache can invent a timestamp that does not exist yet. A move is conclusive.

It is the negative reading that is unreliable. If `built_at` has NOT moved,
you have learned "either the build did not deploy, or my reader is cached" —
and before concluding the former, fetch once from a different network. The
`?t=` above is worth keeping anyway; it is free and it works against
well-behaved caches. It is simply not what makes this trustworthy.

Step 7 still matters on its own: a notifier that mails on success is one you
will filter within a fortnight.

If nothing arrives at step 3, in order: the Worker's own logs (Workers & Pages →
`nissartango-build-notifier` → Logs) — a failed `send()` marks the invocation
failed and is visible there; then the dead-letter queue
`nissartango-build-events-dlq`, which holds anything that exhausted its retries;
then your spam folder; then whether the event subscription exists at all.

Record the result in `workers/cron/OPERATIONS.md`. `npm run deploy:cron` refuses
until you do.

## Design notes

**Its own failure is not silent.** A `send()` that throws is *not* acked: the
message retries, the invocation throws so it is marked failed in observability,
and after `max_retries` it goes to the dead-letter queue rather than vanishing.
`console.error` alone is indistinguishable from having nothing to say.

**`destination_address` pins the binding** to one recipient at the platform
level, so a bug in this Worker cannot turn it into a way to mail anyone else.

**`max_batch_size: 1`** because build events are rare and it makes the retry
semantics trivial: one message, one invocation, one outcome.

**Not GitHub-connected.** Deployed with `wrangler deploy`. A notifier built by
the build system it watches has a failure mode where the thing that breaks is
the thing that would have told you.

## What this does NOT cover

- **The poller's own failures.** `nissartango-cron` throwing is visible in
  observability but sends no mail. It has its own event stream; subscribing it
  is a separate piece of work.
- **A build that never reports.** If Workers Builds itself is degraded and
  emits no event, nothing here fires. The daily 03:15 rebuild and the poller's
  drift check are what eventually notice.
- **Delivery beyond Cloudflare.** If Outlook silently bins it, this Worker
  believes it succeeded. Hence step 3 of the acceptance test being a human
  confirming receipt, not a log line.
