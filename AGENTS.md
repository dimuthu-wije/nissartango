## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)



## What this is

A French-language agenda for tango across Nice and the Côte d'Azur — classes,
practicas, milongas, stages, demos, festivals. Covers both my own events and
other organizers'. Roughly 200 events a year expected. I'm the sole maintainer.

Live at **https://nissartango.fr**

## Stack

| Layer | Choice |
|---|---|
| Framework | Astro 7.2.4, static output. `@astrojs/cloudflare` is a dependency but is **not** configured in `astro.config.mjs` — checked 2026-09-19. The build is plain static and the adapter is unused; it is presumably being kept for the editor deployment. |
| Host | Cloudflare Workers with static assets |
| Repo | GitHub `dimuthu-wije/nissartango`, auto-deploys on push to `main` |
| CMS | None. Content lives in Supabase; the site builds from `data/snapshot.<ref>.json`. Sveltia was removed and `/admin/` 404s. |
| Domain | OVH registrar, Cloudflare DNS |
| Local | macOS, Node 22 via nvm, project at `~/dev/nissartango` |

## Content model

Three collections, defined in `src/content.config.ts`, all built from the
snapshot. The field names are the database's, in snake_case. Checked against the
schema 2026-09-19; the camelCase list that used to be here was the markdown era
and matched nothing in the code.

**`events`** — `db_id`, `slug`, `legacy_slugs` (array), `title`, `type` (enum:
cours/practica/milonga/stage/demo/festival), `starts_at`, `duration_minutes`,
`timezone`, `recurrence` (none/weekly/biweekly/monthly), `recurrence_end`,
`location_name`, `location_address`, `location_postal_code`, `city`,
`organizer_id`, `teachers` (array), `price_full`, `price_member`, `price_note`,
`signup_url`, `image_path`, `image_file`, `body`, `cancelled_at`,
`cancellation_note`, `created_at`, `updated_at`

**`organizers`** — `db_id`, `name`, `slug`, `website`, `instagram`, `facebook`,
`tiktok`, `created_at`, `updated_at`, `contact_email`, `contact_phone`.

**There is still no `email` and no `phone` here, and `contact_*` is not them.**
The private pair is absent from the public view as well as from this schema, and
that absence is the boundary keeping organizer contact details out of a public
build and a public repo. They exist in production and in the private
`nissartango-backups` repo, nowhere else. This file previously listed both as
organizer fields, which described the boundary backwards.

`contact_email` and `contact_phone` are a different fact, added 2026-09-22
(`20260922120000_organizer_public_contact.sql`): what an organizer **chose to
publish**, rather than how I reach them. They are public on purpose, rendered on
the event page, and the database refuses to hold either without a consent
timestamp beside it — `contact_email_consent_at` / `contact_phone_consent_at`,
which are themselves private and are NOT in the view. A form that forgets the
"published publicly, permanently" checkbox cannot write the column.

They exist because their absence was causing the leak the build warns about:
with nowhere sanctioned to put a phone number, it goes in an event's `body`.
`verify-build.mjs` still notices a contact detail in free text, but the warning
now means "check they meant to, and tell them about the field" rather than
"this is about to enter git forever", which stopped being true when
`data/snapshot.json` left the index on 2026-09-17.

**`exceptions`** — `event_id`, `occurrence_date`, `kind` (cancelled/moved),
`note`, `moved_starts_at`

## Key files

```
astro.config.mjs              site URL + i18n (fr default, en prefixed)
wrangler.jsonc                workers_dev false, preview_urls true, custom domains
src/content.config.ts         all three collection schemas, built from the snapshot
src/lib/occurrences.js        expand() / upcoming() / nextDate() / RECURRENCE_LABELS
src/lib/content.ts            loadAgenda() / socialLinks() / priceSummary() / formatters
src/lib/snapshot-path.mjs     which snapshot file a build reads, keyed by project ref
src/lib/redirects.mjs         public/_redirects, generated from events.legacy_slugs
scripts/db-push.sh            migrations to a HOSTED project, naming the ref first
src/data/site.ts              SITE_ORGANIZER_ID
src/layouts/Layout.astro      shell, global CSS vars, OG tags
src/pages/index.astro         agenda listing
src/pages/archives/index.astro  past events, grouped by year
src/pages/evenements/[slug].astro      event detail
src/pages/build-info.json.ts  the deploy's own receipt: ref, commit, counts
scripts/fetch-content.mjs     fetches Supabase -> snapshot
```

