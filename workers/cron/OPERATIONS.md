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

- [x] **Build-failure notifications have DELIVERED A MESSAGE.**

      Record: delivered 2026-09-14 — two emails, for builds `f5116ffa` and
      `8c421f1c`, both real failures, both read. Subject
      `[nissartango] build FAILED on main — …`. No email for the successful
      build that followed, which is the other half of the requirement.

      Deferred 2026-09-09 and closed five days later; the deferral and its
      compensating control are deleted rather than left as history, because a
      checklist that accumulates resolved items stops being read. What is worth
      keeping from it is one line: **the silent-failure risk predated the
      poller**, so blocking the poller's deploy on the notifier would have
      preserved the risk and withheld the mitigation.

      The daily `build-info.json` check that stood in for it is no longer
      load-bearing, but it remains the only thing that detects the cron Worker
      simply ceasing to be invoked. It is a scheduled task in Dimuthu's Claude
      session, **not in this repository**, and nothing here would report its
      absence — see the single point of failure below.

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

- [ ] **The Cloudflare build command runs `verify:build`, and a deploy has
      shown it running.** Until 2026-09-17 the command was `npm run build`
      alone, so `verify-build.mjs` had never executed on a deploy — every check
      it contains, including the contact-detail warning and the three content
      floors, existed and had never run anywhere but a laptop.

      Measured 2026-09-17 against an empty dev project: `npm run build` exits 0
      and publishes an empty agenda; `verify:build` exits 1 with 8 FAILED. So
      the floors work and the deploy simply never asked them.

      Set it to `npm run build && npm run verify:build`, with deploy as a
      separate step. Not `npm run check`: that pulls in `check:db`, which needs
      a `DB_URL` the build box does not have.

      Confirm from the build LOG, not from the dashboard field — the string to
      look for is `build output verified`, which only `verify-build.mjs` emits:

          Cloudflare → Workers & Pages → nissartango → the latest deployment →
          Build log → search for "verifying" and "build output verified"

      Two guards added the same day run BEFORE any check and exit 1 on their
      own, so watch for them in the first CI log too: a project-ref mismatch
      between `SUPABASE_URL` and `dist/build-info.json`, and a `dist/index.html`
      older than 24 hours. Both should stay silent on a fresh CI build, where
      the clone and the build are new every time. **If neither has ever fired
      anywhere, they are checks that have only ever been silent** — fire each
      once locally before trusting them.

      Record: ____________

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

### What is running today, and where it lives

A daily check does exist: it fetches `build-info.json` and compares `built_at`
against the previous day. **It is a scheduled task in Dimuthu's Claude session.
It is not in this repository.**

That distinction is the point, so do not lose it:

- **Nothing here would report its absence.** If that scheduled task is
  deleted, disabled, or silently stops firing, no file in this repo changes,
  no test fails, `npm run check` stays green and `npm run deploy:cron` still
  passes. The watchdog can die and the repo will go on looking healthy.
- **Verifying it means checking the scheduled tasks list** in that Claude
  session. There is no command in this project that can do it for you, and
  reading this file is not evidence that it ran.
- It reads `build-info.json`, so the staleness asymmetry above applies: it can
  cry wolf, it cannot give a false all-clear.

**Replacing it with something owned by the project is open work.** The control
is real and it is working, but it is held outside the repository by one person,
which makes it the least durable thing in this design — every other control
here is a file that travels with a clone. A `_to_do`, not a `done`.

The two shapes a project-owned replacement could take, neither built:

1. **A committed script plus a scheduler you can see.** Same logic, living in
   `scripts/`, run by something whose configuration is in git. Moves the logic
   in-repo; the *scheduling* still has to live somewhere, which is the hard
   half.
2. **An external dead-man's-switch.** A third-party monitor that expects a ping
   and alerts on its *absence* — the cron Worker pings it after each successful
   run, and the monitor shouts when the ping stops. Still the only option that
   detects "nothing happened", because the check lives outside the thing being
   checked. Cost: a third-party account and one more URL to hold, on a project
   that has deliberately avoided both.

The honest summary: everything in this repository alerts on things going wrong,
nothing in it alerts on things stopping, and the one control that does is not
in this repository.

## Once it is running

Workers & Pages → nissartango-cron → Logs. A healthy poll says:

    database ok — 3f1c… (4 events, 3 organizers, 1 exceptions)
    no drift

A run that throws is marked failed and is alertable. Add a notification for
Worker errors too if you want the poll's own failures — as opposed to the
builds it triggers — to reach you.
