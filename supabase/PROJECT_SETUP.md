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
`hjsekipqryfuwdkhxuks` real is `supabase link` + `db push`, then the content
step below.

### Seeding a HOSTED project — not `npm run seed:real`

**`npm run seed:real` cannot target a hosted project, and it will not tell you
so.** `scripts/seed-real.sh` calls `require_local`, which refuses anything but
loopback. The dangerous part is what happens when it does *not* refuse: if a
local stack happens to be running, the guard passes, the script seeds **local**,
prints its usual success, and the hosted project you meant stays empty. An
earlier version of this runbook said to run it against dev; it would have
silently done nothing to dev.

`data/initial-content.sql` says it itself, at the top of the file:

> NOT a migration. Migrations are schema; this is content, and it is run ONCE
> by hand against whichever project the public site builds from:
> Dashboard → SQL Editor → paste → Run. Safe to run twice: every insert is
> ON CONFLICT DO NOTHING.

So, for dev or any hosted project:

```bash
# either paste data/initial-content.sql into that project's SQL editor, or:
psql "$DEV_DB_URL" -f data/initial-content.sql
```

Both are the same thing; `psql` is preferable only because it leaves a record
in your shell history rather than in a browser tab. Idempotent either way.

**Do not reach for `ALLOW_NON_LOCAL=1`.** It exists, and it would technically
work — but `seed-real.sh` runs `db_clear_content` *before* applying the
content, so on a hosted project with real content that override is a five-second
countdown in front of a delete. It is there for a deliberate, considered
operation, not for seeding.

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

Measured with `supabase/tests/api_settings.sql` on 2026-09-09. The probe left
nothing behind on either project (`_api_settings_probe` count = 0 on both).

Production returned **six rows, all ok or info**. Note the file was corrected
after that run: `service_role_on_base_tables` had been counting the probe table
itself, so production's reported 6 against `anon`'s 5 was an artefact, not a
discrepancy. Both rows now share one definition of "base table" and both name
the exclusion in their detail, so a future reading of N is interpretable
against this one. Re-run to get a clean service_role figure.

| setting | `eqcgeqzzuzcwrflwasjo` (prod) | `hjsekipqryfuwdkhxuks` (dev) | wanted |
|---|---|---|---|
| Enable Data API | **on** (200 from `events_public`) | **on** | **on** |
| Automatically expose new tables | **off** — no entries | **ON** | **off** |
| Enable automatic RLS | **on** — new table `relrowsecurity=t` | **OFF** — `relrowsecurity=f` | **on** |
| New table's grants to `anon` | **none** — postgres and service_role only | **GRANTED — `anon=arwdDxtm`** | **none** |
| `anon` on base tables | **none**, over 5 base tables | not yet meaningful — no tables | **none** |

That production row is the one that matters, and it settles the
`alter default privileges` question empirically: the explicit
`revoke all on table … from anon, authenticated` statements in the stage-1
migrations removed everything a fail-open birth would have granted. The hazard
is real and this repo is already immune to it.

**A correction to my own prediction while these become the baseline.**
Production is fail-closed and yet its freshly created probe table still arrived
carrying `service_role`. So Supabase's fail-closed default revokes from `anon`
and `authenticated` but *keeps* `service_role` — which means my earlier claim
that "production has no service_role grants and dev will, so expect a diff" is
probably wrong: both projects will likely read every base table. That row is
informational precisely so a surprise there is read rather than trusted; the
first post-push comparison will say which of us is right. Do not record a
predicted number here — record the measured one.

Read that last dev cell carefully: `arwdDxtm` is not read access. It is insert,
update and delete. On that project today, any table created in `public` is
world-WRITABLE through the Data API until something revokes it.

The two projects were created 2h32m apart in the same organisation and differ
on all three settings. Whatever produced that, it is not something to reason
about from release dates — see below.

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

### What actually protects production — and it is not a checkbox

An earlier version of this file argued from Supabase's changelog: the
fail-closed default landed for new projects on 30 May 2026, both projects were
created on 28 August 2026, therefore both are fail-closed. **Measurement
contradicted it.** Dev is fail-open on all three settings. The inference was
wrong and is struck rather than softened; a release date tells you what a
default was, not what your project is.