Every path above was confirmed to exist on 2026-09-19. The list previously named
`src/lib/events.ts` and `src/pages/evenements/[...slug].astro`; neither has ever
existed under those names in this layout, and `src/content.config.ts` was listed
twice.

### Handovers and briefings — `docs/`

**Read the highest-numbered one before starting.** It records what a stage of
work established and the corrections it owed: which instruments lied, which
confident claim turned out not to describe this project, and why something is
the way it is when the code alone does not say.

    docs/HANDOVER-stage6.md   the editor arc, e22ca1d..3522615
    docs/HANDOVER-stage5.md   auth blocking facts, production as of 2026-09-19
    docs/BRIEFING-stage5.md   WHY the schema is shaped this way -- the views as
                              the column whitelist, user_roles vs a JWT claim,
                              and why the editor is a separate deployment
    docs/DRAFT-free-text-section.md
                              SUPERSEDED. The authority is
                              supabase/PROJECT_SETUP.md:989. Kept for one
                              measurement recorded nowhere else: build 9597906f,
                              which proved verify:build had never run on a deploy

The briefing is the one to read before designing anything that touches
`events_public`, `user_roles`, or the editor's deployment shape; its §1-§3 have
not aged.

All three carry a preface listing what has been superseded. **Read that box
before the body** — and read what it says is still current, which is the half a
reader is likeliest to discount once part of a document is marked stale.

All three were written into `Claude outputs/` first, which is **gitignored**
(`.gitignore:79`), and all three were moved here on 2026-09-22. A stage 5.1
handover was pasted into a session and never written down anywhere, so nothing
records what it said.

`Claude outputs/` remains ignored and is the right place for working output —
it is empty as of 2026-09-22. A handover is not working output, and neither is
the evidence behind a decision.

Two sessions in a row searched for these, read an empty result as "none exist",
and were wrong in both directions — first that there were none, then that the
ignored ones were tracked. Hence the explicit path above.

**Write the next one into `docs/` and commit it in the same breath.** The repo
is PUBLIC, which is a constraint on what a handover may contain, not a reason to
leave it out of git: nothing in one should need a secret to be useful.

## Decisions made, and why

- **Astro over Next.js/plain HTML** — zero JS by default, good SEO, shared
  layouts without a React runtime.
- **French-first, English deferred.** English will cover UI chrome and a few
  practical pages only. Per-event translation was deliberately dropped: 200
  events a year of translation maintenance for near-zero value, since dates,
  venues and prices are already comprehensible and tango titles are proper nouns.
- **Date-prefixed slugs** (`2026-09-01-practica-mardi`). Locked in — links are
  shared publicly, so changing this breaks them.
- **Recurrence expands at build time.** One file generates many agenda rows but
  a single detail page describing the series. Per-occurrence pages were rejected
  as thin duplicate content.
- **Social handles, not URLs.** Store `nissartango`, build the link in template.
- **Contact info on the organizer, not the event** — avoids the same handle
  being typed (and mistyped) across dozens of events.
- **Email and phone never reach the build.** Not "deliberately not rendered",
  which is what this line used to say: they are excluded from the public view,
  so the build never receives them and no template mistake can leak them.
- **Media would go in `public/uploads/events`**, not `src/assets` — Astro
  processes and hashes `src/assets`, so a path stored as a plain string (by the
  old CMS then, by `image_path` in the database now) wouldn't resolve. Recorded
  as a decision, not as a description: `public/uploads/` does not exist, and as
  of 2026-09-19 those two AGENTS.md lines were the only references to it
  anywhere in the repo. Nothing serves `/uploads/events/...` today.

## Gotchas learned the hard way

1. **Blank optional fields arrive as `""`, not as absent.** Zod's `.optional()`
   rejects empty strings, which fails the build. All optional fields use
   `z.preprocess` helpers (`optionalString`, `optionalUrl`, `optionalDate`)
   that convert `""` to `undefined`. Written for Sveltia; still true of anything
   that submits an empty form field, so it stays.
