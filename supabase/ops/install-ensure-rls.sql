-- Install the automatic-RLS event trigger. PRODUCTION ONLY.
--
-- ============================================================================
-- THIS FILE IS DELIBERATELY NOT IN supabase/migrations/.
-- ============================================================================
--
-- Not an oversight, and please do not "tidy" it into the migrations directory.
-- A migration is applied to every project the repo is pushed to. This must be
-- applied to production and NOT to nissartango-dev, because those two projects
-- are deliberately different and the difference is a test:
--
--   Production has this trigger. A table created without `enable row level
--   security` is silently corrected, which is the safety net you want on the
--   database that is serving.
--
--   Dev does not. So on dev, `rls_on_all_base_tables` in
--   supabase/tests/api_settings.sql passes ONLY if the migrations genuinely
--   enable RLS themselves. Dev is the one place a defective migration is
--   visible rather than rescued.
--
-- Push this into supabase/migrations/ and it installs on dev the next time
-- anyone runs `supabase db push`, and the canary dies that day -- silently,
-- because everything will still look green. See "DECIDED: do not enable
-- automatic RLS on dev" in supabase/PROJECT_SETUP.md.
--
-- ============================================================================
-- PROVENANCE -- read this before trusting the body below
-- ============================================================================
--
-- The purpose of this file is that the repo describes what production actually
-- runs. The body between the markers below is a VERBATIM capture of
-- public.rls_auto_enable from eqcgeqzzuzcwrflwasjo, taken on 2026-09-11 with:
--
--     psql "$PROD_DB_URL" -At -c \
--       "select pg_get_functiondef('public.rls_auto_enable'::regproc)"
--
-- Do not edit inside the markers, and do not tidy it. Two things in there look
-- like they want cleaning up and must not be touched:
--
--   * The schema test is belt-and-braces. `schema_name IN ('public')` already
--     excludes every system schema, so the NOT IN ('pg_catalog',
--     'information_schema') and the two NOT LIKE clauses after it are
--     redundant. They stay. The file's job is to MATCH, and a tidier version
--     is a divergence that makes the next capture look like a change.
--   * `alter table IF EXISTS` and the log-only exception handler are likewise
--     production's choices, not this repo's.
--
-- To re-verify at any time, capture again and diff against the marked block.
-- Any difference means production changed under you, or someone edited this
-- file -- and both are worth knowing.
--
-- All commentary lives OUTSIDE the markers so the capture stays byte-clean.
-- Nothing else in this file writes to the function: the `comment on function`
-- an earlier draft added was dropped, because applying this file should leave
-- production exactly as it was.
--
-- An earlier draft of this file used SECURITY INVOKER, arguing that a
-- DEFINER event trigger runs DDL-triggered code as postgres for anyone who can
-- create a table. That argument is answered by production's `SET search_path
-- TO 'pg_catalog'`, which closes the path it was aimed at. The INVOKER variant
-- was considered and DROPPED: divergence from what production runs costs more
-- than the marginal hardening gained, and a file that describes something
-- other than production is worse than no file.
--
-- ----------------------------------------------------------------------------
-- Apply with:
--     psql "$PROD_DB_URL" -f supabase/ops/install-ensure-rls.sql
-- Then confirm with:
--     psql "$PROD_DB_URL" -f supabase/tests/api_settings.sql
-- expecting rls_event_triggers to name ensure_rls, and automatic_rls = on.
-- ----------------------------------------------------------------------------
--
-- Note on privilege: `create event trigger` is documented as requiring
-- superuser, and an earlier version of PROJECT_SETUP.md recorded that as the
-- reason this could not be versioned. Measurement contradicted it -- the role
-- migrations run as created and dropped one on both projects, and production's
-- ensure_rls is owned by `postgres`, not `supabase_admin`. If this ever fails
-- with insufficient_privilege on a new project, that is the platform changing,
-- not this file being wrong: re-measure with
-- can_a_migration_install_automatic_rls before rewriting anything.

begin;

-- A previous draft of this file created public.ensure_rls(). Production's
-- function is named rls_auto_enable and its TRIGGER is named ensure_rls, so
-- this drops the stale function without touching production's trigger.
drop function if exists public.ensure_rls();

-- >>>>>>>>>> BEGIN verbatim capture -- DO NOT EDIT INSIDE THESE MARKERS <<<<<<<<<<
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;
-- >>>>>>>>>>  END verbatim capture  <<<<<<<<<<


-- `create event trigger` has no IF NOT EXISTS, and this file has to be
-- re-runnable: applying it twice must be a no-op, not an error.
do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls
      on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable();
    raise notice 'ensure_rls: event trigger created';
  else
    raise notice 'ensure_rls: event trigger already present, left alone';
  end if;
end;
$$;

-- Say what is now installed, so applying this file is also a check.
select evtname,
       evtenabled,
       pg_get_userbyid(evtowner) as owner,
       evtevent,
       evttags,
       (select p.proname from pg_proc p where p.oid = e.evtfoid) as calls
  from pg_event_trigger e
 where evtname = 'ensure_rls';

commit;
