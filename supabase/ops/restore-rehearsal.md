# Deliverable 1 — restore rehearsal sequence

Every command Dimuthu runs, with the output expected **before** he runs it.
Nothing here has been executed. Paste raw output back, not summaries.

Intended home once approved: `supabase/ops/restore-rehearsal.md`, with the
reasoning notes folded into the ops file's header.

## What this sequence does not yet have

`supabase/tests/content_inventory.sql` **is written** and ships alongside this
file. Drop it into `supabase/tests/` before running anything; nothing here works
without it. What it asserts:

- `set local timezone = 'UTC'` pinned at the top, because `content_checksum`'s
  own header documents that a whole-row digest renders `timestamptz` in the
  session's zone. Two psql sessions must not be able to disagree for a reason
  that is not content.
- One row per base table: `events`, `event_exceptions`, `organizers`,
  `organizer_members`, `user_roles` — each with `count(*)` and an md5 over
  whole rows ordered by primary key.
- A **column signature** per table alongside it: an md5 over (column_name,
  data_type/udt_name, is_nullable) ordered by `ordinal_position`, plus a second
  section spelling the columns out. Without it a DIFFERENT is undiagnostic — it
  says something differs, not whether the schemas or the data differ. Ordered by
  position rather than name because `t::text` renders columns in table order, so
  a reordering changes `rows_md5`; sorted by name, `cols_md5` would match and
  the mismatch would again be undiagnostic.
- Five tables hard-coded rather than discovered from `pg_class`, because a table
  in public that no migration created is a finding, and a self-updating
  inventory would absorb it silently.
- Base tables, not the `_public` views. The views are approved-only; a
  view-based inventory would report a perfect match while every pending and
  rejected row was missing from the backup.
- Read-only, no DDL, so it is safe against production and legal for
  `compare-projects.sh`, which refuses anything outside `supabase/tests/`.

Two more files ship with this one and go in `supabase/ops/`:
`filter-content-dump.sh` and `restore-content.sql`. Read both before E1b.

Still to write: the storage object-sync script for deliverable 1b.

## Conventions

psql flags match `compare-projects.sh`: `-X` so nobody's `~/.psqlrc` can change
the output, `-A -F'|'` unaligned, `-v ON_ERROR_STOP=1`.

Connection strings: **session pooler** by default per Supabase's restore guide;
the direct string only if the ISP does IPv6. The password must be
percent-encoded for `supabase db dump`.

---

# Phase A — preflight, no writes anywhere

## A1. Tooling

```bash
docker --version
supabase --version
command -v psql || echo "PSQL MISSING — STOP"
psql --version
```

**Expect:** a Docker version line (OrbStack provides the socket), a Supabase CLI
version, a path to `psql`, and a psql version.

**If `psql` is missing: stop.** `brew install libpq`, then put it on PATH. This
is not a convenience. `compare-projects.sh` opens with
`command -v psql >/dev/null || die`, and `scripts/_db.sh` records that the
Supabase CLI does not install psql, so a clean Mac does not have it. Without
psql, C1, F1 and F2 cannot run — and F1 is the deliverable. Do not proceed to
the dump on the reasoning that the dump is the important part.

`supabase db dump` runs pg_dump inside a container from the Supabase Postgres
image, which is why the psql/libpq version on the machine does not gate the
dump.

**The reason for preferring it is narrower than the previous draft claimed, and
A5 is what narrowed it.** Production is PostgreSQL 17.6 and the local
psql/pg_dump is 18.6. pg_dump 18 dumps a 17 server fine, so the "pg_dump must be
>= the server version" half of the old rationale does not apply here — a local
`pg_dump` would have run. What remains is drift: Homebrew moves the local
pg_dump whenever anything upgrades it, so two dumps taken months apart can come
from different pg_dump versions without anyone choosing that. The CLI pins the
version to the image, so the dump is reproducible. That narrower reason is the
one that goes in the ops file; the version-floor claim should not, because it is
false on this project today.

**If Docker is not running:** start OrbStack and re-run. Do not substitute
`pg_dump`.

## A2. Credentials into the environment, not into history

```bash
read -rs PROD_DB_URL; export PROD_DB_URL
read -rs DEV_DB_URL;  export DEV_DB_URL
```

**Expect:** no output at all, twice.

## A3. Confirm the two URLs name the two projects

Uses the same regex `compare-projects.sh` uses to label its columns, so if this
prints nothing the harness would also fail to label.

```bash
printf '%s\n' "$PROD_DB_URL" "$DEV_DB_URL" \
  | sed -nE 's#.*postgres\.([a-z]{20}).*#\1#p; s#.*://[^@]*@db\.([a-z]{20})\..*#\1#p'
```

**Expect exactly two lines, in this order:**

```
eqcgeqzzuzcwrflwasjo
hjsekipqryfuwdkhxuks
```

**If one line, or the same ref twice, or the order is reversed: stop.** Every
later step points one of these at production.

## A4. Dev is awake

```bash
psql -X -q --pset=pager=off -At "$DEV_DB_URL" -c 'select current_database(), now()'
```

**Expect:** `postgres|2026-09-16 ...`

**If it hangs and then fails to connect:** dev has paused after 7 idle days and
nothing wakes it. Click Restore in the dashboard, wait for it to come up, and
re-run. This is not a broken migration and not a credentials problem.

## A5. Production reachable, read-only

```bash
psql -X -q --pset=pager=off -At "$PROD_DB_URL" -c 'select current_database(), current_user, version()'
```

**Expect:** `postgres|postgres|PostgreSQL <major>.<minor> ...`

Record the server major version in the paste. It is the number that decides
whether a local `pg_dump` would have worked, and therefore the evidence behind
A1's note.

## A6. Dev and production have the same migrations applied

**Load-bearing. Nothing else in this sequence establishes it.** B3 assumes five
tables exist on dev; PROJECT_SETUP describes dev both as "empty. No migrations"
and as having been measured before and after a `db push`, and those cannot both
be current.

```bash
for u in "$PROD_DB_URL" "$DEV_DB_URL"; do
  echo "--- $(printf '%s' "$u" | sed -nE 's#.*postgres\.([a-z]{20}).*#\1#p; s#.*://[^@]*@db\.([a-z]{20})\..*#\1#p') ---"
  psql -X -q --pset=pager=off -At "$u" -c 'select version from supabase_migrations.schema_migrations order by 1'
done
```

**Expect each project to print exactly these eight versions, in this order:**

```
20260828181000
20260828181100
20260828181200
20260828190000
20260828190100
20260828190200
20260829090000
20260831120000
```