2. **THE SVELTIA SECTIONS OF THIS FILE WERE STALE AND ARE STRUCK.**
   `public/admin/config.yml` does not exist and `https://nissartango.fr/admin/`
   404s. Every collection is built from the snapshot via `snapshotLoader` in
   `src/content.config.ts`, and `fetch-content.mjs` never writes to
   `src/content/`. Six tracked files under `src/content/events/` and
   `src/content/organizers/` were dead Sveltia-era content that nothing loaded
   and that had drifted from the database — the tracked
   `2026-09-01-practica-mardi.md` said `location: "Salle à confirmer"` and
   `price: "10€"` where the snapshot's row said neither. The drift was measured
   2026-09-17; the files were deleted in `b8abc2b`, committed 2026-09-19.

   That strike was incomplete when it was written. Five further CMS references
   survived elsewhere in this file — the media decision above, gotchas 3 and 4,
   and two Outstanding items — and were corrected on 2026-09-19. A fix that
   lands in one place and declares the file done is the recurring failure in
   this project; grep the whole file before claiming a section is struck.
3. **A failed build doesn't take the site down.** Cloudflare keeps the last good
   deployment, so a broken build leaves the site looking perfectly correct while
   content changes stop reaching it.

   **Broken deploys are no longer silent.** `workers/build-notifier/` emails on
   build failure, and only on failure. It has actually delivered: two emails for
   builds `f5116ffa` and `8c421f1c` on 2026-09-14, and no email for the success
   that followed — recorded in `workers/cron/OPERATIONS.md`.

   But an absence of mail is not proof of health: a Worker that stops running
   triggers no builds and so emits no events, which looks identical. To confirm
   a deploy positively, require that `built_at` has MOVED:

       curl -s "https://nissartango.fr/build-info.json?t=$(date +%s)"

   A stale cache can only return an older `built_at`, never a newer one, so a
   move is conclusive while a non-move is ambiguous. See
   `workers/build-notifier/README.md` for why that asymmetry is the whole test.

   **That file is PRETTY-PRINTED** — `JSON.stringify(body, null, 2)` — so every
   field reads `"commit": "..."` with a space after the colon. A grep for
   `'"commit":"'` matches nothing and yields an empty string, which in a polling
   loop is indistinguishable from "the site returned nothing" and from "not
   deployed yet". That cost three false alarms on 2026-09-26. Parse it (`jq`,
   `python3 -m json.tool`) or strip whitespace first; do not pattern-match
   compact JSON against it.
4. **Always `git pull` before working.** The reason is no longer the CMS —
   nothing commits to GitHub on its own now. Content lives in Supabase and
   reaches the site through the poller's deploy hook, which produces a
   deployment and no commit. The reason now is that this project is worked from
   more than one session: on 2026-09-19 a session was briefed that HEAD was
   `aa57a14` and found `main` already one commit past it, pushed and deployed.
5. **`workers_dev` is false.** `nissartango.fr` is the only production URL. The
   `*.workers.dev` address no longer resolves.
6. **Astro 7 is past Claude's training cutoff.** Verify Astro API details against
   current docs rather than assuming; the running dev server is more
   authoritative than recalled syntax. The `loader:` property on collections and
   the `@astrojs/cloudflare/entrypoints/server` main path are both current-form.
7. **Run `npm run build` locally before every push.** Faster than reading
   Cloudflare build logs.
8. **`supabase db push` targets whatever is LINKED, and that is production.**
   `supabase/.temp/project-ref` read `eqcgeqzzuzcwrflwasjo` on 2026-09-19, so
   intending "try it on dev first" and typing the obvious command would have
   migrated production and reported success. The project names are backwards
   too, so nothing on screen would have contradicted you. Use
   `./scripts/db-push.sh dev|prod`, which pushes by `--db-url` and prints the
   ref — read out of the connection string, not out of the argument — before it
   touches anything.
9. **`public/_redirects` is generated and gitignored.** It comes from
   `events.legacy_slugs` via `scripts/fetch-content.mjs` on every build. Do not
   edit it and do not commit it: the copy on disk is output. It was hand-written
   until 2026-09-19, when it turned out that rejecting the one event it pointed
   at would have failed `verify-build.mjs` check 7 and frozen the site.

## Outstanding

**Unverified from the last round:**
- Confirm no stray `image=` text renders on event pages
- Decide what `image_path` / `image_file` are supposed to resolve to. Nothing
  serves `/uploads/events/...` and `public/uploads/` does not exist, so this is
  an open design question, not a verification step.
- Confirm organizer social links render on event detail

**Next up:**
1. Add ~10 real events — directly in Supabase until the stage-5 editor exists —
   then report which fields are missing or annoying at volume. Bicilonga should
   be `weekly` + `recurrence_end`.
