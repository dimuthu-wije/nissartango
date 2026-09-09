# Supabase project settings

## Which project is which

Two Supabase projects exist in the org, and their names are the wrong way
round. Read this before pushing anything anywhere:

| ref | name in the dashboard | what it actually is |
|---|---|---|
| `eqcgeqzzuzcwrflwasjo` | `dimuthu-wije's Project` | **production.** Every migration, all the content, the key the site builds with, the key the cron Worker reads. West EU (Ireland). |
| `hjsekipqryfuwdkhxuks` | `nissartango-dev` | **empty.** No migrations, no content, referenced nowhere in this repo. West EU (Paris). |

So the project called "dev" is the empty one and the default-named one is
production. That is an accident waiting to happen at 23:00 in six months,
which is what this file exists to prevent — rename the production project in
the dashboard. The reference id is immutable and is what every config here
uses, so renaming breaks nothing.

Each project's content lands in its own snapshot file: `data/snapshot.json` is
production's and is committed (it is the backup, and what `--from-snapshot`
publishes in an emergency); every other project writes `data/snapshot.<ref>.json`,
which `.gitignore` covers. `data/production-ref` holds the one fact that cannot
be derived. So a build against dev cannot overwrite production's backup, and no
flag is involved — see `src/lib/snapshot-path.mjs`.

There is, today, **no dev/prod separation**: one project holds everything and
it is live. The brief asked for an MCP connector pointed at a development
branch rather than production, and that constraint is currently unmet — not
violated, since no Supabase MCP connector is attached, but unmet. Making
`hjsekipqryfuwdkhxuks` real is `supabase link` + `db push` + `npm run seed:real`
against it; the migrations and the seed script already work unchanged.

Everything in `supabase/migrations/` travels with the repo. **These do not.**
They are set per project in the dashboard, and nothing in a `git clone` will
remind you they exist. This file is that reminder — for the next project you
create, on an evening when none of this is fresh.

## The repository is PUBLIC

`https://github.com/dimuthu-wije/nissartango` — public, 27 commits. Verified by
fetching it unauthenticated, not by remembering.

Two consequences.

**Anything committed here is world-readable the moment it is pushed**, and
force-pushing it away afterwards does not un-publish it: GitHub keeps
unreachable objects addressable, forks and caches keep their own copies. A
secret that reaches this repo is a secret that must be rotated, never one that
can be deleted. That is why `.gitignore` is load-bearing rather than tidy, and
why an agent that cannot read a file must not write it (see `AGENTS.md`).

**It decides how careful stage 5 has to be.** The editor area ships a
publishable key to browsers, which is fine and is the point. What must not
land in this repo: any secret key, any database connection string, any magic
link, any test account credential, any exported user row. In a private repo a
mistake there is embarrassing; here it is an incident. Keep editor fixtures
synthetic and keep real editor accounts out of `supabase/tests/`.

### The only key ever committed

Audited across every tracked file and all 27 commits, classified by prefix
rather than by intention:

```
workers/cron/wrangler.jsonc:29   sb_publishable_skzfnei…   PUBLISHABLE — safe in git
all history                      5 occurrences, same key, nothing else
```

Zero `sb_secret_…`. Zero legacy `eyJ…` JWTs — so no decode of a `role` claim
was needed or possible; the question a decode would answer does not arise.
Supabase's current format is self-describing: `sb_publishable_` is safe here,
`sb_secret_` is not, and a legacy JWT would have needed its payload's `role`
inspected before either claim could be made. Re-run before stage 5:

```bash
git grep -I -n -o -E 'sb_(publishable|secret)_[A-Za-z0-9_-]{6,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.'
```

## Rotating credentials — where the buttons are

Not an incident procedure. Just where to click at 23:00, and what breaks if you
rotate and forget the second half.

| what | where | what must be updated afterwards |
|---|---|---|
| **Publishable / secret API keys** | Project Settings → **API Keys**. Create the new key, swap it everywhere, then delete the old one (deleting a secret key cannot be undone). Legacy `anon`/`service_role` JWTs are *deactivated* there instead, which is reversible. | `.env` · Cloudflare → site Worker → Settings → Build → Variables (`SUPABASE_ANON_KEY`) · `workers/cron/wrangler.jsonc` `vars.SUPABASE_ANON_KEY`, then `npm run deploy:cron` |
| **Database password** | Project Settings → **Database** → Reset database password. It is only resettable, never recoverable — write the new one down. | Any `psql`/pooler connection string you hold, including `DEV_DB_URL` / `PROD_DB_URL` used by `scripts/compare-projects.sh`. Nothing in the deployed site uses it. |
| **Cloudflare deploy hook** | Workers & Pages → site Worker → Settings → **Builds → Deploy Hooks**. Delete the old hook, create a new one. The id in the URL *is* the credential. | `npx wrangler secret put DEPLOY_HOOK_URL --config workers/cron/wrangler.jsonc` — the Worker is the only holder. |

