# Supabase project settings

Everything in `supabase/migrations/` travels with the repo. **These do not.**
They are set per project in the dashboard, and nothing in a `git clone` will
remind you they exist. This file is that reminder — for the production project
you will create months from now, on an evening when none of this is fresh.

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
  hosted project does not — a table works locally and 401s on the dev project,
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

## Free plan

Projects pause after **7 days** of inactivity and are restored **by hand** from
the dashboard. The daily keep-alive Worker planned for stage 4 exists for this,
and it is deliberately separate from the build so a fortnight of broken builds
costs a stale site rather than a paused database.