2. Convert `organizer` city/name free-text drift to selects once real values exist
3. ~~Past-event archive~~ — **DONE 2026-09-26.** `/archives/`, grouped by year,
   newest first.

   This line said past events "vanish entirely". They did not: their pages were
   built, live and in the sitemap. What vanished was any route TO them — four
   of five event pages were linked from nowhere, reachable only from a search
   result or a saved link. Worth the distinction, because it changed the fix
   from "keep the pages" to "list them".

   The agenda and the archive are now complementary BY CONSTRUCTION —
   `partition()` in `src/lib/occurrences.js` defines archived as "produced no
   listed occurrence", so no event can fall between them. `verify-build.mjs`
   check 8b fails the build if any event page is unreachable from either.
4. Month grouping and type filtering (needed around 30-40 events)
5. English pages (`/en/`) — UI and practical pages only
6. Event submission form for other organizers, so I'm the editor rather than the
   data-entry clerk. This line used to say that is why we're on Workers rather
   than Pages, with the route getting `export const prerender = false`.
   Superseded: `wrangler.jsonc` now deliberately has no `main`, so the public
   site is static assets with no runtime code path to Supabase at all, and the
   editor is a **separate deployment**. Read the comment in `wrangler.jsonc`
   before reopening this.
7. ~~Pin Node version~~ — **DONE 2026-09-26.** `.node-version` and `.nvmrc`
   both say `22.23.2`, `engines` is `>=22.12.0 <23`, and
   `tests/node-version.test.js` binds the three so they cannot drift.

   22.23.2 because Cloudflare's build image PREINSTALLS it (their build-image
   docs, checked 2026-09-26) while defaulting to 24.18.0 — so the pin costs no
   download and puts CI on the version this project is actually developed and
   tested on. Pinning to 24 would have meant shipping from a version nobody
   here had run a build on.

   `build-info.json` now reports `node`, which is the only way to confirm from
   outside that the pin took: a deploy still saying v24.18.0 means the file is
   not being read.
8. ~~Redirect `www` to the naked domain~~ — **DONE 2026-09-26**, with a
   Cloudflare **Redirect Rule**. Measured from outside:

       /                          301 -> https://nissartango.fr/
       /archives/                 301 -> https://nissartango.fr/archives/
       /evenements/<slug>/        301 -> https://nissartango.fr/evenements/<slug>/
       /?utm_source=flyer&x=1     301 -> https://nissartango.fr/?utm_source=flyer&x=1

   One hop to a 200, path and query preserved, and the naked domain still 200s.

   **`public/_redirects` cannot do this.** Cloudflare's static-asset redirects
   documentation lists "Domain-level redirects" as NOT supported and defines
   `source` as a file path. `_redirects` was the obvious first guess and was
   checked against the docs before anything was written, which is the only
   reason it was not tried and quietly left half-working.

   **A Redirect Rule fires even though `www` is still a Worker custom domain.**
   Recorded here as a CLAIM from Cloudflare's docs — requests handled by
   Workers "will not suppress actions from modern Rules features" — and then
   measured on this zone, which is what promotes it to a fact about this
   project. So `wrangler.jsonc` keeps both routes and www keeps resolving;
   nothing had to be removed.

   That ordering matters if it is ever revisited: wrangler provisioned www's
   DNS record, so deleting the route would take www from a working 301 to not
   resolving at all. Add or change the rule first; touch the route second, if
   ever.

   Re-check with:

       curl -sS -o /dev/null -D- --max-redirs 0 https://www.nissartango.fr/ \
         | tr -d '\r' | grep -i '^location'
9. Listings on tango aggregators + Google Business Profile — the site won't
   generate its own audience

## How I'd like to work

Be objective and disagree with me when I'm wrong. Point out design problems
before writing code. I'll paste build logs and file contents; tell me exactly
what to change rather than having me experiment.

### Never write a file you have not read in this session

Twice an agent working from a cloud container appended to `.gitignore` using a
copy that did not exist on its side, and shipped a file containing only the
appended block — deleting the rules that keep `.env`, `dist/` and
`node_modules/` out of git. Neither time was it forgetfulness. Both times the
agent could not see this repo's copy and wrote anyway.

So: **no whole-file write to a path whose current contents you have not read in
this session.** "I know what's in it" is the failure, not the fix.

