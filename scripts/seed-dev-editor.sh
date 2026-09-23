#!/usr/bin/env bash
# Make the DEV project usable from the editor: an admin, an organizer, and
# enough events that the queue has something in it.
#
#     ./scripts/seed-dev-editor.sh you@example.org
#     ./scripts/seed-dev-editor.sh --help
#
# WHY THIS EXISTS. Dev holds no content by policy -- it is truncated before and
# after each restore rehearsal -- and on 2026-09-23 it held no auth.users,
# user_roles, organizers or events at all. A dev editor you cannot sign into is
# not an improvement on no dev editor, so this fills in the parts that are not
# content: an identity, a membership, and a few rows to moderate.
#
# WHAT IT REFUSES TO DO. It will not create the auth.users row, and it will not
# touch production.
#
#   - The auth row is GoTrue's. Writing one by hand means guessing which of its
#     columns are load-bearing this release, and a malformed row breaks sign-in
#     in a way that looks like a configuration problem. Create it in the
#     dashboard; this script then finds it by email. That is the one step only
#     you can do, and it takes a minute.
#   - The production guard reads the ref out of the CONNECTION STRING, not out
#     of the argument or the variable name, for the same reason db-push.sh
#     does: the two project names are backwards, so nothing on screen would
#     contradict you.
#
# .env is PARSED, never sourced: a database password is exactly the kind of
# string that contains $ and backticks.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" || $# -eq 0 ]]; then
  cat <<'USAGE'
Usage: ./scripts/seed-dev-editor.sh <email>

Seeds the DEV Supabase project so the editor at http://localhost:3000 is
usable. Idempotent: safe to run again.

Before the first run, create the account once, in the DEV project only:

  1. https://supabase.com/dashboard/project/hjsekipqryfuwdkhxuks
     -- check the ref in the URL. The project NAMES are backwards.
  2. Authentication -> Users -> Add user -> Create new user
  3. Use the same email you pass here. "Auto Confirm User" on, so no mail
     has to be delivered for dev.

Then:

  ./scripts/seed-dev-editor.sh you@example.org
  npm run dev:editor          # http://localhost:3000

Sign in with a magic link. Dev's Site URL is http://localhost:3000, which is
why the server uses that port.
USAGE
  exit 0
fi

email="$1"
[[ "$email" == *@* ]] || { echo "that does not look like an email: $email" >&2; exit 2; }

