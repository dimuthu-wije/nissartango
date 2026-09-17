-- ============================================================================
-- supabase/ops/teardown-dev-rehearsal.sql
--
-- Return nissartango-dev (hjsekipqryfuwdkhxuks) to empty after a restore
-- rehearsal.
--
-- ============================================================================
-- DEV ONLY. DO NOT POINT THIS AT PRODUCTION. IT TRUNCATES.
-- ============================================================================
--
-- ----------------------------------------------------------------------------
-- WHY THERE IS NO TRIGGER BRANCH HERE. NOT AN OVERSIGHT.
-- ----------------------------------------------------------------------------
--
-- restore-content.sql takes -v replica=on|off and branches on it. This file
-- deliberately does NOT, and a future reader should not "restore the missing
-- branch". It was written with one and the branch was removed, because nothing
-- it could protect against can fire here:
--
--   * TRUNCATE fires only BEFORE/AFTER TRUNCATE **statement** triggers. All
--     eight triggers in this schema are FOR EACH ROW on insert/update/delete;
--     none is statement-level and none mentions truncate. So the truncate below
--     fires nothing whether triggers are enabled or not.
--
--   * `delete from auth.users` reaches public through three foreign keys, and
--     all three find their tables already empty:
--       organizer_members.user_id  on delete CASCADE   -- truncated above
--       user_roles.user_id         on delete CASCADE   -- truncated above
--       events.created_by          on delete SET NULL  -- truncated above
--     The first would fire t50_members_keep_an_owner (`after delete or update
--     on organizer_members`). The third is the one worth noticing: SET NULL is
--     an UPDATE on public.events, which would fire four triggers --
--     t05_events_validate, t10_events_protect_slug, t30_events_flag_review and
--     t40_events_set_updated_at. With zero rows, none of them fires.
--
-- SO THE ORDER IS LOAD-BEARING, not the trigger settings. TRUNCATE must come
-- before DELETE FROM auth.users. Reverse those two statements and this file
-- needs its branch back, because the SET NULL path would then update every
-- restored event row on its way past. If you ever reorder them, restore the
-- branch in the same edit.
--
-- Removing the branch rather than getting it right removes a privilege
-- dependency from teardown entirely: this file cannot fail with
-- insufficient_privilege, at the moment when failing would leave dev full.
--
-- ----------------------------------------------------------------------------
-- WHY THIS IS A FILE AND NOT A HEREDOC IN THE RUNBOOK
-- ----------------------------------------------------------------------------
--
-- IT HAS TO DELETE THE SET THAT WAS ACTUALLY LOADED. The synthetic auth.users
-- rows are derived from the dump, not from step D2's query against production.
-- The heredoc version deleted "D2's uuid set", so in exactly the case D2 exists
-- to detect -- the two sets differing -- a synthetic row would survive
-- teardown, dev would not be empty, and every future compare-projects.sh run
-- would diff on content forever. The uuids passed in here are extracted from
-- content-<ts>.synthetic.sql, which is the file that created them.
--
-- The belt-and-braces is the final assertion: auth.users must end at zero. B3
-- established it was zero before the rehearsal, so anything left is something
-- this file failed to remove, and it raises rather than reporting. That
-- assertion is now the ONLY thing standing behind the teardown, since the
-- trigger branch is gone -- do not weaken it.
--
-- ----------------------------------------------------------------------------
-- THIS FILE RUNS TWICE, BEFORE AND AFTER
-- ----------------------------------------------------------------------------
--
-- Measured 2026-09-17: dev was NOT empty. It held 4 events, 3 organizers and 1
-- event_exception -- content from data/initial-content.sql, with every row
-- digest differing from production's. So a rehearsal that starts by restoring
-- into dev would be loading on top of someone else's content.
--
-- Hence step B4 runs this file BEFORE the rehearsal with an empty uuid list,
-- and step G runs it again afterwards with the list from the synthetic file.
-- Same file both times: a teardown that only exists at the end is a teardown
-- that has never been rehearsed either.
--
-- Running it at B4 DISCARDS dev's current content. That is recoverable --
-- data/initial-content.sql reloads it -- and dev is the disposable project by
-- design. Confirm before running it the first time, not after.
--
-- ----------------------------------------------------------------------------
-- Run:
--     # after the rehearsal (step G) -- the set the restore actually loaded:
--     UUIDS=$(grep -oE "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" "$SYN" \
--               | grep -v '^00000000-0000-0000-0000-000000000000$' \
--               | sort -u | paste -sd, -)
--
--     THE PATTERN MUST NOT INCLUDE THE SURROUNDING QUOTES, and the shorter
--     `'[0-9a-f-]{36}'` form is wrong for that reason, not for being loose.
--     With quotes in the pattern the captured element is
--         'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
--     quotes and all. psql's :'uuidlist' then wraps the whole list again, so
--     string_to_array yields an element containing literal single quotes,
--     id::text is a bare uuid, nothing matches, and the DELETE silently removes
--     nothing. The teardown then runs to its final assertion, finds auth.users
--     non-empty and aborts -- loud, but at the moment it first matters, which is
--     the first rehearsal after an organizer signs up.
--
--     WITH ZERO UUIDS THE TWO FORMS ARE INDISTINGUISHABLE. Both produce an
--     empty list and both delete nothing correctly, which is why this could sit
--     in the file through a passing rehearsal. Same class as every other bug
--     found this week: a path only the absent case leaves untested.
--
--     # before the rehearsal (step B4) -- nothing synthetic exists yet:
--     UUIDS=""
--
--     psql -X -q -v ON_ERROR_STOP=1 --pset=pager=off \
--          -v uuidlist="$UUIDS" \
--          -f supabase/ops/teardown-dev-rehearsal.sql "$DEV_DB_URL"
--
-- No -v replica: see above. An empty UUIDS is valid and deletes nothing; the
-- assertion at the end is what proves auth.users ended empty either way.
-- ----------------------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- TRUNCATE order does not matter under CASCADE, but the list is spelled out
-- rather than discovered, for the same reason content_inventory.sql hard-codes
-- five tables: a table in public that no migration created should be a finding,
-- not something a teardown silently wipes.
--
-- THIS STATEMENT MUST COME BEFORE THE DELETE BELOW. See the header: with these
-- five tables empty, the delete's three cascade paths -- two CASCADE and one
-- SET NULL onto public.events -- all touch zero rows, which is what makes the
-- trigger branch unnecessary. Reversed, the SET NULL path updates every
-- restored event and fires four triggers.
--
-- Counted first and raised as a notice for the same reason the delete below is
-- wrapped: `TRUNCATE TABLE` is a command tag and psql -q suppresses it, so
-- without this nothing states whether the truncate cleared 8 rows or 0. The
-- final counts table shows only the after state, which is zeros either way.
do $$
declare n int;
begin
  select (select count(*) from public.event_exceptions)
       + (select count(*) from public.events)
       + (select count(*) from public.organizer_members)
       + (select count(*) from public.user_roles)
       + (select count(*) from public.organizers)
    into n;
  raise notice 'teardown: clearing % content row(s) across 5 tables', n;