**If dev prints fewer: stop.** `supabase db push` against dev is its own step
with its own paste, not something folded silently into this one. Push it, re-run
this command, paste both.

**If dev prints more, or a version production does not have: stop and tell me.**

An identical list does **not** mean the two projects are identical, and must not
be read that way. `supabase/ops/install-ensure-rls.sql` is applied to production
and deliberately not to dev, and being outside `supabase/migrations/` it never
appears here. That asymmetry is intended and is what makes dev a canary.

Where it is actually asserted is `api_settings.sql` — its `rls_event_triggers`
row reports `ensure_rls` on production and an empty `pg_event_trigger` on dev,
and its `can_a_migration_install_automatic_rls` row points at the ops script, so
the capability and the decision read together. **This sequence does not run
`api_settings.sql`**: it is DDL, and the standing rule is dev automatically,
production only with `--prod-ddl`. A second assertion built here would put the
same fact in two files that can disagree. What the ops file should record is
when `api_settings.sql` was last run against production, not that it exists.

Why this gate exists: if dev's schema differs from production's by one column,
a whole-row md5 differs for structural reasons, F1 reads DIFFERENT forever, and
the available fix is loosening `content_inventory.sql` — the exact failure F1's
own note warns against, arriving through a door the sequence would otherwise
leave open. `content_inventory.sql`'s `cols_md5` and its Section 2 make that
case announce itself rather than be inferred, but announcing it late is worse
than refusing to start.

## A7. The backup repo exists and is private

Create it, clone it, then assert. A6 in the previous draft asserted against a
repo nothing created, and Phase H ran `git` in a directory that `mkdir -p` had
made and nothing had initialised.

```bash
gh repo create dimuthu-wije/nissartango-backups --private
gh repo clone dimuthu-wije/nissartango-backups ~/nissartango-backups
```

**Expect:** a created-repo line naming the new repo, then a clone into
`~/nissartango-backups` — which will warn that it is empty. That warning is
correct.

**If the repo already exists,** `gh repo create` fails saying so. That is fine:
skip to the clone, and the assertion below is what matters.

Then the gate, which is the part that actually protects anything:

```bash
gh repo view dimuthu-wije/nissartango-backups --json isPrivate,visibility
```

**Expect:** `{"isPrivate":true,"visibility":"PRIVATE"}`

**If it prints `false`: stop.** Nothing gets pushed until this is true. The
repo's visibility is load-bearing in the same register
as the automatic-RLS asymmetry between the two projects: a private repo made
public by accident republishes, in one click, everything the free-text decision
was taken to prevent. That sentence goes in the ops file verbatim.

It is worse than that sentence implies, and the ops file should say so.
`public.organizers` carries `email` and `phone`, both commented "PRIVATE. Never
exposed to anon", both absent from `organizers_public`. A `--schema public` dump
contains them. So this repo holds contact details that have never been public
anywhere, not merely content that was public and is being withdrawn. One
accidental visibility flip publishes them.

**If `gh` is not installed:** all three commands above need it, not just the
assertion. Create the repo in the browser, set it private at creation time
rather than after, `git clone` it to `~/nissartango-backups` over SSH or HTTPS,
then open the repo's settings page and confirm it reads Private. Record the
date, and who checked, in the ops file. A checkbox nobody can verify from the
repo is exactly what `OPERATIONS.md` exists for.

## A8. Run `content_inventory.sql` standalone, before anything depends on it

**First, the static sweep.** `supabase/ops/check-sql-patterns.sh` greps the ops
and test SQL for two mistakes that have each been fixed in one file and left
broken in another — an `ORDER BY ... COLLATE` after a set operation, and a psql
variable inside a dollar-quoted block. Both parse cleanly and fail only on a
live server, and both have already cost a step this week.

```bash
./supabase/ops/check-sql-patterns.sh
```

**Expect:** `clean` under both checks, exit 0. It reaches no database and takes
no arguments, so there is no reason not to run it before every sitting.

**If it flags anything: fix it, then run it again**, because the recurring
fault is not the bug but the fix that reached one call site and not the others.

**This file has never been run.** C1 would be its first invocation, and C1 runs
it inside `compare-projects.sh` — so a SQL error would arrive as a confusing
harness failure at the step whose job is to establish a baseline. This repo has
already paid for that once: `check-db.sh` exists because `grants_check.sql`
carried a stale expectation for eleven days, because nobody ran it. A test
nobody runs is not coverage, it is a file that describes an intention.

Dev first, then production. It is read-only and rolls back, so production needs
no rehearsal gate — that is the distinction its header draws against
`api_settings.sql`, which is read-only but does its work as DDL.

```bash
psql -X -q -A -F'|' --pset=footer=off --pset=pager=off -v ON_ERROR_STOP=1 \
     -f supabase/tests/content_inventory.sql "$DEV_DB_URL"
psql -X -q -A -F'|' --pset=footer=off --pset=pager=off -v ON_ERROR_STOP=1 \
     -f supabase/tests/content_inventory.sql "$PROD_DB_URL"
```

**Expect from each:** five Section 1 rows —
`event_exceptions|events|organizer_members|organizers|user_roles` in that order,
each with `n_rows`, `rows_md5`, `cols_md5` — then the Section 2 column listing.
Dev's counts all `0`; production's non-zero. No errors, no warnings.

**Watch for one thing specifically.** Section 2 orders by
`c.table_name::text collate "C"`. `information_schema.columns.table_name` is
the domain `sql_identifier` over `name`, and `name` only became collatable in
PG12; the cast removes that dependency rather than relying on it. If this still
errors with something about collations not being supported, paste it — the fix
is mine, not yours.

**If either run errors: stop.** Do not proceed to C1 and read the harness
failure as a project difference.

---

# Phase B — the two privilege probes

Both run on **dev**, both inside a transaction that rolls back, same discipline
as `api_settings.sql`. Measure, do not cite. If either fails, say so and stop —
do not fall back to a throwaway schema.

## B1. Can triggers be disabled during the load?

```bash
psql -X -q --pset=pager=off -At -v ON_ERROR_STOP=1 "$DEV_DB_URL" <<'SQL'
begin;
set local session_replication_role = replica;
select current_setting('session_replication_role');
rollback;
SQL
```

**Expect:** `replica`

**Expect on failure:** `ERROR: 42501: permission denied to set parameter
"session_replication_role"`

