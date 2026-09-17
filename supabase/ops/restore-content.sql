-- ============================================================================
-- supabase/ops/restore-content.sql
--
-- Restore a filtered content dump into nissartango-dev (hjsekipqryfuwdkhxuks).
--
-- ============================================================================
-- DEV ONLY. DO NOT POINT THIS AT PRODUCTION.
-- ============================================================================
--
-- This file writes. It is in supabase/ops and not in supabase/migrations for
-- the same reason install-ensure-rls.sql is: a migration is applied to every
-- project the repo is pushed to, and this must be applied to exactly one of
-- them, by hand, during a rehearsal. It is also not in supabase/tests, which
-- means compare-projects.sh will refuse to run it against a hosted project --
-- that refusal is a feature and this file should never be moved somewhere it
-- stops applying.
--
-- ----------------------------------------------------------------------------
-- WHAT IT IS FOR
-- ----------------------------------------------------------------------------
--
-- data/snapshot.json is about to stop being committed to a public repo. Until
-- today that file was, accidentally, the only copy of the site's content that
-- lived anywhere other than production. Removing it without a proven restore
-- path would leave production as a single point of failure with nothing behind
-- it.
--
-- A pg_dump that has never been read back is not a backup. It is the rebuild
-- poller that passed 35 tests without having polled once. So the acceptance
-- for the backup is not that a dump exists: it is that this file ran, and that
-- content_inventory.sql then agreed about dev and production.
--
-- ----------------------------------------------------------------------------
-- WHAT IT ASSUMES, AND WHERE EACH ASSUMPTION WAS MEASURED
-- ----------------------------------------------------------------------------
--
-- * The dump has been through filter-content-dump.sh. That script's three
--   guards are what let this file own the transaction unconditionally: no
--   nested BEGIN, no early COMMIT, no session_replication_role set behind its
--   back. Do not run this against a raw dump.
--
-- * organizers.email and .phone have already been replaced with \N in the file.
--   Asserted again below anyway, inside the transaction, so that a filter that
--   silently did nothing aborts the load instead of committing three people's
--   phone numbers into the fail-open project. Two checks on the same fact, one
--   on the file and one on the wire, because the cost of being wrong here is
--   not recoverable by a truncate.
--
-- * Triggers can be turned off for the load. WHICH WAY depends on probe B1 and
--   is passed in as -v replica=on|off; see the block below. This is not a
--   preference. t30_event_exceptions_flag_parent fires `after insert` on
--   event_exceptions and updates the parent event, which fires
--   t30_events_flag_review and t40_events_set_updated_at on events. Load with
--   triggers live and the restored needs_review and updated_at are not the
--   values that were backed up -- and the diff then fails for a reason that
--   has nothing to do with the backup being wrong.
--
--   THE DUMP SETS THIS ITSELF, AND filter-content-dump.sh STRIPS IT.
--   Measured 2026-09-17: line 1 of a real `supabase db dump --data-only` is
--   `SET session_replication_role = replica;`. So pg_dump does its own trigger
--   handling and the -v replica branch could have been deleted as redundant.
--
--   It is kept, and the deciding argument is the failure case rather than
--   tidiness. If the postgres role on the target project CANNOT set
--   session_replication_role -- which is exactly what probe B1 exists to find
--   out, and which is not knowable from the docs -- then the dump's own line
--   aborts the restore on its first statement, with no alternative path. The
--   per-table branch is the only thing that still works there. Deferring to the
--   dump would delete the fallback for the one case the fallback exists for.
--
--   So the op owns the setting: the filter strips every session_replication_role
--   line and reports how many, and this file decides which method to use. That
--   also keeps the behaviour a property of the operation rather than of a file
--   it received.
--
--   THE TWO BRANCHES ARE NOT EQUIVALENT, and the difference is not the
--   re-enable. It is what happens to FOREIGN KEYS:
--
--     replica=on   session_replication_role disables FK constraint triggers as
--                  well as user triggers. The load is ORDER-INSENSITIVE and
--                  NOTHING enforces referential integrity while it runs. This
--                  is why assertion 2 below is load-bearing rather than
--                  belt-and-braces: under this branch it is the only thing
--                  checking that the restored rows point at anything.
--
--     replica=off  DISABLE TRIGGER USER leaves FKs enforced. The load is
--                  ORDER-SENSITIVE: if the dump emits organizer_members before
--                  organizers, it fails -- and that failure reads like a broken
--                  dump when it is really a branch difference.
--
--   So the branch changes what can go wrong, not merely what has to be tidied
--   up afterwards. If E2 fails with a foreign key error under replica=off,
--   check the COPY order in the dump before suspecting the dump itself.
--
-- * auth.users is writable by this role on dev. That is probe B2. If B2 failed,
--   stop; do not retarget this at a throwaway schema. The FK topology is the
--   part of a real restore most likely to break, and a rehearsal that routes
--   around it rescues the bug instead of revealing it -- the same mistake as
--   installing automatic RLS on dev.
--
--   MEASURED 2026-09-17: production currently has organizer_members = 0 and
--   user_roles = 0, and events.created_by is expected to be null throughout
--   (initial-content.sql was pasted into the SQL editor, where auth.uid() is
--   null). So the dump references auth.users ZERO times, the generated
--   synthetic.sql contains no inserts, and none of the three foreign keys has
--   an instance to break on today.
--
--   THE MACHINERY STAYS. It is correct, and it becomes load-bearing the moment
--   the first organizer signs up -- which is what stage 5 is for. What changed
--   is only that zero is now the EXPECTED count rather than a failure: an empty
--   synthetic.sql is a comment-only file and \i on it is a no-op.
--
--   Note the consequence for stage 5 rather than for this file: with
--   user_roles empty there is no admin, so is_admin() is false for everyone,
--   every admin policy and every SECURITY DEFINER approve function is
--   unreachable, and the approval queue has nobody who can use it. Nothing in
--   deliverable 1 creates that first row and nothing should -- it is a missing
--   step in the stage, not a detail of the backup.
--
-- ----------------------------------------------------------------------------
-- Run:
--     psql -X -q -v ON_ERROR_STOP=1 \
--          -v replica=on \
--          -v synthetic=/path/to/content-<ts>.synthetic.sql \
--          -v dumpfile=/path/to/content-<ts>.filtered.sql \
--          -f supabase/ops/restore-content.sql "$DEV_DB_URL"
--
-- replica=on   B1 succeeded: session_replication_role is available.
-- replica=off  B1 failed with insufficient_privilege: per-table disable.
--
-- Everything is one transaction. A failure at any point leaves dev exactly as
-- it was, which is what makes it safe to re-run after fixing the cause.
-- ----------------------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Silence the triggers.
--
-- The `replica` branch resets automatically at COMMIT because it is SET LOCAL.
-- The per-table branch does NOT: ALTER TABLE ... DISABLE TRIGGER is
-- transactional DDL, so committing would commit the disabled state and leave
-- dev with its triggers off, silently, forever. That is why the second branch
-- has an explicit re-enable before COMMIT and the first does not. Do not
-- "tidy" the asymmetry away.
-- ---------------------------------------------------------------------------
\if :replica
  set local session_replication_role = replica;
  select 'triggers: session_replication_role = ' || current_setting('session_replication_role') as method;
