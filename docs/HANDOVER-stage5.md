# nissartango.fr — handover to Claude Code (stage 5)
Written by the reviewer session, 2026-09-19 10:15Z. Everything below was
measured, not remembered; where it was not, it says so.

> **Read this as a dated record, not as current state.** It was accurate on
> 2026-09-19 and the body below is kept verbatim, because a handover that gets
> quietly edited afterwards stops being evidence of what was known when. Only
> two things were changed on publication: this box, and one account uid
> truncated in §4.
>
> **Superseded since — see `docs/HANDOVER-stage6.md` for all of it:**
>
> - §4 "Link-scanner prefetch is **ruled out**, not merely doubted" — **wrong.**
>   Refuted the same day: a preload consumed a link and created a real session
>   at 11:13Z. One success does not rule out a race. PKCE was the fix and is
>   built.
> - §4 content counts (4 events) — 5 events as of 2026-09-22.
> - §5 "**Custom SMTP is DISABLED on both projects, and this is a hard
>   blocker**" — **solved 2026-09-21.** Resend, sending as
>   `no-reply@nissartango.fr`, proven by delivery to an address outside the
>   Supabase organization.
> - §5 URL configuration, and §6 items 1 and 2 — **done.**
>   `editor.nissartango.fr` exists, and the editor now signs in, composes,
>   edits and moderates.
> - §6 item 3, the hosted **Email OTP Expiration, is still unread** on both
>   projects. It is the one thing in §6 that is still open.
> - §7 `public/_redirects` hard-coding one slug — **done.** Generated from
>   `events.legacy_slugs` since `ee05b41`; the file is now gitignored output.
> - §9 "four instruments that lie quietly" — **six.** `git grep -E` has no
>   `\b`, and `${PIPESTATUS[0]}` is a bash-ism that yields empty in zsh.
>
> Everything else in §7 — the project refs being backwards, the Cloudflare
> build command, dev's deliberate fail-open RLS, `seed:real` not reaching a
> hosted project, appending migrations — **is still true and still load-bearing.**

---

## 1. Repo

`~/dev/nissartango` — already cloned. GitHub `dimuthu-wije/nissartango`,
**PUBLIC**: anything committed is world-readable the moment it is pushed, and
force-pushing does not un-publish it.

    HEAD == origin/main == e22ca1d  "Apply the auth URL patch, close the
                                     verify:build box, make the suite green"
    working tree clean, nothing unpushed

Branch `main` only. A local `supabase-migration` branch is not on origin — stale,
ignore it.

**`CLAUDE.md` IS A SYMLINK TO `AGENTS.md`** (`lrwxr-xr-x CLAUDE.md -> AGENTS.md`,
stored as a symlink in git). Do not create or overwrite `CLAUDE.md` — that
replaces the link with a regular file and silently forks the two. Edit
`AGENTS.md`.

Second repo: `~/nissartango-backups` — **PRIVATE**, one commit `b90124d`, the
content backup. Its visibility is load-bearing: the dump carries organizer
`email` and `phone`, which have never been public anywhere.

If git complains that another process is running, a reviewer session left zero-
byte locks behind (its mount refuses `unlink`):

    rm -f ~/dev/nissartango/.git/index.lock ~/dev/nissartango/.git/objects/maintenance.lock

---

## 2. Read these, in this order

Most of what you would otherwise ask for is written down, deliberately.

    AGENTS.md                          process rules, decisions, gotchas
    supabase/PROJECT_SETUP.md          which project is which; the dashboard
                                       settings that do not travel; the
                                       free-text decision; Auth, per project
    supabase/ops/restore-rehearsal.md  the backup deliverable, 22 steps, every
                                       expected output and what happened
    workers/cron/README.md
    workers/cron/OPERATIONS.md         the rebuild poller and its deploy gate
    .githooks/README.md                the pre-commit control on .env and secrets

Also read `56b86f3`'s commit body — it records the admin bootstrap with negative
controls, and nothing else does.

---

## 3. Where the project is

Stages 1–4 done and verified live: schema, RLS, the static build, and a rebuild
loop that republishes within ten minutes of a content change. Stage 5 is the
editor area.

**Deliverable 1 (backup) is complete.** Proven by a restore into dev and a diff:
F1 IDENTICAL, F1b PRODUCTION DID NOT MOVE, F2 GRANTS UNCHANGED BY RESTORE.

**Next: deliverable 2, in the brief's original order.** Its backend and policies
need no editor origin at all — `supabase/tests/rls_tests.sql` and
`scripts/prove-rls.sh` already test them by in-database impersonation and over
real HTTP through PostgREST respectively.

**First task, small and concrete:** `56b86f3`'s impersonation results live in a
commit body, which is a write-only medium — nothing greps it, `check-db.sh` does
not run it, it cannot fail. They belong in `supabase/tests/rls_tests.sql` as
`check_eq` assertions with the negative controls kept:

    is_admin()              t  | as a non-existent uid       f
    is_owner(nissartango)   t  | is_owner(el-gato-tanguero)  f
    count(*) from events    4  | as a stranger               0