Supabase's own restore guide uses this setting to disable triggers during a
migration, so it is likely to work — but it needs privileges the `postgres`
role on a given project may not have, and "the docs say so" is not a
measurement. If it fails, the restore op uses
`alter table public.<t> disable trigger user` per table instead, which needs
table ownership rather than superuser. The ops file records which of the two
was used and why, so the next person does not re-litigate it.

This matters because `t30_event_exceptions_flag_parent` is
`after insert or update or delete on public.event_exceptions` and updates the
parent event, which fires `t30_events_flag_review` and
`t40_events_set_updated_at` on `events`. Load exceptions with triggers live and
the restored `needs_review` and `updated_at` are not the values that were
backed up.

## B2. Can we write synthetic rows into `auth.users`?

The `auth` schema is owned by `supabase_auth_admin`, not `postgres`.

```bash
psql -X -q --pset=pager=off -At -v ON_ERROR_STOP=1 "$DEV_DB_URL" <<'SQL'
begin;
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-00000000dead',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'probe@invalid.test');
select count(*) from auth.users where id = '00000000-0000-4000-8000-00000000dead';
rollback;
SQL
```

**Expect:** `1`

Then the same insert **with `email` omitted entirely**, in its own rolled-back
transaction. Run them in that order — populated first, null second — so a
failure distinguishes "cannot write `auth.users` at all" from "cannot write a
row without an email". GoTrue's `auth.users.email` is nullable, since phone-only
accounts exist, so the second form should pass.

The second form is the one that matters: the synthetic rows the restore writes
carry no email, so that is what has to clear. If only the first form works, the
fix is the template in `filter-content-dump.sh` and nowhere else.

**Three distinguishable failures, and they mean different things:**

- `ERROR: 42501: permission denied for table users` — `postgres` cannot write
  `auth.users` on this project. **Stop and tell me.** The rehearsal target does
  not silently become a throwaway schema; routing around the FK topology is the
  same mistake as automatic RLS on dev.
- `ERROR: 23502: null value in column "<x>" violates not-null constraint` — we
  can write, the column list is just short. Not a stop. Re-run with the named
  column added and paste both attempts.
- `ERROR: 42703: column "<x>" of relation "users" does not exist` — the GoTrue
  schema differs from what I assumed. Paste it; I adjust the column list.

## B3. What is in dev now

Not "dev is actually empty". **A8 already measured that it is not**: dev holds
4 events, 3 organizers and 1 event_exception, with `event_exceptions` and
`events` differing from production's. Non-empty is the **expected** state on a
first run, not an anomaly. The previous draft's stop condition here was written
before that was known and would have ended the sitting for a condition the next
step handles.

**Two things from A8 to carry into this step.** `organizer_members` and
`user_roles` showed `d41d8cd98f00b204e9800998ecf8427e` on both projects — md5 of
the empty string, the 0-row path, not agreement about content. And `organizers`
matched *exactly*, 3 rows, same digest, which two independent runs of
`data/initial-content.sql` cannot produce: `id` defaults to `gen_random_uuid()`
and both timestamps to `now()`. Those rows moved between the projects by some
path. Unresolved, not blocking — B4 truncates dev either way — but worth knowing
while building the sanctioned path for moving exactly this data.

What A8 did **not** measure is `auth.users`, which `content_inventory.sql` does
not cover. That is the one unknown this step resolves.

```bash
psql -X -q -A -F'|' --pset=footer=off --pset=pager=off "$DEV_DB_URL" -c \
"select 'auth.users', count(*) from auth.users
 union all select 'events', count(*) from public.events
 union all select 'organizers', count(*) from public.organizers
 union all select 'organizer_members', count(*) from public.organizer_members
 union all select 'user_roles', count(*) from public.user_roles
 union all select 'event_exceptions', count(*) from public.event_exceptions
 order by 1"
```

**Expect:** `auth.users 0`, `event_exceptions 1`, `events 4`,
`organizer_members 0`, `organizers 3`, `user_roles 0` — matching A8's dev
column, plus the auth.users line A8 could not see.

**If `auth.users` is non-zero: stop and tell me.** Real accounts exist on dev,
and both the synthetic-identity design and the teardown's final assertion assume
they do not. That is a finding, not a state to clear.

**If the five content counts differ from A8's: stop.** Something wrote to dev
between A8 and now, which matters more than what it wrote.

## B4. Clear dev before the rehearsal, not only after

**This discards dev's current content.** It is recoverable —
`data/initial-content.sql` reloads it — and dev is the disposable project by
design. Confirm that before running this, not after.

Same file as the teardown at Phase G, run with an empty uuid list because
nothing synthetic exists yet. Running it at both ends means the teardown has
been rehearsed by the time it matters, rather than being the one step in this
sequence that has never executed when it is needed.

```bash
psql -X -q -v ON_ERROR_STOP=1 --pset=pager=off \
     -v uuidlist="" \
     -f supabase/ops/teardown-dev-rehearsal.sql "$DEV_DB_URL"
```

**Expect, and note what is NOT there:**

```
NOTICE:  teardown: clearing 8 content row(s) across 5 tables
NOTICE:  teardown: deleted 0 synthetic auth.users row(s)
NOTICE:  teardown ok: auth.users is empty
```

then the six-row counts table, every count `0`.

**There will be no `TRUNCATE TABLE`, no `DELETE 0` and no `COMMIT` line.** Those
are command tags and `psql -q` suppresses them; NOTICEs go to stderr and survive.
Their absence is expected and is not evidence that the statements were skipped —
the notices are what carry that, which is why the counts are raised rather than
implied. Measured at B4 on 2026-09-17: the tags were absent, the notices were
not.

The first notice should say 8 — 4 events, 3 organizers, 1 event_exception, from
B3. The second should say 0 while no organizer has signed up.

**If it fails, dev should be untouched — check that, do not assume it.** The
whole file is one transaction, so any error rolls the truncate back. That is a
claim `restore-content.sql`'s header makes about itself too, and nothing in this
sequence verified it until now. On a B4 failure, **re-run B3** before doing
anything else.

**Expect after a failed B4:** B3 prints exactly what it printed the first time —
`auth.users 0`, `event_exceptions 1`, `events 4`, `organizer_members 0`,
`organizers 3`, `user_roles 0`. Anything else means the rollback did not hold,
which is a much larger finding than whatever caused the failure.

This actually happened on 2026-09-17: B4 aborted on a malformed `ORDER BY` in
the final SELECT, and dev was left intact. The failure was free evidence for the
transactional claim that E2 depends on — the one that makes a failed restore
safe to retry.

## B5. Confirm dev is empty

Re-run B3's command.

