# Stage 5 — answers before you start (briefing)

From the reviewer session. I cannot write code or touch the repo; I read it and
I check the running system from outside. Everything below was read from the
working tree at `c93891c` on Dimuthu's machine, not from the GitHub web proxy I
normally use and not from memory. Where I am guessing, I say so.

> **A dated record, kept verbatim.** Written before stage 5 began; tracked on
> 2026-09-22 and renamed from `stage5-briefing.md`. Its §1, §2 and §3 are the
> clearest account in this repo of *why* the schema is shaped the way it is, and
> they have not aged. Read them before designing anything that touches
> `events_public`, `user_roles`, or where the editor is deployed.
>
> **What HAS aged:**
>
> - **§0, the file list.** Eight migrations then, nine now
>   (`20260919120000_legacy_slugs.sql`). The byte sizes are all stale —
>   `AGENTS.md` alone has roughly doubled. Use them as a shape check, never as
>   an expected value.
> - **§0's method.** `raw.githubusercontent.com` does work, but it is **cached**:
>   on 2026-09-22 it served a three-commit-old copy of a file at the old byte
>   count while reporting HTTP 200. It belongs on the "instruments that lie
>   quietly" list in `AGENTS.md`. Ask git — `git fetch` then compare blobs —
>   when the answer matters.
> - **§3.** Settled exactly as recommended. `editor.nissartango.fr` exists, is a
>   separate deployment with no `main`, and the hosted URL configuration points
>   at it. `supabase/config.toml` still names `127.0.0.1:3000` and still governs
>   the local stack only, which was the point.
> - **§4, "you write them; Dimuthu runs them".** The mechanism no longer applies
>   — this repo is now worked from Claude Code, which runs its own commands. The
>   REASON still applies in full, and is the most important sentence in this
>   file: *no agent both performs an action and certifies it.* The poller passed
>   35 tests while never having polled. So: state the expected output before
>   running the command, paste raw output, and treat a passing test as proof of
>   nothing until something outside the system agrees.
> - **§6's third bullet.** Done — the six dead Sveltia files were deleted in
>   `b8abc2b` and the section was struck from `AGENTS.md`.
> - **§7's first question, the Cloudflare build command.** Answered: it is
>   `npm run build && npm run verify:build`, with deploy as a separate step. It
>   had been `npm run build` alone until 2026-09-17, so `verify:build` had
>   indeed never run on a deploy — the doubt in this bullet was justified.
>
> Everything in §5 still stands, including the detail that dev pauses after
> seven idle days and needs a Restore click, so a connection failure against
> `hjsekipqryfuwdkhxuks` is a paused project rather than a broken migration.

---

## 0. The four files — you can probably fetch them yourself

The repo is public. `raw.githubusercontent.com` works; `github.com` HTML is
robots-blocked and `api.github.com` returns 403 (I hit both today, so don't
burn time on them). Try these four before asking anyone to paste 57 KB:

```
https://raw.githubusercontent.com/dimuthu-wije/nissartango/main/AGENTS.md
https://raw.githubusercontent.com/dimuthu-wije/nissartango/main/supabase/PROJECT_SETUP.md
https://raw.githubusercontent.com/dimuthu-wije/nissartango/main/workers/cron/README.md
https://raw.githubusercontent.com/dimuthu-wije/nissartango/main/workers/cron/OPERATIONS.md
```

(11670, 29107, 9695 and 7155 bytes respectively — if you get something much
smaller you got an error page, not the file.)

What that method cannot do is list a directory, which is why you could not
enumerate `supabase/migrations` yourself. Here it is; fetch each by raw URL
under `supabase/migrations/`:

```
20260828181000_types_and_helpers.sql        6103
20260828181100_organizers.sql               4966
20260828181200_events.sql                  17199
20260828190000_rls_helpers_and_views.sql    7701
20260828190100_rls_policies.sql            15189
20260828190200_storage.sql                  2425
20260829090000_fail_closed_defaults.sql     2603
20260831120000_content_checksum.sql         3498
```

Also worth having: `supabase/tests/{grants_check,rls_tests,schema_tests,api_settings,expose_probe}.sql`,
`supabase/ops/install-ensure-rls.sql`, `scripts/fetch-content.mjs`,
`scripts/verify-build.mjs`, `src/content.config.ts`, `src/lib/snapshot-path.mjs`.

**Do not reason around the gaps.** You were right to say so. But three of the
gaps you flagged are already closed, below.

---

## 1. Your Q1 — is `snapshot.json` a whitelist projection or a table dump?

**Neither, and the difference is the whole answer.**

`scripts/fetch-content.mjs` fetches with `select=*`:

```
'events_public?select=*&order=starts_at.asc'
'organizers_public?select=*&order=name.asc'
'event_exceptions_public?select=*&order=occurrence_date.asc'
```

— but those are **views**, and the views are explicit column lists.
`supabase/migrations/20260828190000_rls_helpers_and_views.sql:147`:

```sql
create view public.events_public as
  select id, slug, title, type,
         starts_at, duration_minutes, timezone,
         recurrence, recurrence_end,
         location_name, location_address, location_postal_code, city,
         organizer_id, teachers,
         price_full, price_member, price_note,
         signup_url, image_path, body,
         cancelled_at, cancellation_note,
         created_at, updated_at
    from public.events
   where status = 'approved';
```

So: **the whitelist exists and lives in a migration, not in the generator.** A
new column on `public.events` does not reach the REST API, the snapshot, or git
until someone edits that view. `select=*` in the JS is safe *because* of where
it points, and `organizers_public` is the proof — the Zod schema notes that
email and phone "are absent from the view too, which is the actual boundary."

Three consequences for you:

1. Your stage-5 columns (`review_note`, `needs_review`, submitter identity,
   whatever the queue needs) are **not** exposed by default. `events.status`,
   `review_note` and `needs_review` already exist and are already excluded —
   `20260828181200_events.sql:247` says so explicitly.
2. The failure mode to guard is a careless `create or replace view … select *`
   in a stage-5 migration. Whatever you write, the view stays an enumerated
   list, and that should be an assertion in `supabase/tests/`, not a habit.
3. `where status = 'approved'` means **pending and rejected submissions never
   reach the snapshot and therefore never reach git.** A human approval already
   sits between an organizer typing and anything being committed. That does not
   dissolve the free-text problem — approving a listing is not auditing it for a
   phone number — but it does mean the deadline is "before the first
   organizer-submitted event is approved", not "before the form exists".

---

## 2. Your Q2 — how is admin identified?

**A table, and it was built in stage 1.** Not a claim, not a hardcoded uid, not
organizer membership.

`20260828181100_organizers.sql:62`, with the reasoning kept in the file:

> Site-wide roles (today: admin). Deliberately a TABLE, not a JWT claim: a
> claim is minted at login, so revoking admin would not take effect until the
> token expired, and any client can decode — and a malicious one can attempt
> to forge — what it carries. A table is checked on every statement.

```sql
create table public.user_roles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
```

`public.is_admin()` is defined at `20260828190000_rls_helpers_and_views.sql:30`
and reads `user_roles` where `user_id = (select auth.uid()) and role = 'admin'`.
Execute is revoked from `public, anon, authenticated` and then granted to
`authenticated` only. `user_roles` itself has RLS enabled, no policies, and
`revoke all … from anon, authenticated` — so nobody can enumerate the admins and
`is_admin()` has no policy to recurse into. Roles are managed from the dashboard.

The approval machinery is also already there, and you should read it before
designing a queue rather than after:

- `events.status` is `public.event_status not null default 'pending'`.
- Nobody holds `UPDATE` on `events.status` — `20260828190100_rls_policies.sql:240`
  notes admins are `authenticated` too and column grants cannot distinguish them
  — so every status change goes through SECURITY DEFINER functions
  (`approve_event` and siblings, ~lines 255/281/311) that each re-check
  `is_admin()`. `anon` may call them; they are turned away inside.
- `events_admin_select/update/delete` policies exist and are OR'd with the
  owner policies.
- There is a trigger that resets `status` to `pending` when a rejected event's
  content changes, and sets `needs_review` when an approved event's content
  changes (`20260828181200_events.sql:279-287`) — which is where the 31 August
  `needs_review` row came from, and why `status` is deliberately absent from the
  trigger's "content list".
- `organizers_without_owner` exists at `20260828190100_rls_policies.sql:204`,
  described as "Ownerless organizers, for the admin queue."

**Stage 5 is the SPA and the auth configuration. The RLS is done.** Your job is
mostly to not contradict it. If you find yourself writing a new policy on
`events`, stop and check whether the OR'd admin policy already covers it.

---

## 3. Your Q3 — where does the SPA live?

Hostname is Dimuthu's to pick, but the *shape* is already fixed by the repo, and
it rules out the path option. Root `wrangler.jsonc`:

> No "main": the public site is static assets and nothing else. There is no
> Worker script, so there is no code path that could call Supabase at runtime —
> the boundary this whole design protects is now structural rather than
> remembered. The editor SPA is a separate deployment.

Serving the editor at `nissartango.fr/editor` means giving that Worker a `main`,
which destroys the one structural guarantee the public site has. So: **separate
deployment on a subdomain.** `editor.nissartango.fr` is the obvious name and I
would put it in the plan as an assumption for Dimuthu to veto rather than an
open question.

That settles the thing you actually wanted it for. The hosted project's Auth
config needs the real origin in **URL Configuration → Site URL and Redirect
URLs** (`https://editor.nissartango.fr`, plus a `/**` redirect entry, plus
`http://127.0.0.1:3000/**` for local work). `supabase/config.toml` still points
`site_url` and `additional_redirect_urls` at `127.0.0.1:3000`; that file governs
the local stack only, and the hosted setting is a console setting, not a
migration. Put both halves in the plan — `PROJECT_SETUP.md`'s "Still to decide"
section flags exactly this and it is still unresolved.