\else
  -- THE THREE-TABLE LIST IS DELIBERATE AND COMPLETE. Do not "fix" it by adding
  -- the other two tables, and do not read the omission as an oversight.
  --
  -- The schema has eight triggers: t40_organizers_set_updated_at,
  -- t10_events_set_slug, t10_events_protect_slug, t05_events_validate,
  -- t30_events_flag_review, t40_events_set_updated_at,
  -- t30_event_exceptions_flag_parent, and t50_members_keep_an_owner.
  --
  -- organizer_members is omitted because its only trigger is
  -- t50_members_keep_an_owner, which is `after delete or update` and so cannot
  -- fire during an insert-only load. user_roles is omitted because it has no
  -- triggers at all.
  --
  -- The day someone adds an INSERT trigger to organizer_members, this list
  -- becomes wrong and nothing will say so. That is the reason this comment
  -- exists rather than a shorter one.
  alter table public.events           disable trigger user;
  alter table public.event_exceptions disable trigger user;
  alter table public.organizers       disable trigger user;
  select 'triggers: per-table DISABLE TRIGGER USER' as method;
\endif

-- ---------------------------------------------------------------------------
-- Identities first: the FKs point this way.
-- uuids only, derived from the dump, no email and no credential material.
-- ---------------------------------------------------------------------------
\i :synthetic

