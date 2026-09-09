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
| Framework | Astro 7.2.4 (static output, Cloudflare adapter) |
| Host | Cloudflare Workers with static assets |
| Repo | GitHub `dimuthu-wije/nissartango`, auto-deploys on push to `main` |
| CMS | Sveltia CMS at `/admin/`, git-backed, PAT auth (no OAuth worker) |
| Domain | OVH registrar, Cloudflare DNS |
| Local | macOS, Node 22 via nvm, project at `~/dev/nissartango` |

## Content model

Two collections, defined in `src/content.config.ts`:

**`events`** — `title`, `type` (enum: cours/practica/milonga/stage/demo/festival),
`date`, `endDate`, `recurrence` (none/weekly/biweekly/monthly), `recurrenceEnd`,
`exceptions` (array of dates), `location`, `city`, `organizer` (reference),
`teachers`, `price`, `signupUrl`, `image`

**`organizers`** — `name`, `website`, `instagram`, `facebook`, `tiktok`,
`email`, `phone`

## Key files

```
astro.config.mjs              site URL + i18n (fr default, en prefixed)
wrangler.jsonc                workers_dev false, preview_urls true, custom domains
src/content.config.ts         both collection schemas
src/lib/events.ts             expand() / upcoming() / nextDate() / RECURRENCE_LABELS
src/data/site.ts              SITE_ORGANIZER_ID
src/layouts/Layout.astro      shell, global CSS vars, OG tags
src/pages/index.astro         agenda listing
src/pages/evenements/[...slug].astro   event detail
public/admin/config.yml       Sveltia form definition
public/admin/index.html       CMS entry point
```

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
- **Phone deliberately not rendered** on public pages.
- **Media in `public/uploads/events`**, not `src/assets` — Astro processes and
  hashes `src/assets`, so CMS-written paths wouldn't resolve.

## Gotchas learned the hard way

1. **Sveltia writes `""` for blank optional fields.** Zod's `.optional()`
   rejects empty strings, which fails the build. All optional fields use
   `z.preprocess` helpers (`optionalString`, `optionalUrl`, `optionalDate`)
   that convert `""` to `undefined`.
2. **`content.config.ts` and `config.yml` must agree field-for-field.** A field
   in the CMS but not the schema is silently discarded — no error, data just
   vanishes. A field in the schema but not the CMS can never be set.
3. **A failed build doesn't take the site down.** Cloudflare keeps the last good
   deployment. This means broken deploys are silent — check the deploy status
   after adding events via the CMS.
4. **Always `git pull` before working.** The CMS commits directly to GitHub, so
   local falls behind whenever events are added.
5. **`workers_dev` is false.** `nissartango.fr` is the only production URL. The
   `*.workers.dev` address no longer resolves.
6. **Astro 7 is past Claude's training cutoff.** Verify Astro API details against
   current docs rather than assuming; the running dev server is more
   authoritative than recalled syntax. The `loader:` property on collections and
   the `@astrojs/cloudflare/entrypoints/server` main path are both current-form.
7. **Run `npm run build` locally before every push.** Faster than reading
   Cloudflare build logs.

## Outstanding

**Unverified from the last round:**
- Confirm no stray `image=` text renders on event pages
- Upload a flyer via CMS and confirm it resolves at `/uploads/events/...`
- Confirm organizer social links render on event detail

**Next up:**
1. Add ~10 real events through the CMS, then report which fields are missing or
   annoying at volume. Bicilonga should be `weekly` + `recurrenceEnd`.
2. Convert `organizer` city/name free-text drift to selects once real values exist
3. Past-event archive — currently past events vanish entirely, which is bad for
   SEO and for anyone linking to a past workshop
4. Month grouping and type filtering (needed around 30-40 events)
5. English pages (`/en/`) — UI and practical pages only
6. Event submission form for other organizers, so I'm the editor rather than the
   data-entry clerk. This is why we're on Workers rather than Pages: that route
   gets `export const prerender = false`.
7. Pin Node version (`.node-version` or `engines` in package.json) — Cloudflare
   builds on Node 24, local is 22
8. Redirect `www` to the naked domain
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
everything; `hjsekipqryfuwdkhxuks` ("nissartango-dev") is empty and referenced
nowhere. There is currently no dev/prod separation. Check before you push.

Verification:

```
./scripts/test-schema.sh          # 117 in-database assertions, local only
./scripts/create-test-users.sh    # test accounts (local only, deletes/recreates)
./scripts/prove-rls.sh            # 42 HTTP proofs with the anon key
```

`supabase/tests/grants_check.sql` is read-only and safe against any project,
including production — it is the half of the suite that the local stack cannot
answer honestly.