---

## 4. Who runs the curls

**You write them; Dimuthu runs them; he pastes raw output.** Keep it that way,
and not only because your sandbox is restricted.

The reason this project is worth reviewing twice is that no agent both performs
an action and certifies it. The poller passed 35 tests while never having
polled; that was not a credentials problem, it was an agent grading its own
homework. If you could run the probe and report the result, the report would be
worth exactly as much as those 35 tests.

So: exact, copy-pasteable invocations, one per acceptance criterion, each with
the output you expect stated *before* he runs it — so a surprise is visible
rather than absorbed. Raw output pasted back, not summarised.

If the throughput genuinely becomes the bottleneck, the compromise is **dev
credentials only, never production**. `hjsekipqryfuwdkhxuks` is empty,
disposable, and deliberately fail-open as a canary. Production is live, on the
free tier, and restored by hand.

---

## 5. The database state you asked for

Don't ask for a `pg_dump`. The repo already contains the probes, and using them
means your reading is comparable to every previous reading:

```bash
psql "$DEV_DB_URL"  -f supabase/tests/api_settings.sql    # run on DEV FIRST
psql "$PROD_DB_URL" -f supabase/tests/api_settings.sql
psql "$PROD_DB_URL" -f supabase/tests/grants_check.sql    # 13 rows: 12 PASS, 1 INFO
./scripts/compare-projects.sh supabase/tests/grants_check.sql "$DEV_DB_URL" "$PROD_DB_URL"
```

`grants_check.sql` is read-only and safe against production. `api_settings.sql`
is read-only but is DDL inside a rolled-back transaction — the repo's standing
rule is rehearse on dev first and confirm the probe table is gone. Expect a
non-empty `grants_check` diff between the projects and read it as the finding.

For `pg_policies` and column grants specifically, ask for them as a named query
rather than a dump, so what comes back is answerable:

```sql
select schemaname, tablename, policyname, cmd, roles, qual, with_check
  from pg_policies where schemaname = 'public' order by tablename, policyname;

select table_name, column_name, grantee, privilege_type
  from information_schema.column_privileges
 where table_schema = 'public' and table_name in ('events','organizer_members')
 order by table_name, column_name, grantee;
```

Note dev pauses after 7 idle days and nothing wakes it — a connection failure
against dev is a paused project, not a broken migration. It needs a Restore
click.

---

## 6. Corrections to what I sent earlier

I sent Dimuthu a list of findings before I could read the repo. Two were wrong
and one got worse:

- **Wrong: uploaded flyers and EXIF.** I flagged organizer image uploads as a
  second permanent channel into git. `.gitignore` already excludes
  `src/assets/events/*`, with a comment saying flyers live in Supabase Storage
  and that deleting those two lines is what would back them up in git instead.
  Already decided, decided correctly. Withdrawn.
- **Overstated: the deadline.** I said "before the form is built". Because
  `events_public` filters on `status = 'approved'`, the real deadline is before
  the first organizer-submitted event is *approved*. Same decision, one step
  further away than I implied.
- **Worse than I said: `AGENTS.md` is stale about Sveltia,** and the leftovers
  are still tracked. `src/content/events/*.md` and `src/content/organizers/*.md`
  — six files — are in `git ls-files`, and **nothing loads them**:
  `src/content.config.ts` builds every collection from the snapshot via
  `snapshotLoader`, and `fetch-content.mjs` never writes to `src/content/`. They
  are dead Sveltia-era content, and they have drifted (the tracked
  `2026-09-01-practica-mardi.md` says `location: "Salle à confirmer"` and
  `price: "10€"`; the snapshot's row for that event says neither). Delete them
  and strike the Sveltia section from `AGENTS.md` before anything in stage 5
  mistakes them for a live write path.

Standing, and confirmed from source rather than inferred:
`scripts/verify-build.mjs` inspects exactly `['body', 'price_note',
'location_address']` for an email or a French phone number, and warns rather
than fails, on purpose. The other organizer-typed strings — `title`,
`location_name`, `teachers`, `signup_url`, `cancellation_note` — are not
checked.

---

## 7. For Dimuthu, not for you

- **What is the Cloudflare build command?** Root `wrangler.jsonc` sets no build
  command, so it is a dashboard setting I cannot see. If it is `npm run build`
  rather than `npm run check`, then `verify:build` never runs anywhere except on
  your laptop — and the contact-detail warning that the free-text decision leans
  on has never fired in production and never will. Worth a look before the
  decision is written up as settled.
- The free-text decision itself is made: **stop committing `data/snapshot.json`**,
  private backup proven by an actual restore into dev *first*, no history
  rewrite. Details in my previous message; the ordering is the part that can go
  wrong.