# --- the connection string, parsed out of .env -----------------------------
url=""
if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*DEV_DB_URL[[:space:]]*=[[:space:]]*(.*)$ ]] || continue
    v="${BASH_REMATCH[1]}"
    v="${v%"${v##*[![:space:]]}"}"
    [[ "$v" == \"*\" || "$v" == \'*\' ]] && v="${v:1:${#v}-2}"
    url="$v"
  done < .env
fi
[[ -n "${DEV_DB_URL:-}" ]] && url="$DEV_DB_URL"
[[ -n "$url" ]] || { echo "no DEV_DB_URL in .env or the environment. See .env.example." >&2; exit 3; }

# --- the guard --------------------------------------------------------------
ref=$(printf '%s' "$url" | sed -nE 's#.*postgres\.([a-z]{20}).*#\1#p; s#.*://[^@]*@db\.([a-z]{20})\..*#\1#p' | head -1)

# A local stack has no project ref, and that is not an error: running this
# against `supabase start` is how the SQL below gets exercised without touching
# any hosted project. It is also the only way to test the script end to end,
# because creating the auth.users row is a dashboard step on a hosted project
# and a scripted one locally (scripts/create-test-users.sh).
if [[ -z "$ref" ]]; then
  if [[ "$url" == *"@127.0.0.1:"* || "$url" == *"@localhost:"* ]]; then
    ref="local"
  else
    echo "could not read a project ref out of DEV_DB_URL, and it is not local" >&2
    exit 4
  fi
fi

prod_ref=$(tr -d '[:space:]' < data/production-ref 2>/dev/null || true)
if [[ -n "$prod_ref" && "$ref" == "$prod_ref" ]]; then
  echo >&2
  echo "REFUSING: DEV_DB_URL points at $ref, which is PRODUCTION." >&2
  echo "This script seeds test content and must never run there." >&2
  exit 5
fi

command -v psql >/dev/null || {
  echo "psql not found. Homebrew libpq is keg-only; add it to PATH." >&2; exit 6; }

echo
echo "  project: $ref   ($([[ "$ref" == local ]] && echo 'local stack' || echo dev))"
echo "  account: $email"
echo

# --- seed -------------------------------------------------------------------
# One transaction. Every insert is idempotent, so a second run is a no-op
# rather than a pile of duplicates -- which matters because the obvious way to
# use this is to run it again after wondering whether it worked.
psql "$url" -v ON_ERROR_STOP=1 -v email="$email" <<'SQL'
\set QUIET on

-- The email reaches the DO block through set_config, NOT through :'email'.
--
-- psql does not substitute its variables inside dollar-quoted text, so
-- :'email' within do $$ ... $$ is passed to the server literally and fails as
-- a syntax error at the colon. This exact mistake is recorded in
-- docs/HANDOVER-stage5.md as one of the reviewer session's corrections, and
-- was made again here before the message was read -- which is the argument for
-- the comment rather than a silent fix.
\o /dev/null
select set_config('seed.email', :'email', false);
\o

do $$
declare
  uid uuid;
  org uuid;
  addr text := current_setting('seed.email');
begin
  select id into uid from auth.users where email = addr;
  if uid is null then
    raise exception using message =
      'No auth.users row for ' || addr || '. Create it in the dashboard first: '
      'Authentication -> Users -> Add user, with Auto Confirm on. See --help.';
  end if;

  -- Site-wide admin, so the queue opens.
  insert into public.user_roles (user_id, role)
  values (uid, 'admin')
  on conflict (user_id, role) do nothing;

  -- An organizer to belong to. Fixed uuid so re-running finds the same one.
  -- HEX ONLY: the first attempt used ...dev1, which is not a uuid -- 'v' is
  -- not a hex digit -- and Postgres refused it. Caught by running the script
  -- against the local stack, which is the reason the local path exists.
  insert into public.organizers (id, name, slug, website, instagram)
  values ('0d000000-0000-0000-0000-0000000000d0',
          'Tango de développement', 'tango-de-developpement',
          'https://example.org/', 'tangodev')
  on conflict (id) do nothing;
  select id into org from public.organizers
   where id = '0d000000-0000-0000-0000-0000000000d0';

  -- OWNER, not editor: the organizer form needs is_owner() to allow a save,
  -- and seeding an editor would make the first thing anyone tried fail.
  --
  -- The WHERE is what makes a second run work, and it is not defensive
  -- padding. organizer_members_keep_an_owner() fires on UPDATE and asks only
  -- whether OLD.role = 'owner' with no other owner for that organizer -- it
  -- never looks at NEW.role. So re-setting the sole owner to 'owner', a
  -- no-op, raises "would be left with no owner". With the WHERE, the row that
  -- is already correct is not updated at all, so the trigger never runs.
  --
  -- Promoting an existing editor still works: OLD.role is 'editor' there, so
  -- the guard's branch does not apply. Measured against the local stack on
  -- 2026-09-23; the trigger is in an applied migration and is not edited here.
  insert into public.organizer_members (organizer_id, user_id, role)
  values (org, uid, 'owner')
  on conflict (organizer_id, user_id) do update set role = 'owner'
    where public.organizer_members.role is distinct from 'owner';

  -- Three events, chosen so the queue is not empty and not uniform:
  --   pending                  the ordinary case
  --   approved + needs_review  the case a pending-only queue would hide
  --   rejected                 so "recently decided" has something in it
  insert into public.events (id, organizer_id, title, type, starts_at, timezone,
                             city, status, duration_minutes, recurrence, created_by)
  values
    ('0e000000-0000-0000-0000-0000000000e1', org, 'Practica du mardi (dev)',
     'practica', now() + interval '10 days', 'Europe/Paris', 'Nice', 'pending',
     120, 'weekly', uid),
    ('0e000000-0000-0000-0000-0000000000e2', org, 'Milonga de démonstration (dev)',
     'milonga', now() + interval '20 days', 'Europe/Paris', 'Antibes', 'approved',
     240, 'none', uid),
    ('0e000000-0000-0000-0000-0000000000e3', org, 'Stage annulé (dev)',
     'stage', now() + interval '30 days', 'Europe/Paris', 'Cannes', 'rejected',
     180, 'none', uid)
  on conflict (id) do nothing;

  -- needs_review is set by trigger on a content change, never by hand here:
  -- setting it directly would be this script disagreeing with the mechanism
  -- the queue exists to surface. Touch the row instead and let the trigger
  -- decide, which also proves the trigger works on dev.
  update public.events
     set title = 'Milonga de démonstration (dev)'
   where id = '0e000000-0000-0000-0000-0000000000e2';
  update public.events set title = title || ' '
   where id = '0e000000-0000-0000-0000-0000000000e2';
  update public.events set title = btrim(title)
   where id = '0e000000-0000-0000-0000-0000000000e2';

  -- One exception, so the section on the event form is not empty first time.
  insert into public.event_exceptions (event_id, occurrence_date, kind, note)
  values ('0e000000-0000-0000-0000-0000000000e1',
          (now() + interval '17 days')::date, 'cancelled', 'Salle indisponible')
  on conflict (event_id, occurrence_date) do nothing;
end $$;
\set QUIET off

select 'admin'        as what, count(*) from public.user_roles where role = 'admin'
union all select 'organizers',   count(*) from public.organizers
union all select 'memberships',  count(*) from public.organizer_members
union all select 'events',       count(*) from public.events
union all select 'needs_review', count(*) from public.events where needs_review
union all select 'exceptions',   count(*) from public.event_exceptions;
SQL

echo
echo "  Done. Now:  npm run dev:editor    ->  http://localhost:3000"
echo
