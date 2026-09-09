# nissartango-cron — operational preconditions

Things that must be true *before* the Worker is deployed, recorded here rather
than remembered. `npm run deploy:cron` reads this file and refuses while any
required box is unticked.

A tick means a person did the thing and wrote down what they did. Nothing here
can be verified from the repo — that is exactly why it has to be written down,
and why the record is a line in a diff rather than a flag you retype.

---

## Required before the first deploy

- [ ] **Build-failure notifications.** Cloudflare dashboard → Notifications →
      add one for **Workers Builds** failures, delivered to an address you
      actually read.

      This is the Worker's whole safety story. Its failure mode is: a build
      fails, drift persists, the cooldown quietly retries at 30 → 60 → 120 →
      240 → 360 minutes, and none of it is visible from outside because the
      previous deployment keeps serving a correct-looking site. The loop is
      designed to be quiet when nothing is wrong, which means it is also quiet
      when everything is wrong. The alert is the difference.

      Record: `enabled YYYY-MM-DD, alert named "..."`, to:

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

## Once it is running

Workers & Pages → nissartango-cron → Logs. A healthy poll says:

    database ok — 3f1c… (4 events, 3 organizers, 1 exceptions)
    no drift

A run that throws is marked failed and is alertable. Add a notification for
Worker errors too if you want the poll's own failures — as opposed to the
builds it triggers — to reach you.