For an addition to a file you cannot read — `.gitignore`, `.env`, anything
outside a connected folder — hand me the lines to paste. When you *can* read
it, edit in place where it lives (a `python` read-modify-write over the real
file) rather than shipping a whole file over it, and show me the diff.

This matters most for files whose job is to prevent something. A clobbered
`.gitignore` looks like nothing until a secret is committed.

**And verify after writing, not only read before.** A third incident had a
different cause and the same shape: a test created a zero-byte
`supabase/tests/grants_check.sql` in the agent's container because an `mv` that
was meant to stash the real file failed silently — `2>/dev/null` on a file that
was never there — and the `touch` after it created an empty one. Nothing was
overwritten and nothing was assumed; a command just did not do what it looked
like it did.

So after any file operation — write, move, delete, unpack, patch — check the
result: does the file exist, is it a plausible size, does it still contain the
markers it should. `wc -c`, `wc -l`, a `grep` for a known line. Ten seconds,
and it is the only thing that catches a silent failure in the middle of a
pipeline. `set -e` does not help when the failure is `2>/dev/null`.

**None of this is why `.env` is safe.** Rules describe intentions; the control
is `.githooks/pre-commit`, which refuses any commit that stages a `.env`, that
carries a secret key shape, or — the check aimed squarely at the two incidents
above — that is made while `.gitignore` has stopped ignoring `.env`. Read
`.githooks/README.md`. If you are working in a fresh clone, `npm install` wires
it up; `npm run hooks:install` does it on demand.

### Measure platform claims against this project before recording them

Twice a confident, well-sourced, general claim about Supabase turned out not to
describe these projects:

- *"The fail-closed default landed for new projects on 30 May 2026, and both
  projects were created on 28 August, therefore both are fail-closed."*
  Dev was fail-open on all three settings, with `anon=arwdDxtm` — insert,
  update and delete — on every new table.
- *"`create event trigger` requires superuser, and the migration role is not
  one, therefore automatic RLS cannot be versioned."*
  The migration role created and dropped one on both projects, and
  production's `ensure_rls` is owned by `postgres`.

Both claims were true of something. Neither was true here. A release note tells
you what a default **was**; documentation tells you what the platform
**usually** does. Neither is evidence about the project in front of you.

So: **a platform claim gets measured against this project before it is written
down as a fact about it** — and where the measurement is cheap, the probe goes
in `supabase/tests/` so the next person measures instead of inheriting my
conclusion. `can_a_migration_install_automatic_rls` exists because the second
claim above was wrong; it now answers the question per project, for good.

Where a claim cannot be measured, record it as a claim, with its source and the
date, not as a property of the project.

### Instruments that lie quietly

Measuring only beats remembering when the instrument is honest. Four here were
not. Each is worse than an error, because each returns a plausible answer and
nothing looks wrong:

- **A caching web proxy** served day-stale pages for 36 hours and manufactured
  the appearance of a poller outage that had not happened. Distinct
  cache-busting URLs did not defeat it — it was not keying on the full URL. The
  asymmetry is the defence: a stale cache can only ever return an OLDER
  `built_at`, never a newer one. Demand that it has MOVED, and never read a
  non-move as proof of anything.
- **A FUSE mount reported every file as mode 600**, whatever its real
  permissions — `README.md` read 600 too. `.env` was reported safe and was
  actually 644. A permission read through a bridge is fabricated by the bridge.
- **`git grep -E` has no `\b`.** It is POSIX ERE. A pattern using one matches
  nothing, and inside an alternation it returns the *other* branch's hits, which
  reads as a clean and complete result. Measured 2026-09-19 on this repo:
  `-E '\bCMS\b'` found **0** in AGENTS.md; `-P '\bCMS\b'` found **4**. Use `-P`,
  or `-F` for a literal.
- **`${PIPESTATUS[0]}` is a bash-ism and yields empty in zsh** — it is
  `$pipestatus[1]`, 1-indexed. Worse, `cmd | tail` makes `$?` report *tail's*
  status, so a failing command reads as `exit=0`. This corrupted three separate
  measurements in one sitting, including both staleness guards being recorded as
  silent when each had correctly exited 1. **Capture exit codes without a pipe.**

The shape they share: a confident answer from a layer nobody was thinking about.
When a result is surprising, suspect the instrument before the system.

### Never paste a token or a connection string into a chat