While doing that, resolve one spelling discrepancy: `rls_tests.sql` sets
`request.jwt.claim.sub` (singular, legacy PostgREST form) and `56b86f3` used
`request.jwt.claims` (plural, JSON blob). Both produced positive results so
neither yields a null uid, but the repo has two spellings of one idea with
nothing saying they are equivalent. One line naming the canonical form.

---

## 4. Production state, measured 2026-09-19

**Content.** 4 events, **all `approved`** — no `pending` or `rejected` row has
ever existed, so the status transitions have never run outside a test. 3
organizers. 1 `event_exception`. **0 images**, which keeps deliverable 1b latent.
`organizers.email` and `.phone` are null throughout.

**Identity — the gap is closed.** One `auth.users` row:

    user_id       98f79fd9-…          (truncated on publication;
                                       the full uid is in auth.users)
    created_at    2026-09-19 08:37:21Z   (the OTP REQUEST)
    confirmed_at  2026-09-19 09:50:02Z   (the click, 73 minutes later)
    roles         1        (user_roles — the admin)
    memberships   1        (organizer_members — so is_owner() is real)

**The row and the session are independent, on the clock.** GoTrue created the row
at 08:37 when the OTP was *requested*. `56b86f3` verified `is_admin()` and
`is_owner()` in-database at ~08:40 — while `email_confirmed_at` was still NULL.
Confirmation only happened at 09:50. So nothing about the moderation layer was
ever blocked on a working editor origin, and an earlier ordering argument that
said otherwise was wrong.

**The magic-link flow works end to end except its destination.** Measured today:
`POST /auth/v1/otp` → 200; the email arrives; clicking within the hour lands on
`site_url` with `#access_token=…&expires_in=3600&type=signup`. The "error page"
reported earlier was the browser failing to reach `http://localhost:3000` —
nothing listening — not an auth failure. An earlier `otp_expired` was plain
expiry: requested 08:37, `otp_expiry` 3600, clicked after 09:37. Link-scanner
prefetch is ruled out, not merely doubted.

---

## 5. Auth configuration — the blocking facts

**URL configuration, read from both dashboards 2026-09-19:**

    Site URL       http://localhost:3000   on BOTH projects (scaffold default)
    Redirect URLs  (none)                  on BOTH projects

With an empty allow-list the permitted set is just `site_url`, which is why a
valid token lands on nothing. **Deferred deliberately:** do not set these until
`editor.nissartango.fr` resolves. A dead allow-list entry fails in a real
person's inbox, once; localhost fails visibly in development.

