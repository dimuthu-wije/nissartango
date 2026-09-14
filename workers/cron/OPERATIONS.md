# nissartango-cron — operational preconditions

Things that must be true *before* the Worker is deployed, recorded here rather
than remembered. `npm run deploy:cron` reads this file and refuses while any
required box is unticked.

A tick means a person did the thing and wrote down what they did. Nothing here
can be verified from the repo — that is exactly why it has to be written down,
and why the record is a line in a diff rather than a flag you retype.

Three states:

    - [ ]   not done.  `npm run deploy:cron` refuses.
    - [x]   done.      Passes silently.
    - [!]   DEFERRED.  Passes, and the deploy SHOUTS about it every time.

`[!]` exists because "not yet" is sometimes the correct engineering answer, and
pretending otherwise just teaches people to tick boxes. It costs three fields,
all required, and it expires:

    - [!] **Title**
          deferred: 2026-09-09
          compensating: what is running INSTEAD, specifically
          review: 2026-10-09

A deferral without a compensating control is an untick with better
handwriting, and the deploy refuses it. A `review:` date in the past also
refuses — a deferral nobody revisits is just a decision made silently. Extend
it deliberately, as an edit someone can question, or do the thing.

---

## Required before the first deploy

- [!] **Build-failure notifications have DELIVERED A MESSAGE.**
      deferred: 2026-09-09
      compensating: daily external fetch of https://nissartango.fr/build-info.json?t=<epoch-ms> comparing built_at against the previous day, running OUTSIDE Cloudflare
      review: 2026-10-09

      Deferred deliberately, with the reasoning on the record because it is the
      kind that looks like a corner being cut and is not.

      **The silent-failure risk predates the poller.** The daily 03:15 rebuild
      has run unwatched since 31 August. Deploying `nissartango-cron` does not
      add exposure — it reduces staleness. Blocking the deploy on the notifier
      would preserve the risk and withhold the mitigation, which is the worst
      of both.

      The compensating check is the dead-man's-switch recorded below as
      unclosed, now chosen and running. It is strictly broader than the
      notifier it stands in for: `built_at` standing still catches a failing
      build, a cron Worker that has stopped being invoked, AND a paused
      database — the notifier catches only the first, because a Worker that
      never runs emits no build events.

      What it does NOT catch, and why the notifier is still wanted: latency. A
      daily check finds within 24 hours what an email finds in two minutes.

      **Why this control is defensible even though its input can be stale.**
      On 13–14 September a caching proxy in front of one reader's
      `build-info.json` fetches returned pre-deploy content for a day and a
      half, and manufactured the appearance of a 19-hour poller outage that
      had not happened. The poller was correct throughout; the instrument was
      not. Distinct cache-busting URLs did NOT defeat that proxy — it was not
      keying on the full URL — so a cache-buster is worth adding and is not
      what makes this control trustworthy.

      What makes it trustworthy is the direction of the error:

          A stale cache can only ever return an OLDER built_at, never a
          newer one. So this failure mode can make the watchdog cry wolf;
          it cannot produce a false all-clear.

      That asymmetry is the whole argument. A watchdog whose failure mode is
      a false alarm is an acceptable compensating control, because the thing
      it is guarding against — silence while something is broken — is exactly
      the outcome it cannot produce. Treat a `built_at` that HAS moved as
      conclusive, and a `built_at` that has NOT moved as "investigate",
      starting with whether your own reader is being served from a cache:
      compare against a fetch from a different network before concluding
      anything is wrong with the site.

      Add `?t=<epoch-ms>` regardless. It is free and it works against caches
      that behave; it simply is not load-bearing here.

      Closing it means DELIVERY, not configuration: subscription, queue,
      binding, verified destination and the far end's spam filter each fail
      silently and independently, and only receipt tests all five. Set up
      `workers/build-notifier/`, run the acceptance test in its README, then
      replace this block with the delivery record.

      Record on closing: `delivered YYYY-MM-DD, subject "[nissartango] build FAILED on ..."`, to:

- [x] **The two halves name one project.** After the site deploy, before this
      one:

          curl -s https://nissartango.fr/build-info.json

      `project_ref` there is what Cloudflare's build actually used. It must
      equal `vars.SUPABASE_URL`'s ref in `wrangler.jsonc`. If it does not, the
      poller will refuse to rebuild rather than loop — but a Worker that
      refuses to do its job is not a deployment worth making.

      Record: checked 2026-09-09 — `wrangler.jsonc` and the live
      `build-info.json` both read `eqcgeqzzuzcwrflwasjo`.

- [x] **`wrangler secret list` holds exactly one secret**, `DEPLOY_HOOK_URL`.
      Two strays named after deploy hook URLs were created by a mistyped
      `wrangler secret put` and want deleting:

          npx wrangler secret list --config workers/cron/wrangler.jsonc
          npx wrangler secret delete "<the stray name>" --config workers/cron/wrangler.jsonc

      Record: checked 2026-09-09 — exactly one secret, `DEPLOY_HOOK_URL`.
      The two strays named after deploy hook URLs are deleted.

---

## Known single point of failure: nobody watches the watcher

**Recorded, not solved.** Read this before assuming the monitoring story is
finished.

After this stage `nissartango-cron` carries three jobs: the daily 03:15
rebuild, the ten-minute drift poller, and the keep-alive that the poller's
Supabase read doubles as. Nothing watches it.

The failure mode is not an error — it is an absence. If the Worker stops being
invoked at all (crons unbound by a bad deploy, the Worker deleted, the account
suspended, a platform fault), there is no exception, no failed invocation, and
nothing in observability. What happens instead:

- the site quietly stops updating — and looks perfectly correct, because the
  last good deployment keeps serving;
- roughly seven days later the free-tier Supabase project pauses for
  inactivity, and editors are locked out until someone clicks Restore.

**`workers/build-notifier/` cannot catch this.** It fires on build events, and
a Worker that never runs triggers no builds, so it emits no events. An absence
of mail is what a healthy quiet week looks like too.

Two ways to close it, neither built:

1. **Glance at `built_at`.** `curl -s https://nissartango.fr/build-info.json`
   once a week or so; the daily rebuild means it should never be more than ~24
   hours old. Free, immediate, and depends on a person remembering — which is
   the class of control this project has otherwise been removing.
2. **An external dead-man's-switch.** A third-party monitor that expects a ping
   and alerts on its *absence* — the cron Worker pings it after each successful
   run, and the monitor shouts when the ping stops. This is the only option
   that detects "nothing happened", because the check lives outside the thing
   being checked. Cost: a third-party account and one more URL to hold, on a
   project that has deliberately avoided both.

The honest summary: everything here alerts on things going wrong, and nothing
alerts on things stopping. That is a real gap, it is written down, and it is
not closed.

## Once it is running

Workers & Pages → nissartango-cron → Logs. A healthy poll says:

    database ok — 3f1c… (4 events, 3 organizers, 1 exceptions)
    no drift

A run that throws is marked failed and is alertable. Add a notification for
Worker errors too if you want the poll's own failures — as opposed to the
builds it triggers — to reach you.
