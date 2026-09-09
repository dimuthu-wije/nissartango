# nissartango-cron — operational preconditions

Things that must be true *before* the Worker is deployed, recorded here rather
than remembered. `npm run deploy:cron` reads this file and refuses while any
required box is unticked.

A tick means a person did the thing and wrote down what they did. Nothing here
can be verified from the repo — that is exactly why it has to be written down,
and why the record is a line in a diff rather than a flag you retype.

---

## Required before the first deploy

- [ ] **Build-failure notifications have DELIVERED A MESSAGE.** Not "are
      configured", not "deployed cleanly" — an email about a real failed build
      has arrived in your inbox and you have read it.

      Set up `workers/build-notifier/` (Email Routing destination verified, two
      queues created, `npm run deploy:notifier`, event subscription pointed at
      the queue), then run the acceptance test in its README: break the build
      deliberately, confirm the mail arrives, put it back, confirm success is
      silent.

      This is the Worker's whole safety story. Its failure mode is: a build
      fails, drift persists, the cooldown quietly retries at 30 → 60 → 120 →
      240 → 360 minutes, and none of it is visible from outside because the
      previous deployment keeps serving a correct-looking site. The loop is
      designed to be quiet when nothing is wrong, which means it is also quiet
      when everything is wrong. The alert is the difference — and a notifier
      that has never delivered a message is a decoration. Subscription, queue,
      binding, verified destination and the far end's spam filter each fail
      silently and independently; only receipt tests all five.

      Record: `delivered YYYY-MM-DD, subject "[nissartango] build FAILED on ..."`, to:

- [ ] **The two halves name one project.** After the site deploy, before this
      one:

          curl -s https://nissartango.fr/build-info.json

      `project_ref` there is what Cloudflare's build actually used. It must
      equal `vars.SUPABASE_URL`'s ref in `wrangler.jsonc`. If it does not, the
      poller will refuse to rebuild rather than loop — but a Worker that
      refuses to do its job is not a deployment worth making.

      Record: `checked YYYY-MM-DD, both read <ref>`, to:

- [ ] **`wrangler secret list` holds exactly one secret**, `DEPLOY_HOOK_URL`.
      Two strays named after deploy hook URLs were created by a mistyped
      `wrangler secret put` and want deleting:

          npx wrangler secret list --config workers/cron/wrangler.jsonc
          npx wrangler secret delete "<the stray name>" --config workers/cron/wrangler.jsonc

      Record: `checked YYYY-MM-DD`, to:

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