**Two of the three travel in the repo. The third does not.** Measured on dev
before and after `supabase db push`:

| setting | before push | after push | who fixed it |
|---|---|---|---|
| `auto_expose_new_tables` | `ON` | `off` | `20260829090000_fail_closed_defaults.sql` |
| `new_table_grants_to_anon` | `GRANTED` | `none` | the same migration |
| `anon_privileges_on_base_tables` | no tables | `none` over 5 | the explicit `revoke all on table …` in stage 1 |
| **`automatic_rls`** | `OFF` | **still `OFF`** | **nothing in this repo** |

So `fail_closed_defaults.sql` sets default privileges and does **not** install
automatic RLS. Production's must have come from the platform, not from here.
An earlier version of this file said the protection travels in a migration;
that was two-thirds true and is corrected rather than softened.

#### Why the third one did not travel — and why it still should not be a migration

Supabase implements automatic RLS as a Postgres **event trigger**, not a
settings row. An earlier version of this section then argued that
`create event trigger` requires superuser, that the `postgres` role a migration
runs as is not one, and therefore that automatic RLS could never be versioned.
**Measured on both projects, that was false.** The migration role created and
dropped an event trigger without complaint, and production's `ensure_rls` is
owned by `postgres` — the very role migrations run as — not `supabase_admin`.
Whatever the general documentation says about superuser, it is not what these
projects do.

So automatic RLS *can* live in this repository. It just must not be a
**migration**:

**`supabase/ops/install-ensure-rls.sql` — production only, applied
deliberately.** A migration is applied to every project the repo is pushed to.
Putting `ensure_rls` there would install it on dev the next time anyone ran
`supabase db push`, and would kill the canary below on that day, silently,
because everything would still look green. Same shape and same reason as
`data/fold-accented-slugs.sql`: a recorded, re-runnable operation rather than
ad-hoc SQL typed into an editor.

```bash
psql "$PROD_DB_URL" -f supabase/ops/install-ensure-rls.sql
psql "$PROD_DB_URL" -f supabase/tests/api_settings.sql   # rls_event_triggers names ensure_rls
```

It is a **required step for any production project** and it now lives in the
repo rather than on a dashboard checklist — which is strictly better, because a
checklist item is a thing someone remembers and a file is a thing someone runs.
It is re-runnable: applying it twice reports `event trigger already present,
left alone`.

`api_settings.sql` measures both halves per project rather than arguing from
the general case, which is what caught the error above:

- **`rls_event_triggers`** — what is actually installed, with owner. Production
  shows `ensure_rls (O, owner postgres, on ddl_command_end)`; dev shows
  `pg_event_trigger is empty`.
- **`can_a_migration_install_automatic_rls`** — attempts it for real inside the
  rolled-back transaction and catches the exception. Reads `yes` on both
  projects. Its detail now points at the ops script, so the capability and the
  decision are read together.

**Practical consequence.** Every table in these migrations enables RLS
explicitly, so nothing here is unprotected today — automatic RLS is the safety
net for the table someone creates at 23:00 in six months and forgets. On a
project without it, that table is unprotected.

#### DECIDED: do not enable automatic RLS on dev. Keep the asymmetry.

Not an oversight, and not a to-do. Production has the net; dev deliberately
does not.

**Automatic RLS masks a defective migration.** A migration that creates a table
and forgets `enable row level security` is silently corrected by the event
trigger on production — the table ends up protected, the bug ships, and nobody
ever learns it was there. It stays latent until it reaches a project without
the net, which is the worst possible moment to discover it.

Dev has no net, so on dev that mistake is *visible*. That makes dev the only
place the migrations are actually tested rather than rescued.

This is why the projects differ, and the difference is load-bearing:

| | production | dev |
|---|---|---|
| automatic RLS | on, from the platform | **off, on purpose** |
| `rls_on_all_base_tables` passes because… | the event trigger enabled it | **the migrations said so** |

So the same assertion means two different things, and only one of them is a
test of this repository. If `rls_on_all_base_tables` ever fails on dev, a
migration forgot `enable row level security`. If it fails on **production**,
that is worse: it means the migration forgot *and* the event trigger is not
doing its job.