**Expect:** six lines, every count `0`. Paste it.

**If anything is non-zero: stop.** Now this genuinely is an anomaly — B4 claimed
to have emptied it.

## B6. The uuid set on production

Moved here from Phase D. It reads production, not dev, so it does not depend on
anything above — and its answer decides whether the zero-uuid paths in
`filter-content-dump.sh` and the teardown are the live path or dead code. Better
to know that now than at E1b.

```bash
psql -X -q -At --pset=pager=off "$PROD_DB_URL" -c \
"select distinct user_id from public.organizer_members
 union select distinct user_id from public.user_roles
 union select distinct created_by from public.events where created_by is not null
 order by 1"
```

**Expect: no output at all.** `organizer_members` and `user_roles` are both
empty on production as of A8, and `events.created_by` defaults to `auth.uid()`,
which is null in the SQL editor where `initial-content.sql` was pasted. So the
dump should reference `auth.users` zero times.

**If uuids come back:** they are not secrets and go in the paste; the matching
email addresses are read from the dashboard by hand and never printed here. The
zero-case branches then go quiet on their own and E1b's `synthetic_uuids` should
equal this count.

**Either way this is a cross-check, not the source.** The synthetic rows are
derived from the dump at E1b, because the dump is what gets restored. If the two
counts disagree at E1b, production moved in between, and D2's pin will say so.

---

# Phase C — baselines, before anything is written

Both of these are run **before** the restore so that the post-restore result is
a transition you watched rather than a state you found.

## C1. Content inventory baseline

```bash
./scripts/compare-projects.sh supabase/tests/content_inventory.sql "$DEV_DB_URL" "$PROD_DB_URL"
```

**Expect:** `DIFFERENT — hjsekipqryfuwdkhxuks vs eqcgeqzzuzcwrflwasjo`, exit
status 1, with every dev count at 0 and prod's counts non-zero.

**Expected prod counts, measured at D1 on 2026-09-17:** `organizers` = 3,
`events` = 4, `event_exceptions` = 1, `organizer_members` = 0, `user_roles` = 0.

**All four events are `approved`.** No `pending` and no `rejected` row exists,
and — since `status` defaults to `pending` and only the SECURITY DEFINER
functions move it — none ever has. The status transitions have never run in
production outside a test.

**If any count differs from those, stop and paste it.** These are no longer
estimates.

## C2. Grants canary baseline, saved to a file

```bash
./scripts/compare-projects.sh supabase/tests/grants_check.sql "$DEV_DB_URL" "$PROD_DB_URL" \
  > /tmp/grants-before.txt 2>&1; echo "exit=$?"
cat /tmp/grants-before.txt
```

**Expect `IDENTICAL`**, exit 0, and 13 assertion rows — 12 PASS and 1 INFO.

Measured 2026-09-17, on the first run this comparison has ever had. Note that
this **contradicts `PROJECT_SETUP.md`**, which predicted a non-empty diff on the
grounds that the two projects took different paths to the same migrations. They
did, and it made no difference to what `grants_check.sql` checks: that file
reads the *result* of explicit `revoke` and `grant` statements, and those
converge on the same end state regardless of arrival order. That paragraph wants
correcting rather than softening.

**If it prints `DIFFERENT`: stop and paste it.** That would be a change since
2026-09-17, on a comparison whose baseline is now known to be clean — which is a
much stronger signal than it was when a diff was expected anyway.

Whatever it prints is the baseline; the assertion is made in F2, that this
output is **unchanged** by the restore.

---

# Phase D — measure production, still read-only

## D1. Status breakdown, the image hazard, and the 31 August row

```bash
psql -X -q -A -F'|' --pset=footer=off --pset=pager=off "$PROD_DB_URL" <<'SQL'
select status, count(*) from public.events group by status order by 1;
select count(*) as events_with_image from public.events where image_path is not null;
select id, slug, status, needs_review, updated_at
  from public.events where needs_review order by updated_at;
SQL
```

**Measured 2026-09-17.** Status breakdown: `approved|4`, and nothing else —
every production event is approved, so no `pending` or `rejected` row exists and
none ever has. `events_with_image` = **0**. One `needs_review` row,
`2026-08-24-milonga-precedee-d-une-practica-jeudi-c-est-permis-a-la-casita`,
`approved`, `updated_at 2026-08-31 10:32:10+00`.

Re-run it anyway before the dump — these are the numbers the rest of the
sequence is pinned to, and a change since would matter more than the numbers
themselves.

`events_with_image = 0` is what keeps deliverable 1b latent rather than urgent.
`fetch-content.mjs` calls `die()` on any non-ok image download, so a
content-only restore of a row with a non-null `image_path` produces a database
the site cannot be built from at all — not a site with a broken image. That
hazard activates the moment the editor accepts its first upload, which is this
stage.

**If `events_with_image` is not 0: stop and tell me.** 1b is urgent today and
this sequence is in the wrong order.

**If more than one row has `needs_review`:** there is more in the queue than the
one known row, and the approval queue's first screen has a different shape.

**The queue opens against an empty backlog.** One `needs_review` row, no pending
submissions, and status transitions that have never run outside a test — worth
carrying into deliverable 3, because the first real transition will be the first
time that trigger path executes against live data.

## D2. The uuid set — moved to B6

This step used to live here. It reads production and its answer changes which
code paths are live, so it now runs at **B6**, early, rather than after the
baselines. Nothing to do at this position.

If B6 has not been run, run it before D3.

## D3. Pin production, immediately before the dump

F1 compares dev — restored from a dump taken at E1 — against production **as it
is at F1**. Between the two sit a possible dashboard Restore click, at least one
stop-and-ask, and a production that the ten-minute poller and the 03:15 rebuild
are both watching. A legitimate content change in that window produces
DIFFERENT, and F1 has pre-committed to reading DIFFERENT as "triggers fired
during the load": a misdiagnosis with a plausible story attached.

So take a reading of production alone, now, and another after F1.

```bash
PGOPTIONS='--client-min-messages=warning' \
psql -X -q -A -F'|' --pset=footer=off --pset=pager=off -v ON_ERROR_STOP=1 \
     -f supabase/tests/content_inventory.sql "$PROD_DB_URL" \
  | sed -e 's/[[:space:]]*$//' > /tmp/prod-before.txt
wc -l /tmp/prod-before.txt && head -6 /tmp/prod-before.txt
```

The flags and the trailing-whitespace `sed` match what `compare-projects.sh`
does internally, so `/tmp/prod-before.txt` is comparable with the runs either
side of it.