**Custom SMTP is DISABLED on both projects, and this is a hard blocker.** Not a
rate limit — an impossibility. From Supabase's docs
(https://supabase.com/docs/guides/auth/auth-smtp):

  - "Currently this value is set to 2 messages per hour."
  - Auth "will only send messages to these addresses" — the project's
    **organization team members**. Anything else fails with *"Email address not
    authorized"*.
  - "No SLA guarantee on message delivery or uptime"; explicitly "not meant for
    production use".

So an organizer who is not a team member on the Supabase org **cannot receive a
magic link at all**. The one address that works today is the org owner's, which
is why the bootstrap succeeded. **Custom SMTP on the nissartango.fr domain is a
prerequisite for deliverable 3, not an improvement.** 2/hour also bounds testing:
anyone iterating on the flow will hit it in minutes, and it will look like a
broken flow rather than a quota.

**Still unread:** the hosted Email OTP Expiration per project. `config.toml` has
`otp_expiry = 3600` but that governs the local stack only.

---

## 6. What only Dimuthu can do

1. **Create `editor.nissartango.fr`.** Not blocking deliverable 2; blocks the
   hosted URL configuration and therefore any usable browser session.
2. **Choose and configure a custom SMTP provider** on the nissartango.fr domain.
   A decision with a small recurring cost, and §5 says why there is no
   alternative.
3. **Read the hosted Email OTP Expiration** on both projects.

---

## 7. Decided and measured — do not re-litigate

**Projects.** `eqcgeqzzuzcwrflwasjo` ("dimuthu-wije's Project") is
**PRODUCTION**. `hjsekipqryfuwdkhxuks` ("nissartango-dev") is dev. The names are
backwards. Read the ref, never the name.

**The Cloudflare build command must stay `npm run build && npm run verify:build`,
deploy as a separate step.** Until 2026-09-17 it was `npm run build` alone and
`verify-build.mjs` had never run on a deploy. Measured against an empty dev
project: the build exits 0 and publishes an empty agenda; `verify:build` exits 1
with 8 FAILED. That command is the only thing between a lost database and an
empty agenda on the live site.

**Both staleness guards in `verify-build.mjs` have fired**, 2026-09-17, and stayed
silent where they should — locally on a good build and in CI build `963464a9`.
Guard A reports both refs and exits before any check; guard B says "built N hours
ago", not the older snapshot message, which is how you know the subsumption
ordering took.

**`data/snapshot.json` is no longer committed.** The committed copy had been
**eight days stale** — it only updated when a human ran a local build *and*
committed the result; CI rewrites it and commits nothing. It read as a backup,
was trusted as one, and was not.

**`public/_redirects` hard-codes one event's slug four times**, with destinations
that exist only while that event is approved — so rejecting or deleting it fails
the build. Decision: generate the rules from content via a `legacy_slugs text[]`
column on `events`, **not** a sixth table, and let a withdrawn event's legacy URL
**404**, recorded as acceptable at this scale rather than correct. A sixth base
table would force lockstep edits to `content_inventory.sql`,
`filter-content-dump.sh`, E1's expected COPY count and the teardown's truncate
list.

**Dev is deliberately fail-open on automatic RLS.** Do not "fix" it — that is what
makes it the canary for a migration that forgets `enable row level security`.

**`npm run seed:real` cannot target a hosted project and will not say so.** If a
local stack happens to be running it seeds LOCAL, prints success, and the hosted
project you meant stays empty.

**Append new migrations; never edit an applied one.**

---

## 8. Local setup

`.env` at the repo root, gitignored:

    SUPABASE_URL, SUPABASE_ANON_KEY   publishable, safe, used by the build
    PROD_DB_URL, DEV_DB_URL           session-pooler URIs carrying the database
                                      password — never paste these anywhere

`scripts/check-db.sh` **parses** that file rather than sourcing it, because a
password contains `$` and backticks. Without the two DB URLs it prints a
nine-line SKIPPED banner — which it did for weeks, so `npm run check:db` had
never checked a database until 2026-09-17.

`psql` from Homebrew `libpq` (keg-only, needs a PATH export). Docker via OrbStack,
needed by `supabase db dump`. Production is PostgreSQL 17.6; local psql/pg_dump
is 18.6, so a local `pg_dump` would run — the reason to prefer the CLI is version
drift and reproducibility, not a version floor.

Cloudflare build variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

**Never paste an access token or a connection string into a chat.** One admin
access token was pasted on 2026-09-19; its session was revoked via
`POST /auth/v1/logout?scope=global` (204), verified by SQL — `auth.sessions` and
`auth.refresh_tokens` went from `1 | 1 | 0 | 1` to `0 | 0 | 0 | 0`. The access
token itself could not be revoked: PostgREST validates signature and expiry and
consults no session table, so an issued JWT lives to its `exp` unless the signing
key is rotated. That one expired at 10:50:02Z.

---

## 9. The method, which is the part worth transferring

A separate reviewer session reads reports and verifies claims from outside. The
recurring failure has been one agent summarising for another. Instances, each of
which looked healthy from outside:

- a check that cannot **report** — `verify:build`'s warning, on a script the
  deploy never ran
- a check that cannot **fail** — an absence test over a file nothing parsed
- a check that always **fails** — a pattern checker's first run: five false
  positives on a correct repo
- an artefact that cannot be **current** — `data/snapshot.json`, "the backup",
  eight days stale
- evidence that cannot be **found** — the admin bootstrap's results, in a commit
  body nothing greps

So: **state the expected output before running a command.** Paste raw output,
never a summary. A passing test proves nothing until something outside the system
confirms it. When a fix lands in one file, **grep the whole set** — three times a
correct fix reached one call site and not the others; that is what
`supabase/ops/check-sql-patterns.sh` is for, and it runs before a sitting.

**Instruments that lie quietly.** Four now, each believed until something outside
it disagreed: a caching web proxy that served day-stale pages for 36 hours; a
FUSE mount that reports every file as mode 600 regardless of its real
permissions; `git grep -E`, which is POSIX ERE and has no `\b` (use `-P`); and
`${PIPESTATUS[0]}`, a bash-ism that silently yields empty in zsh (`$pipestatus[1]`,
1-indexed).

---

## 10. Corrections the reviewer session owes, on record

Kept because the pattern matters more than the individual errors. All six are the
same shape: a specific claim about a system it could not observe, stated without
checking.

1. **`.env` permissions** — reported 600; it was 644. The reading came through a
   mount that normalizes every file to 600.
2. **The ordering rationale** — asserted twice that no `auth.users` row could
   exist without a completed magic-link login, and recommended inverting the
   deliverables on that basis. The row is created on *request*.
3. **Attribution** — assigned the otp measurement and the impersonation run to
   whichever session it happened to be talking to. There is no agent provenance
   in this repo; every commit is authored `dimuthu-wije`.
4. **Three SQL/shell diagnoses reached by grepping for an expected shape and
   reading a null result as absence** — `verify-build.mjs`'s content floors (they
   existed); the `ORDER BY ... COLLATE` fix (wrong reason, and the prescribed fix
   also failed); a `GET DIAGNOSTICS` amendment that broke psql interpolation by
   putting a variable inside a `DO` block.
5. **A dashboard button that does not exist** — described a "Sign out user"
   control in Authentication → Users. The menu offers Remove MFA factors, Ban
   user and Delete user. The working route is the logout API.
6. **A predicted revocation shape** — expected `refresh_revoked = 1`; GoTrue
   deletes the rows instead. `refresh_live = 0` was the number that mattered and
   it was stated as such, which is the only reason the prediction failing cost
   nothing.