-- ---------------------------------------------------------------------------
-- The content.
-- ---------------------------------------------------------------------------
\i :dumpfile

-- ---------------------------------------------------------------------------
-- ASSERTION 1 -- no contact detail reached dev.
--
-- This aborts the whole transaction if the filter did not do its job, which
-- means the values are never committed and never enter dev's WAL as a
-- committed change. It raises rather than reports, because a report is
-- something a person can read past at the end of a long paste.
--
-- It deliberately does NOT print the offending values.
-- ---------------------------------------------------------------------------
do $$
declare
  n_email int;
  n_phone int;
begin
  select count(*) into n_email from public.organizers where email is not null;
  select count(*) into n_phone from public.organizers where phone is not null;
  if n_email > 0 or n_phone > 0 then
    raise exception
      'REFUSING TO COMMIT: % organizer email and % phone values reached dev. '
      'The dump was not filtered. Roll back, run filter-content-dump.sh, retry.',
      n_email, n_phone;
  end if;
  raise notice 'assertion 1 ok: organizers.email and .phone are entirely null';
end;
$$;

-- ---------------------------------------------------------------------------
-- ASSERTION 2 -- every restored row points at something that exists.
--
-- ALL SIX foreign keys, not just the one to auth.users. Under replica=on the
-- FK constraint triggers are disabled along with the user triggers, so during
-- the load nothing enforces any of them. F1's counts catch a MISSING row;
-- nothing else catches a row pointing at the WRONG parent. This is that
-- something.
--
-- Under replica=off the FKs are enforced and all six of these are guaranteed
-- to pass, which makes this assertion redundant in that branch and cheap in
-- both. Redundant and cheap beats conditional and clever.
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
  problems text := '';
begin
  select count(*) into n from public.organizer_members m
   where not exists (select 1 from auth.users u where u.id = m.user_id);
  if n > 0 then problems := problems || format('%s organizer_members.user_id; ', n); end if;

  select count(*) into n from public.organizer_members m
   where not exists (select 1 from public.organizers o where o.id = m.organizer_id);
  if n > 0 then problems := problems || format('%s organizer_members.organizer_id; ', n); end if;

  select count(*) into n from public.user_roles r
   where not exists (select 1 from auth.users u where u.id = r.user_id);
  if n > 0 then problems := problems || format('%s user_roles.user_id; ', n); end if;

  select count(*) into n from public.events e
   where not exists (select 1 from public.organizers o where o.id = e.organizer_id);
  if n > 0 then problems := problems || format('%s events.organizer_id; ', n); end if;

  select count(*) into n from public.events e
   where e.created_by is not null
     and not exists (select 1 from auth.users u where u.id = e.created_by);
  if n > 0 then problems := problems || format('%s events.created_by; ', n); end if;

  select count(*) into n from public.event_exceptions x
   where not exists (select 1 from public.events e where e.id = x.event_id);
  if n > 0 then problems := problems || format('%s event_exceptions.event_id; ', n); end if;

  if problems <> '' then
    raise exception 'REFUSING TO COMMIT: dangling references -- %', problems;
  end if;
  raise notice 'assertion 2 ok: all six foreign keys resolve';