end;
$$;

truncate public.event_exceptions,
         public.events,
         public.organizer_members,
         public.user_roles,
         public.organizers
  cascade;

-- ---------------------------------------------------------------------------
-- The synthetic identities.
--
-- Wrapped in a DO block with GET DIAGNOSTICS, not issued as a bare DELETE.
--
-- The invocation this file prescribes uses psql -q, which suppresses command
-- tags -- so a bare `delete` emits no `DELETE 0`, and the observable proof that
-- this statement ran at all would be nothing. NOTICEs go to stderr through the
-- notice processor and survive -q, so the count is raised instead of implied.
-- Measured 2026-09-17 at step B4: the tag was absent, the notices were not.
--
-- It matters later rather than now. With an empty list the answer is zero
-- either way. Once organizers have signed up, this notice is the only thing
-- that distinguishes "deleted three synthetic rows" from "matched none and
-- moved on", and those two look identical from the final counts table.
--
-- `= any (string_to_array(...))`, NOT `id in (:uuids)`. As measured on
-- 2026-09-17, production has organizer_members = 0 and user_roles = 0 and
-- events.created_by is expected to be null throughout, so the dump references
-- auth.users ZERO times and the extracted list is EMPTY. With the old form,
-- `delete from auth.users where id in ()` is a syntax error -- teardown would
-- fail, in the normal case, at the step whose whole job is to leave dev clean.
--
-- An empty :'uuidlist' makes string_to_array return either {} or {""} depending
-- on version; both match nothing and both delete nothing, which is the correct
-- behaviour here. The zero case is the EXPECTED case today and stops being so
-- the moment one organizer signs up.
--
-- id::text rather than casting the array to uuid[], so that a malformed entry
-- in the list matches nothing instead of raising. The assertion below is what
-- catches a list that failed to match, not a cast error.
-- ---------------------------------------------------------------------------
-- THE INTERPOLATION MUST HAPPEN OUTSIDE THE DO BLOCK. psql does not substitute
-- variables inside dollar-quoted strings, so `:'uuidlist'` written directly in
-- the body reaches the server as literal text and fails with
-- `ERROR: syntax error at or near ":"`. Measured at step G, 2026-09-17.
--
-- The chain that produced it is worth seeing whole: making the delete count
-- observable needs GET DIAGNOSTICS, which needs plpgsql, which needs a DO
-- block, which eats the interpolation. The requirement was right and it moved
-- the statement into a context where the existing parameter passing stopped
-- working.
--
-- set_config(..., true) is transaction-scoped and resets at COMMIT. On an empty
-- list current_setting returns '', string_to_array('', ',') gives an empty
-- array, and the zero case still matches nothing -- so this keeps the property
-- the `= any (string_to_array(...))` form was chosen for.
select set_config('nissartango.uuidlist', :'uuidlist', true);