**Run it against production too, for a reason specific to how the trigger is
written.** `rls_auto_enable`'s exception handler swallows a failure to a
`raise log` line. So if `alter table … enable row level security` ever fails
inside it, the table is still created — unprotected — the DDL succeeds, and
nothing surfaces anywhere the application can see. Postgres logs are not
somewhere anyone looks on a free-tier project.

`rls_on_all_base_tables` is the only check that would ever notice that. On dev
it tests the migrations; on production it tests the net. Both are worth having,
and they are not the same test.

If someone later "fixes" dev by turning automatic RLS on, this test quietly
stops testing anything. That is the reason it is written down here rather than
left as a difference someone tidies away.

The one date still worth keeping: Supabase will **enforce** the fail-closed
default-privileges behaviour on all existing projects on **30 October 2026**.
That is the auto-expose half only; it says nothing about automatic RLS. Until
then a project can be born open, as dev was.

#### `alter default privileges` does not reach backwards

Worth knowing before pushing into a project born fail-open. Default privileges
apply at `CREATE TABLE` time. A table created earlier in the same push keeps
what it was granted then, and a later `alter default privileges ... revoke`
does not touch it. Demonstrated:

```
[t1] create public.events         -> anon=arwdDxt/postgres        (fail-open project)
[t2] alter default privileges revoke
     public.events acl NOW        -> anon=arwdDxt/postgres        unchanged
[t3] create public.later          -> none                          only new tables are clean
```

What saves this repo is that every stage-1 migration also does an explicit
`revoke all on table ... from anon, authenticated`. That is why those lines
exist and why they must not be tidied away as redundant — against a fail-open
project they are the only thing that removes the grant.

### Rehearse on dev, always

`api_settings.sql` is read-only and rolls back, and it is still DDL. Run it on
`hjsekipqryfuwdkhxuks` FIRST — see the six rows, confirm the probe table is
gone — and only then on production. An empty project is where "left behind"
costs nothing, and this file exists precisely because the thing that has been
right every time is rehearsing before touching the database that is serving.

### After `supabase db push`, re-run the probe on that project

**This is a step, not an assumption.** Dev is fail-open today. The claim that
the migrations fix that is a claim, and it is cheap to test:

```bash
psql "$DEV_DB_URL" -f supabase/tests/api_settings.sql
```

All of these should flip to fail-closed:

| row | before the push | after |
|---|---|---|
| `auto_expose_new_tables` | `ON` | `off` |
| `automatic_rls` | `OFF` | `on` |
| `new_table_grants_to_anon` | `GRANTED` | `none` |
| `anon_privileges_on_base_tables` | `NO BASE TABLES` | `none` |

**If they do not, the migration is not doing what we think it is** — stop and
say so, rather than pushing the same thing at production.

Two rows need reading rather than glancing at:

- `anon_privileges_on_base_tables` is the one that actually matters here, and
  before the push it reports `NO BASE TABLES <-- nothing was checked` rather
  than a comfortable `none`. That is deliberate: an empty schema would
  otherwise pass this assertion as happily as a correct one.
- `service_role_on_base_tables` will read a non-zero count on dev and `0` on
  production, and that difference is **expected and benign**. A fail-open
  project grants service_role at table creation; the stage-1 revokes name only
  `anon, authenticated`, so the grant stays. Nothing in this project uses the
  service_role key, and it bypasses RLS regardless. It is reported as
  information, not a verdict, so the dev/prod diff reads as explained.

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

**Dev pauses, and nothing wakes it.** The poller only ever touches production —
that is the whole design, one project read every ten minutes — so
`nissartango-dev` goes to sleep after 7 idle days and needs a **Restore** click
in the dashboard whenever you come back to it. It paused once already and was
restored by hand on 2026-09-09. Expect that, budget the minute for it, and do
not read a connection failure against dev as a broken migration.

Deliberately not fixed by pointing the poller at both: a keep-alive for dev
would mean a Worker reading a project the site does not build from, which is
the exact confusion the project-ref guard exists to catch.