end;
$$;

-- ---------------------------------------------------------------------------
-- What was loaded. Printed, not asserted: the comparison against production is
-- content_inventory.sql's job, and duplicating it here would put the same
-- judgement in two files that can disagree.
--
-- THE UNION IS WRAPPED IN A SUBQUERY SO THAT COLLATE IS LEGAL. Do not unwrap it.
--
-- ORDER BY after a set operation accepts ONLY a bare output column name or an
-- ordinal -- never an expression. So `order by 1 collate "C"` and
-- `order by tbl collate "C"` are BOTH rejected, with `invalid
-- UNION/INTERSECT/EXCEPT ORDER BY clause: Only result column names can be
-- used, not expressions or functions`.
--
-- An earlier version of this comment claimed the fault was that `1 COLLATE "C"`
-- is an integer carrying a collation. That diagnosis was wrong -- the parser
-- never gets that far -- and the fix it recommended fails the same way. It is
-- recorded here because a comment that confidently explains the wrong mechanism
-- is what stops the next person fixing it correctly.
--
-- Note also that this is a parse-ANALYSIS error and not a grammar error: the
-- statement parses cleanly and only a live server rejects it. No static check
-- catches it. It was caught by running the teardown at step B4 on 2026-09-17.
--
-- The pattern below is content_inventory.sql's Section 1, which executed
-- against both projects at step A8, so it is known to run on 17.6.
--
-- The collation pin is not decorative: `organizer_members` and `organizers`
-- first differ at `_` versus `s`, and C and en_US disagree about where an
-- underscore sorts.
-- ---------------------------------------------------------------------------
select * from (
  select 'auth.users'        as tbl, count(*) as n from auth.users
  union all select 'organizers',        count(*) from public.organizers
  union all select 'organizer_members', count(*) from public.organizer_members
  union all select 'user_roles',        count(*) from public.user_roles
  union all select 'events',            count(*) from public.events
  union all select 'event_exceptions',  count(*) from public.event_exceptions
) counts
order by counts.tbl collate "C";

-- ---------------------------------------------------------------------------
-- Put the triggers back, in the branch where they do not come back by
-- themselves. See the note at the top of the file.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Put the triggers back, in the branch where they do not come back by
-- themselves.
--
-- PURE SQL, NO psql META-COMMAND. This used to be a trailing `\if :replica`
-- block. pg_dump 17.6 and later emit `\restrict <token>` near the top of a dump
-- and `\unrestrict <token>` at the end; while restricted, psql meta-commands
-- are disabled. A `\if` AFTER `\i :dumpfile` therefore depends on the dump
-- having unrestricted itself properly -- a dependency on a file this op
-- received, at the last step before COMMIT, discovered only at runtime.
--
-- set_config with is_local => true is transaction-scoped and resets at COMMIT,
-- so the branch is carried in a GUC instead. Note the variable is read with
-- current_setting INSIDE the DO block rather than interpolated as :'replica':
-- psql does not substitute variables inside dollar-quoted strings, so an
-- interpolated form would not work here even though it looks like it should.
--
-- The leading branch is still a \if because it runs BEFORE \i :dumpfile, where
-- meta-commands are certainly available.
-- ---------------------------------------------------------------------------
select set_config('nissartango.replica', :'replica', true);

do $$
begin
  if current_setting('nissartango.replica') = 'off' then
    execute 'alter table public.events           enable trigger user';
    execute 'alter table public.event_exceptions enable trigger user';
    execute 'alter table public.organizers       enable trigger user';
    raise notice 'triggers: re-enabled explicitly';
  else
    raise notice 'triggers: session_replication_role resets at commit';
  end if;
end;
$$;

commit;