Order that avoids an outage: create the new credential, update every consumer,
verify a build still succeeds, *then* delete the old one. The publishable key
is the one with two consumers that are easy to miss — the Cloudflare build
variable and the cron Worker's `vars` — and a stale one there fails the build
loudly rather than silently, which is the correct direction.

## The three settings, per project

Record them here as they are confirmed. "Confirmed" means the output of
`supabase/tests/api_settings.sql`, not a memory of ticking a box.

| setting | `eqcgeqzzuzcwrflwasjo` (prod) | `hjsekipqryfuwdkhxuks` (dev) | wanted |
|---|---|---|---|
| Enable Data API | ? | ? | **on** |
| Automatically expose new tables | ? | ? | **off** |
| Enable automatic RLS | ? | ? | **on** |

### How to read them, without trusting a checkbox

Two of the three are not really dashboard state. Supabase implements
"automatically expose new tables" as Postgres **default privileges owned by
`postgres`**:

```sql
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
```

which is the same catalogue `20260829090000_fail_closed_defaults.sql` writes to
— the code half and the dashboard half are literally one mechanism. And
"automatic RLS" shows up as whether a freshly created table arrives with
`relrowsecurity` set. Both are therefore measurable:

```
supabase/tests/api_settings.sql     paste into the SQL editor of each project
```

It creates a table inside a transaction, reports what that table was granted
and whether RLS came on, reads `pg_default_acl`, and rolls back. Nothing is
committed. Four rows; anything reading `LOOK AT THIS` is the answer.