**Expect:** a line count, then the five Section 1 rows — `event_exceptions`,
`events`, `organizer_members`, `organizers`, `user_roles` — with counts matching
C1's production column.

Not `content_checksum` for this. It covers approved rows only, and a pending row
changing is exactly the kind of movement this needs to catch.

**Run E1 immediately after this, in the same sitting.** The value of the pin
decays with every minute between the two.

---

# Phase E — dump, then restore

## E1. Dump production

```bash
mkdir -p ~/nissartango-backups && cd ~/nissartango-backups
supabase db dump --db-url "$PROD_DB_URL" \
  -f "content-$(date -u +%Y%m%dT%H%M%SZ).sql" \
  --data-only --use-copy --schema public
```

**Expect:** container start messages, a line about dumping data from the remote
database, exit 0, and a file. **Expected size: single-digit KB** for four events
and three organizers.

**If it is under ~1 KB, it is not a backup.** Verify rather than assume:

```bash
ls -l content-*.sql
grep -cE '^COPY +"?public"?\.'        content-*.sql
grep -nE '^COPY +"?public"?\.'        content-*.sql
grep -cE '^COPY +"?(auth|storage)"?\.' content-*.sql
grep -nE 'session_replication_role|^\\restrict|^\\unrestrict' content-*.sql
head -40 content-*.sql
```

**Expect:** `5` public COPY blocks — `events`, `event_exceptions`,
`organizers`, `organizer_members`, `user_roles` — and **`0`** auth COPY blocks.

**Grep for the quoted form.** Measured 2026-09-17: `supabase db dump` quotes
every identifier, so a real dump's headers read
`COPY "public"."organizers" ("id", "name", ...) FROM stdin;` and
`grep -c '^COPY public\.'` returns **0**, not 5. Use
`grep -cE '^COPY +"?public"?\.'` instead. The old unquoted-only pattern returned
0 for `auth` too, which looked like a pass and was luck.

**Expect line 1 to be `SET session_replication_role = replica;`.** pg_dump does
its own trigger handling. E1b strips it and reports the count;
`restore-content.sql` owns that setting instead, because if probe B1 came back
`insufficient_privilege` the dump's own line would abort the restore on its
first statement with no fallback.

**Expect a `\restrict <token>` line near the top and `\unrestrict` near the
end** on pg_dump 17.6 and later. Grep for them and say whether they are live or
commented. `restore-content.sql` no longer depends on the answer — no psql
meta-command follows `\i :dumpfile` — but the dump's shape is worth recording.

`0` auth blocks is the measured confirmation that the identity map genuinely has
to live outside this file: `supabase db dump` excludes Supabase-managed schemas,
`auth` among them.

Five is exact, not approximate — those are the only five base tables created in
public across all eight migrations. **Fewer than 5 means a table was excluded and
the backup is incomplete.** **More than 5 cannot arise from anything in this
repo**, so it means a table exists in public that no migration created: stop,
paste `grep -n`, and treat it as a finding about the project rather than about
the dump.

`head -40` is not optional: the restore op wraps this file in a transaction and
I will not write a wrapper around a file whose contents nobody has read. If the
dump carries its own transaction control or its own `session_replication_role`
line, the wrapper changes. **Paste those 40 lines before running E2.**

## E1b. Filter the dump before it can reach dev

```bash
./supabase/ops/filter-content-dump.sh ~/nissartango-backups/content-<ts>.sql
```

**Expect on stderr:** the stripped `session_replication_role` line quoted with
its line number, then `stripping 1 session_replication_role line(s)`, then
`copy_blocks=5`, `stripped_srr_lines=1`, `organizer_rows_seen=1`,
`redacted_email_values=<n>`, `redacted_phone_values=<n>`,
`synthetic_uuids=<n>` — then on stdout the two output paths and
`verified: organizers block examined, no email or phone value survives`.

**`copy_blocks=5` is asserted before anything else is believed.** If it is not
5 the script refuses, deletes both outputs and exits non-zero. That guard exists
because of what happened on 2026-09-17: the COPY pattern did not match a real
dump, nothing was examined, and the post-check — which asked "did a bad value
survive?" — answered no and printed success over a file it had never looked
inside. Every absence-based check answers "nothing found" when nothing was
examined, so the count of things examined has to be asserted first and
positively.

**Nothing survives a failure.** A trap removes both outputs on any non-zero
exit, so there is never a half-filtered file on disk to point psql at.

**Expect `synthetic_uuids` to equal B6's count** — `0` on today's data.

**Note the asymmetry, because it is the point:** the **unfiltered** dump is what
gets committed to the private repo at Phase H. A backup with the contact details
stripped out would not be a backup. Only the copy that touches dev is filtered.

## E1c. Prove the backup itself is complete

The filter is what makes F1 stop expecting IDENTICAL. So the completeness of the
backup has to be proved somewhere else — against the **dump file**, not against
dev. Counts only; no values printed and none pasted, the same discipline as D2.

```bash
DUMP=~/nissartango-backups/content-<ts>.sql
awk '
  /^COPY +"?public"?\."?organizers"? *\(.*\) +FROM stdin;$/ {
    cols=$0; sub(/^[^(]*\(/,"",cols); sub(/\) +FROM stdin;$/,"",cols)
    gsub(/"/,"",cols); gsub(/ /,"",cols)
    n=split(cols,c,","); for(i=1;i<=n;i++) idx[c[i]]=i
    found=1; incopy=1; next }
  incopy && /^\\\.$/ { incopy=0; next }
  incopy { rows++; split($0,f,"\t")
           if (f[idx["email"]] != "\\N") e++
           if (f[idx["phone"]] != "\\N") p++ }
  END {
    if (!found) { print "REFUSING: no organizers COPY block matched" > "/dev/stderr"; exit 2 }
    printf "organizer_rows_parsed=%d\ndump_email=%d\ndump_phone=%d\n", rows+0, e+0, p+0
  }' "$DUMP" || echo "E1c FAILED — do not read the counts above as zero"

psql -X -q --pset=pager=off -At "$PROD_DB_URL" -c \
"select 'prod_email=' || count(*) filter (where email is not null)
     || E'\nprod_phone=' || count(*) filter (where phone is not null)
     || E'\nprod_rows='  || count(*)
   from public.organizers"
```

**Expect:** `dump_email` = `prod_email` and `dump_phone` = `prod_phone`, and
both to match `redacted_email_values` / `redacted_phone_values` from E1b.

**If the dump counts are lower: stop.** The backup is missing contact details
that production holds, and no amount of agreement at F1 would have revealed it —
F1 compares dev against production, and dev is not supposed to have them.