An admin access token was pasted on 2026-09-19. Its session was revoked with
`POST /auth/v1/logout?scope=global` (204), verified by SQL: `auth.sessions` and
`auth.refresh_tokens` both went to zero — by DELETION, not by a `revoked` flag,
which is what GoTrue actually does. A prediction of `refresh_revoked = 1` was
wrong; `refresh_live = 0` was the number that mattered.

**The access token itself could not be revoked.** PostgREST validates signature
and expiry and consults no session table, so an issued JWT is live until its
`exp` regardless of what happens to the session. The only other lever is
rotating the signing key, which invalidates every token at once. Revoking a
session closes refresh, not the hour already granted.

There is no "Sign out user" control in Authentication → Users — the menu offers
Remove MFA factors, Ban user and Delete user. The logout API is the route.

**`supabase projects api-keys` prints legacy `service_role` JWTs in full.** It
masks the newer `sb_secret_…` key (printing a short prefix then dots) and does NOT mask the
legacy JWT-format `anon` and `service_role` keys, which are printed complete.
On 2026-09-23 that put dev's `service_role` JWT into a chat transcript while
fetching dev's *publishable* key, which is public and was the only part wanted.

Two things made it worse than it had to be:

- the output is **one single JSON line**, so `| grep publishable` matched the
  whole thing. A line-oriented filter over line-oriented output is an
  assumption, and this command breaks it.
- the masking is inconsistent between key formats, so seeing one key masked is
  no evidence that the others are.

If you need a publishable key, take it from the dashboard, or pipe through `jq`
selecting exactly that key — never a grep. If this command has already been
run, treat that project's legacy keys as burned and disable them (Settings →
API Keys → Legacy keys).

## Supabase

Schema lives in `supabase/migrations/` and is applied with the CLI, never
through the dashboard or an MCP connector. As of the first `db push` to the
hosted project those files are history: **append new migrations, never edit an
applied one.**

Project settings that live in the dashboard and do NOT travel with this repo
are written down in **`supabase/PROJECT_SETUP.md`** — read it before pushing to
any project. Short version: Data API on, automatically-expose-new-tables off,
automatic RLS on. A mistake should deny, not expose.

That file also says **which project is which**, and the names mislead:
`eqcgeqzzuzcwrflwasjo` ("dimuthu-wije's Project") is production and holds
everything; `hjsekipqryfuwdkhxuks` ("nissartango-dev") is dev. **Read the ref,
never the name.**

Dev is real, not a placeholder. Measured 2026-09-17: the same eight migrations
as production, with an identical column signature on all five base tables. It is
referenced by `.env.example`, `scripts/check-db.sh`, `PROJECT_SETUP.md`, this
file, and the ops files in the backup deliverable. It is empty of *content* by
policy — truncated before each restore rehearsal and again after — which is not
the same as unused.

Dev is also deliberately fail-open on `automatic_rls`: production's `ensure_rls`
event trigger is not installed there on purpose, so a migration that forgets
`enable row level security` fails visibly instead of being silently corrected.
**Do not "fix" that** — it is what makes dev the canary for a defective
migration.

What is still missing is a dev/prod split in **operation**: production remains
the only project holding content, still live, still restored by hand. This
section previously said dev was "empty and referenced nowhere" and that there
was "no dev/prod separation"; both were false when measured on 2026-09-17, and
`PROJECT_SETUP.md` was corrected then while this file was not.

Check the ref before you push.

The editor can now be run against dev instead of production:

```
./scripts/seed-dev-editor.sh --help   # once: dev is empty of users too
npm run dev:editor                    # http://localhost:3000 -> dev
```

The ORIGIN picks the project (`editor/public/target.js`), so
`editor.nissartango.fr` is production and everything else is dev — there is no
flag to get wrong, and `tests/editor-config.test.js` asserts no other hostname
can reach production. Port 3000 is dev's `site_url`, not a preference. Until
2026-09-23 the editor hard-coded production, so every time anyone ran it they
were editing the live agenda.

Verification:

```
./scripts/test-schema.sh          # 117 in-database assertions, local only
./scripts/create-test-users.sh    # test accounts (local only, deletes/recreates)
./scripts/prove-rls.sh            # 42 HTTP proofs with the anon key
```

`supabase/tests/grants_check.sql` is read-only and safe against any project,
including production — it is the half of the suite that the local stack cannot
answer honestly.