The Data API toggle is not a Postgres fact — it is whether the platform runs
PostgREST in front of the database. Check it over HTTP:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://<ref>.supabase.co/rest/v1/?apikey=<publishable key>"     # 200 = on
```

### Dates worth knowing

Supabase's changelog for this ("Tables not exposed to Data and GraphQL API
automatically"): the opt-in toggle appeared at project creation on **28 April
2026**, became the **default for new projects on 30 May 2026**, and will be
**enforced on all existing projects on 30 October 2026**. Both projects here
were created on 28 August 2026, so both should already be fail-closed by
default — but "should" is why `api_settings.sql` exists, and a project created
through a flow that did not ask for a name may not have asked for this either.

### Rehearse on dev, always

`api_settings.sql` is read-only and rolls back, and it is still DDL. Run it on
`hjsekipqryfuwdkhxuks` FIRST — see the four rows, confirm the probe table is
gone — and only then on production. An empty project is where "left behind"
costs nothing, and this file exists precisely because the thing that has been
right every time is rehearsing before touching the database that is serving.

### Comparing two projects

A single project's check output says it passed its own assertions. Two outputs
side by side say whether the projects are the same shape, which is the question
that matters once one of them is production:

```bash
./scripts/compare-projects.sh supabase/tests/api_settings.sql "$DEV_DB_URL" "$PROD_DB_URL"
./scripts/compare-projects.sh supabase/tests/grants_check.sql "$DEV_DB_URL" "$PROD_DB_URL"
```

**Expect the `grants_check` diff to be non-empty, and read it as the finding
rather than the problem.** Dev takes seven migrations applied cleanly in one
go. Production took them incrementally, plus `data/fold-accented-slugs.sql`,
plus whatever the dashboard did along the way. A difference in content is by
design; a difference in grants, RLS or default privileges is the thing this
comparison exists to surface, and it has never been run before.

Connection strings: Project Settings → Database → Connection string → URI.
They carry the database password, so keep them out of shell history
(`read -rs DEV_DB_URL; export DEV_DB_URL`). The script refuses any file outside
`supabase/tests/`, because it points at production by design and must not
become a way to run arbitrary SQL there.

## Settings, and why

Project Settings → API (Data API):

| Setting | Value | Why |
|---|---|---|
| **Enable Data API** | **on** | This is PostgREST. The public build fetches through it at build time and the editor SPA will too. Off means no site. |
| **Automatically expose new tables** | **off** | With it on, a table created in `public` is reachable by `anon` and `authenticated` before anyone grants anything — the exact hazard every `revoke all … from anon, authenticated` in stage 1 was written to defend against. Off means a forgotten grant produces a loud `permission denied` instead of a silently public table. |
| **Enable automatic RLS** | **on** | Every table in these migrations already enables RLS explicitly, so this changes nothing about correct code — enabling RLS twice is a no-op, and migrations run as the table owner, which bypasses RLS anyway. It exists to catch the table you create at 23:00 in six months and forget. |

One rule underneath all three: **a mistake should deny, not expose.**

## What is enforced in code, so you cannot get it wrong twice

Two of the three are also asserted, because a dashboard is a bad place for a
security boundary to live alone:

- `supabase/migrations/20260829090000_fail_closed_defaults.sql` revokes default
  privileges on tables, sequences and functions from `anon` and `authenticated`.
  That is the code half of "automatically expose new tables = off", and it
  applies to any project these migrations are pushed to, configured or not.
- `supabase/config.toml` sets `auto_expose_new_tables = false`, so the local
  stack provisions the same way. Without it, local grants by default and the
  hosted project does not — a table works locally and 401s on the hosted one,
  which is a loud failure, but the two environments disagreeing about this
  particular thing is not something you want.
- `supabase/tests/grants_check.sql` asserts both: check 12 (no default
  privileges owned by roles we control) and check 5 (RLS on every table in
  `public`). Run it against any project, including production — it is
  read-only.
- `supabase/tests/expose_probe.sql` answers the same question empirically:
  it creates a table inside a transaction, reports whether `anon` received
  anything, and rolls back. Nothing is committed. Worth running once per
  project, because it measures the outcome rather than reasoning about it.

### One thing that will look alarming and is not

A hosted project reports default privileges owned by **`supabase_admin`**
granting `anon` and `authenticated` everything on future tables:

```
supabase_admin:anon=arwdDxtm/supabase_admin   (tables)
supabase_admin:anon=rwU/supabase_admin        (sequences)
supabase_admin:anon=X/supabase_admin          (functions)
```

These are not a hole and cannot be removed. `ALTER DEFAULT PRIVILEGES` is
per creating-role: a default owned by `supabase_admin` fires only for objects
`supabase_admin` creates — the platform's own, never yours. Everything you
create comes from `postgres` (migrations, SQL editor, table editor), and
`postgres` is not a member of `supabase_admin`, so those entries are neither
reachable nor revokable. Check 12 is scoped to the roles that matter and
check 13 reports these as INFO; the probe confirms a new table of yours
arrives with no grants at all.

## Creating the next project

(Including making `nissartango-dev` into a real one.)

1. Create it in the dashboard. Name, region (nearest: Paris `eu-west-3`),
   database password — **write the password down**, it is only resettable.
2. Apply the three settings above, before pushing anything.
3. `supabase link` then `supabase db push`.
4. Paste `supabase/tests/grants_check.sql` into the SQL editor. Thirteen rows:
   twelve PASS and one INFO. Anything else, stop and read it — that table is
   the only thing that will tell you the platform behaved differently this
   time. Optionally also run `supabase/tests/expose_probe.sql`.
5. For a project that will hold real editor accounts, run the HTTP proofs too:
   `ALLOW_NON_LOCAL=1 SUPABASE_URL=… SUPABASE_ANON_KEY=… ./scripts/prove-rls.sh`

## Still to decide (stage 5, auth)

- Email confirmations: off locally (`config.toml`), which is what lets
  `create-test-users.sh` work. The hosted projects need a deliberate choice,
  and magic-link sign-in makes the question mostly moot.
- `site_url` and `additional_redirect_urls` in `config.toml` still point at
  `127.0.0.1:3000`. The hosted projects need the real editor-app origin, or
  magic links will redirect to localhost.

### Decide this BEFORE building the form

The editor area gives other people write access to a table whose contents are
committed to a **public** repository. That has not been true of any stage so
far, and it is much cheaper to decide now than after the form exists.

Site content can be corrected. Git history cannot. If an organizer types their
mobile number into an event's `body` — "renseignements au 06 …", which is an
entirely reasonable thing for them to write — it is world-readable from the
moment the next build commits `data/snapshot.json`, it stays in the history
after any correction, and **they will have no idea that happened.** They
consented to a public listing, not to a permanent public record.

Three ways out. Pick one deliberately; do not let the form ship having picked
none:

1. **Warn in the editor UI.** Cheapest. A line under the free-text fields
   saying what is published and that it cannot be unpublished. Relies on people
   reading it, which is a weak guarantee for someone else's phone number.
2. **Omit free-text fields from the snapshot.** Strongest. `body`,
   `price_note` and `location_address` are fetched at build time and rendered,
   but excluded from the committed file — the site still shows them, git never
   sees them. Costs the "snapshot IS the backup" property for exactly those
   fields, which is the real trade: they would then live only in Supabase, on
   the free tier, with thin backups.
3. **Accept it, in writing.** Legitimate if organizers are told plainly at
   sign-up. Not legitimate as a default nobody chose.

`npm run verify:build` already WARNS (not fails) when a free-text field looks
like it contains an email or a phone number, and points here. It warns rather
than fails on purpose: an organizer may have every right to publish a contact
address, and failing the build would decide this question by accident, which is
the one outcome this section exists to prevent.

## Free plan

Projects pause after **7 days** of inactivity and are restored **by hand** from
the dashboard. The ten-minute reconciliation poll in `workers/cron` reads the
database 144 times a day, which is what keeps production awake; that read runs
first on every invocation and is never skipped for a failing build, so a
fortnight of broken deploys costs a stale site rather than a paused database.

An empty second project pauses too, and the free plan allows two active
projects — so `nissartango-dev` either gets adopted (and polled, or manually
resumed when you want it) or deleted. Left as it is, it is a name that lies
and a slot that does nothing.