## E2. Restore into dev

**One consequence, ruled on and implemented rather than left open.**
`public.organizers` carries `email` and `phone`. A faithful restore would load
real contact details into dev — the deliberately fail-open project, on the free
tier, with automated daily backups that a teardown truncate does not reach. So
the dump is filtered at E1b and those values never touch dev's storage or its
WAL.

`--exclude-table-data` was rejected: it drops the whole table and takes the FK
topology with it, and the FK topology is the part of a real restore most likely
to break. A post-load `UPDATE` was rejected: it commits the values first and
nulls them second.

The cost is paid at F1, visibly. The weakening is documented and reversible;
PII in dev's automated backups is neither.

```bash
psql -X -q --pset=pager=off -v ON_ERROR_STOP=1 \
     -v replica=on \
     -v synthetic="$HOME/nissartango-backups/content-<ts>.synthetic.sql" \
     -v dumpfile="$HOME/nissartango-backups/content-<ts>.filtered.sql" \
     -f supabase/ops/restore-content.sql "$DEV_DB_URL"
```

**Use `$HOME` or an absolute path, not `~`.** Bash does not reliably expand a
tilde after `=` in a non-assignment argument like `-v synthetic=~/path`, and
psql's `\i` does no tilde expansion of its own — so a `~` would arrive at `\i`
literally and fail at the step that costs the most to redo. E1b and E1c can use
`~` safely: there it is a command argument and an assignment respectively, both
of which bash does expand.

`-v replica=on` if B1 succeeded; `-v replica=off` if it failed with
`insufficient_privilege` and the per-table branch is needed.

**Expect, in order:** a `method` line naming the trigger approach; then

```
NOTICE:  assertion 1 ok: organizers.email and .phone are entirely null
NOTICE:  assertion 2 ok: all six foreign keys resolve
```

then the six-row loaded-counts table including `auth.users`, then a `restored`
line.

**The counts table is where you check the load, not the `COPY` tags.** An
earlier draft expected `COPY 4` / `COPY 3` per table; `psql -q` suppresses
command tags, so those never appear, and neither does `COMMIT`. Compare the
counts table against C1's production column instead — it is a SELECT, so it
prints, and it reports the same fact in a form that survives the invocation.

**Expect `auth.users 0` in that table on today's data**, and the other five to
match production: `event_exceptions 1`, `events 4`, `organizer_members 0`,
`organizers 3`, `user_roles 0`.

**Under `replica=on` the FK constraint triggers are off along with the user
triggers**, so nothing enforces referential integrity during the load and
assertion 2 is the only thing checking it. Under `replica=off` the FKs are
enforced and the load becomes order-sensitive instead — if E2 fails there with a
foreign key error, check the COPY order in the dump before suspecting the dump.

**Expect on the PII failure:** `REFUSING TO COMMIT: <n> organizer email and <n>
phone values reached dev.` The transaction aborts, nothing is committed, and the
values never enter dev as a committed change. That means the filter did not run
or ran against the wrong file. Re-run E1b and retry.

**Expect on the identity failure:** `ERROR: 23503: insert or update on table
"organizer_members" violates foreign key constraint` — the synthetic rows did
not cover the set. Since they are derived from this same dump, that would mean
the two files came from different dumps.

Everything is one transaction, so any failure leaves dev exactly as it was and
the step is safe to re-run once the cause is fixed.

---

# Phase F — acceptance

## F1. The deliverable

```bash
./scripts/compare-projects.sh supabase/tests/content_inventory.sql "$DEV_DB_URL" "$PROD_DB_URL"
```

**The predicted result depends on one number that is already known by the time
you run this**: `redacted_email_values` and `redacted_phone_values` from E1b.
Pin the prediction to them *before* running F1, so the outcome is not chosen
after the fact.