do $$
declare n int;
begin
  delete from auth.users
   where id::text = any (string_to_array(current_setting('nissartango.uuidlist'), ','));
  get diagnostics n = row_count;
  raise notice 'teardown: deleted % synthetic auth.users row(s)', n;
end;
$$;

-- ---------------------------------------------------------------------------
-- The assertion that makes the two fixes above safe even if both are wrong.
-- ---------------------------------------------------------------------------
do $$
declare leftover int;
begin
  select count(*) into leftover from auth.users;
  if leftover > 0 then
    raise exception
      'REFUSING TO COMMIT TEARDOWN: % rows left in auth.users. Dev was empty '
      'before the rehearsal (step B3), so these are synthetic rows this file '
      'did not remove -- most likely the uuid list did not match the synthetic '
      'file. Roll back and re-extract.', leftover;
  end if;
  raise notice 'teardown ok: auth.users is empty';
end;
$$;

-- No trigger re-enable block, because nothing was disabled. See the header.

-- ---------------------------------------------------------------------------
-- The UNION is wrapped in a subquery so that COLLATE is legal.
--
-- ORDER BY after a set operation accepts ONLY a bare output column name or an
-- ordinal -- never an expression. Both `order by 1 collate "C"` and
-- `order by tbl collate "C"` are rejected with `invalid UNION/INTERSECT/EXCEPT
-- ORDER BY clause`. That is a parse-ANALYSIS error, not a grammar error, so it
-- parses cleanly and only a live server catches it: measured here on
-- 2026-09-17, at this exact statement.
--
-- Wrapping moves the sort outside the set operation, where COLLATE is an
-- ordinary expression again. This is the pattern content_inventory.sql uses in
-- Section 1, and that file executed against production and dev at step A8, so
-- the pattern is known to run on 17.6 rather than merely believed to.
--
-- The collation pin is not decorative. `organizer_members` and `organizers`
-- first differ at `_` versus `s`, and C and en_US disagree about where an
-- underscore sorts -- so dropping to a bare `order by 1` could order those two
-- rows differently on two projects and show up as a spurious difference.
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

commit;