**Case A — E1b reported `0` and `0` (expected on today's data).** The filter
redacted nothing, so dev holds production's rows exactly. **Expect `IDENTICAL`**,
exit status 0, followed by the inventory itself:

```
IDENTICAL — hjsekipqryfuwdkhxuks and eqcgeqzzuzcwrflwasjo agree on every line of content_inventory.sql
```

`public.organizers.email` and `.phone` are null throughout on today's data —
`data/initial-content.sql` inserts only `name`, `slug` and `website`, and the
A8 run showed dev and production agreeing on `organizers` exactly. So there is
nothing for the filter to remove and nothing for F1 to differ on. **A four-line
difference in Case A is a failure**, not the shape predicted last round.

**Case B — E1b reported a non-zero count.** Some organizer has a contact detail,
the filter removed it, and F1 cannot be IDENTICAL. **Expect `DIFFERENT` on
exactly one cell:**

- `organizers.rows_md5` differs;
- `organizers.n_rows` matches;
- `organizers.cols_md5` matches;
- `event_exceptions`, `events`, `organizer_members` and `user_roles` identical
  in every column;
- Section 2 identical throughout.

**Either way, the pre-stated shape is the deliverable**, pasted raw. A
prediction made before the run and then met is the evidence; a result explained
afterwards is not. The completeness of the backup is proved separately at E1c,
against the dump file rather than against dev — and in Case A, E1c's `0 == 0`
is what carries that weight, since F1 no longer exercises the filter at all.

**One trap in reading the output.** `d41d8cd98f00b204e9800998ecf8427e` is md5 of
the empty string. `organizer_members` and `user_roles` are empty on both
projects, so both will show it in both columns. That is the empty-table path,
not two tables agreeing about content. Do not count those as evidence the
restore worked.

**One limit on what F1 proves, whichever case is live.** Measured at D1: all
four production events are `approved` and no `pending` or `rejected` row has
ever existed. So F1 demonstrates that four approved rows, three organizers and
one exception round-trip through dump and restore. It demonstrates nothing about
a non-approved row, because there is not one to demonstrate it with. The backup
covers base tables rather than the `_public` views specifically so that pending
rows are carried — that remains right, and it currently has zero instances
behind it. Re-run this rehearsal after the first organizer submission, when it
will finally be testing the thing it was designed around.

**Do not interpret any other result until F1b has run.** Several readings are
available and they are not distinguishable from this output alone.

## F1b. Did production move under the comparison?

```bash
PGOPTIONS='--client-min-messages=warning' \
psql -X -q -A -F'|' --pset=footer=off --pset=pager=off -v ON_ERROR_STOP=1 \
     -f supabase/tests/content_inventory.sql "$PROD_DB_URL" \
  | sed -e 's/[[:space:]]*$//' > /tmp/prod-after.txt
diff -u /tmp/prod-before.txt /tmp/prod-after.txt && echo "PRODUCTION DID NOT MOVE"
```

**Expect:** no diff output, then `PRODUCTION DID NOT MOVE`.

**If production moved, F1's result is void — whatever it said.** Not debugged,
not explained: the dump is retaken. Go back to D3 and run D3 → E1 → E2 → F1 →
F1b again in one sitting. A DIFFERENT explained by a story about triggers, when
the real cause was an organizer editing an event at 14:20, is worse than no
result.

This voids a result that matched the predicted shape just as much as one that
did not. A four-line match against a production that moved under it is a
coincidence, not a proof, and nothing in F1's output distinguishes the two.

## Reading F1, once F1b says production held still

**The expected result** is whichever of Case A or Case B E1b's counts pinned.
Proceed to F2.

**The predicted failure:** the differing lines include the `events` `rows_md5`,
with `cols_md5` matching — meaning triggers fired during the load and
`needs_review` / `updated_at` moved. That is B1's method not having taken.
**The fix is the load, not the inventory.** Loosening `content_inventory.sql`
until it passes would produce a green check over a backup that does not restore,
which is the poller with its 35 tests.

**A `cols_md5` mismatch on any table** means the schemas differ, not the data,
and A6 let something through. Section 2 of the inventory names the column in the
diff. Stop; do not touch the dump.

**Counts matching but `rows_md5` differing, with `cols_md5` equal,** means the
right number of rows carrying different content — the one case where I would
want to see the raw diff before saying anything.

## F2. The canary is unharmed

```bash
./scripts/compare-projects.sh supabase/tests/grants_check.sql "$DEV_DB_URL" "$PROD_DB_URL" \
  > /tmp/grants-after.txt 2>&1; echo "exit=$?"
diff -u /tmp/grants-before.txt /tmp/grants-after.txt && echo "GRANTS UNCHANGED BY RESTORE"
```

**Expect:** no diff output, then `GRANTS UNCHANGED BY RESTORE`.

**C2's baseline came back IDENTICAL, which makes this step sharper than planned.**
The original design had F2 looking for a *new* difference inside a diff that was
expected to be non-empty anyway — spotting a change against noise. With a clean
baseline, any privilege the restore moves shows against silence: `grants-after`
differs from `grants-before` at all, or it does not.

Supabase's CLI reference warns that tables inherit ALL privileges from the
target's default privileges when a **schema** is restored. This is `--data-only`
into an already-migrated project, so it should not apply — which is exactly why
it is worth one command to confirm rather than one sentence to reason about.

**If it differs: stop.** Dev's entire job is being the project where a defective
grant is visible instead of rescued.

---

# Phase G — teardown

Dev must go back to empty, including the synthetic identities, or it is no
longer a canary and every future `compare-projects.sh` run diffs on content
forever.

The previous draft ran this as a heredoc that hard-coded
`session_replication_role = replica` and deleted D2's uuid set rather than the
set the restore actually loaded. It is an ops file now, and it takes **no**
`-v replica`: the branch was written, then removed.

Nothing it could protect against can fire here. TRUNCATE fires only
statement-level truncate triggers, and all eight triggers in this schema are
FOR EACH ROW on insert/update/delete. The `delete from auth.users` reaches
public through three foreign keys — `organizer_members.user_id` and
`user_roles.user_id` on CASCADE, `events.created_by` on SET NULL — and all
three find their tables already truncated, so all three touch zero rows. The
SET NULL path is the one worth noticing: it is an UPDATE on `public.events` and
would fire four triggers if `events` still had rows. **So the ordering is what
makes this safe, not the trigger settings**, and the file says so at the
statements themselves.

Removing the branch rather than getting it right takes the privilege dependency
out of teardown entirely, so this step cannot fail with
`insufficient_privilege` at the moment when failing would leave dev full.

```bash
SYN="$HOME/nissartango-backups/content-<ts>.synthetic.sql"
UUIDS=$(grep -oE "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" "$SYN" \
          | grep -v '^00000000-0000-0000-0000-000000000000$' \
          | sort -u | paste -sd, -)
printf 'uuid count: %s\n' "$(printf '%s' "$UUIDS" | tr ',' '\n' | grep -c . )"

psql -X -q --pset=pager=off -v ON_ERROR_STOP=1 \
     -v uuidlist="$UUIDS" \
     -f supabase/ops/teardown-dev-rehearsal.sql "$DEV_DB_URL"
```

The `grep -v` drops the all-zero `instance_id`, which appears on every synthetic
row and is not a user id. `grep -c .` rather than `wc -l` so that an empty list
counts as 0 and not as 1.

**Expect, on today's data: `uuid count: 0`**, matching B6 and E1b's
`synthetic_uuids`. All three are the same set seen from three places. Then:

```
NOTICE:  teardown: clearing 8 content row(s) across 5 tables
NOTICE:  teardown: deleted 0 synthetic auth.users row(s)
NOTICE:  teardown ok: auth.users is empty
```

and the six-row counts table, every count `0`. No `TRUNCATE TABLE`, no
`DELETE 0`, no `COMMIT` — those are command tags and `-q` suppresses them.

**This step failed on its first attempt, 2026-09-17**, with
`ERROR: syntax error at or near ":"` on the `delete`: `:'uuidlist'` was written
inside a `do $$ ... $$` block and psql does not interpolate there. The
transaction rolled back and dev was left holding the restored content —
B5 read `events 4`, `organizers 3`, `event_exceptions 1`. That is the second
unplanned demonstration of the transactional property E2 depends on, after B4's
first. The fix moved the interpolation outside the block via `set_config`.

**If G fails, dev keeps the restored content.** Re-run B5 to confirm what state
it is in before retrying, and expect the restored counts rather than zeros.

**The second notice is the one that earns its place here rather than at B4.**
With an empty list it says 0 and so would a delete that never ran. Once
organizers have signed up it is the only thing separating "deleted three
synthetic rows" from "matched none and moved on", and the counts table cannot
tell those apart because it only shows the after state.

**Once an organizer has signed up**, expect `uuid count`, `synthetic_uuids` and
the deleted-row notice to agree on the same non-zero number. A disagreement
between them is the finding, not the number.

**Expect on failure:** `REFUSING TO COMMIT TEARDOWN: <n> rows left in
auth.users.` The transaction rolls back and dev is left exactly as the restore
left it — full, but consistent, and safe to retry once the uuid list is
re-extracted.

Then re-run B3.

**Expect:** six lines, every count `0` again. Paste it. Teardown that was not
observed is not teardown.

---

# Phase H — only now, the backup becomes real

Gated on **both**:

- F1 printed the shape E1b's redaction counts pinned in advance — `IDENTICAL`
  in Case A, or the one-cell `organizers.rows_md5` difference in Case B; and
- F1b printed `PRODUCTION DID NOT MOVE`.

Both, not either. A correct-looking F1 taken against a production that moved
under it proves nothing, and F1 alone cannot tell you which happened.

The gate is the *pinned* shape, whichever it was — not IDENTICAL specifically
and not DIFFERENT specifically. Two earlier drafts of this section each hard-
coded one of those, and each was wrong once the other case became live.

The directory is the clone made in A7, so `git` has a remote and an origin.

**One-time, before the first commit:** stop derived files reaching the repo by
glob.

```bash
cd ~/nissartango-backups
printf '*.filtered.sql\n*.synthetic.sql\n*.stats\n' > .gitignore
git add .gitignore && git commit -m "ignore derived filter outputs"
```

Then the backup itself, **named explicitly, not globbed**:

```bash
cd ~/nissartango-backups
STAMP=<the UTC timestamp from E1>
gh repo view dimuthu-wije/nissartango-backups --json isPrivate
ls -l "content-$STAMP.sql"
git status --short
git add "content-$STAMP.sql"
git commit -m "content backup $STAMP" && git push -u origin HEAD
```

**`git add content-*.sql` is wrong and was in an earlier draft of this step.**
The glob matches three files: the dump, `content-<ts>.filtered.sql` and
`content-<ts>.synthetic.sql`. Measured on a real set: 969, 904 and 500 bytes —
the redacted copy sits 65 bytes from the real one, both named `content-<ts>`,
neither labelled. Committing both puts a backup missing every organizer contact
detail in the repo beside the one that has them, and the on-call person at 23:00
picks whichever tab-completes first.

`filter-content-dump.sh` is explicit that the **unfiltered** dump is the backup
and that a stripped one would not be a backup. The `.gitignore` above makes that
structural rather than remembered, which is the same move as the public site
having no `main` in `wrangler.jsonc`.

**Expect:** `{"isPrivate":true}` again — asserted twice, once before the dump
exists and once immediately before it leaves the machine, because the gap
between A7 and here is where a visibility change would go unnoticed. Then
`git status --short` showing the derived files absent (ignored) and only
`content-$STAMP.sql` untracked, one file committed, and a push that creates the
branch on the remote.

**If `git status` shows `.filtered.sql` or `.synthetic.sql` as untracked: stop.**
The `.gitignore` did not take, and the next `git add` with a glob will stage
them.

**If `isPrivate` is false here: stop, and delete nothing.** The file on disk is
still the only proven backup. Fix the repo, then push.

## What deliverable 1 established, 2026-09-17

Recorded narrowly, because "it passed" is not the claim worth keeping.

**F1 IDENTICAL, exit 0. F1b 60 lines each, PRODUCTION DID NOT MOVE. F2 19 lines
each, GRANTS UNCHANGED BY RESTORE.**

**The trigger suppression is the part actually demonstrated, and by more than F1
says on its own.** After the restore, dev's `events.rows_md5` was
`78eb9bdd00dbf00ec4e6ea3a48b286fd` — the same value production reported at A8,
and again at D3 before the dump existed. Had `t30_event_exceptions_flag_parent`
fired during the load it would have updated the parent event, firing
`t30_events_flag_review` and `t40_events_set_updated_at`, and `needs_review` and
`updated_at` would have moved that digest. So the suppression is demonstrated
against a value pinned twenty minutes earlier by an independent reading, not
merely against whatever production held at F1.

**What was NOT demonstrated, and should not be claimed:**

- No `pending` or `rejected` row round-tripped, because none exists. The reason
  for hashing base tables rather than the `_public` views is untested.
- No foreign key to `auth.users` was exercised, because production references it
  zero times. The synthetic-identity machinery ran with an empty list.
- No contact detail was redacted, because `organizers.email` and `.phone` are
  null throughout. The filter's redaction path ran over zero values; what was
  tested is that it examined the file and said so.

Three of this deliverable's central mechanisms are correct and unexercised.
**Re-run this rehearsal after the first organizer signs up and submits an
event.** That run tests what this one was designed around, and it is where a
latent bug in any of the three would surface.

**Phase H completed 2026-09-17: commit `b90124d`**, private repo confirmed, the
`.gitignore` and the unfiltered dump committed, derived files excluded. The
backup exists and is proven by the restore that preceded it.

Teardown (Phase G) failed on its first attempt and dev still held the restored
content at that point; re-run G after the `set_config` fix.

## What is still NOT done after this phase

- **There is no admin, and nothing here creates one. The gap is one row, not a
  build.** Check 3 confirmed `approve_event`, `reject_event`, `mark_reviewed`,
  `is_admin`, `is_owner`, `is_member` and `is_event_member` all exist and are
  executable by `authenticated`. The moderation layer is complete and unusable:
  `user_roles` is empty, so no caller passes the `is_admin()` gate inside any of
  them, every admin policy is unreachable, and the stage-5 approval queue would
  have nobody who could open it. One `insert into public.user_roles` fixes it —
  but it needs its own deliverable, because it is the first write that decides
  who can approve content on this site and it should be recorded as such, not
  appended to a backup rehearsal.
- **No organizer has an owner.** `organizer_members` is empty, so `is_owner()`
  is false for everyone and `organizers_without_owner` contains all three. Same
  deliverable as the above; they are the same gap seen from two tables.
- `supabase/PROJECT_SETUP.md` has two corrections outstanding, both measured and
  both handed over as lines rather than edits: dev is no longer "empty. No
  migrations, no content" (A6, A8), and the `grants_check` paragraph's predicted
  non-empty diff was false, with "seven migrations" wrong at the same spot (C2).
- `.gitignore` is untouched. `data/snapshot.json` stays in the index. That is a
  later deliverable, gated on this one and on the build-failure behaviour in
  item 5 of the PROJECT_SETUP section being confirmed rather than assumed.
- Deliverable 1b, the storage object sync, is not written. Until it is, the
  backup restores rows whose `image_path` values point at objects that exist in
  exactly one place.
- `verify-build.mjs` is untouched, pending the first Cloudflare build log that
  shows `verify:build` actually running.
- The new required box in `workers/cron/OPERATIONS.md` is not written, because
  the unpushed version of that file is not on origin and I have not read it.
