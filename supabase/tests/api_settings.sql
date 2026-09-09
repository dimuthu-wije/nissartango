-- The three Data API settings, MEASURED rather than read off a dashboard.
--
-- Two of the three are not really dashboard state at all: "automatically
-- expose new tables" is implemented as Postgres default privileges owned by
-- `postgres`, and "automatic RLS" shows up as whether a freshly created table
-- arrives with relrowsecurity set. Both are therefore readable here, and a
-- reading beats a checkbox — especially for a project created through a flow
-- that may not have asked.
--
-- Run it in the SQL editor of each project and diff the two outputs. It is
-- READ-ONLY: the probe creates a table inside a transaction that is always
-- rolled back, so nothing is committed anywhere.
--
--   setting                     value        expected
--   --------------------------- ------------ ------------
--   auto_expose_new_tables      off          off
--   automatic_rls               on           on
--   data_api                    (see note)   on

begin;

-- `informational` rows carry no verdict. Without it the service_role row
-- compared an observation to itself and reported 'ok', which is a check that
-- can never fail and therefore is not a check.
create temp table _probe_result(
  setting text, value text, expected text, detail text,
  informational boolean not null default false);

-- ONE definition of "base table", shared by every row that counts them, so
-- two rows can never disagree about how many there are. The probe table below
-- is excluded here and named in the details, so a future reading of N is
-- interpretable against this one.
create temp table _base_tables as
  select c.relname, c.relacl::text as acl, c.relrowsecurity as rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')   -- ordinary and partitioned; views cannot have RLS
     and c.relname <> '_api_settings_probe';

-- 1. AUTO-EXPOSE. The dashboard checkbox writes default privileges:
--      alter default privileges for role postgres in schema public
--        revoke select, insert, update, delete on tables from anon, authenticated, service_role;
--    so the setting IS this catalogue. Entries owned by supabase_admin are the
--    platform's own and are neither reachable nor revokable -- they fire only
--    for objects supabase_admin creates -- so they are excluded here.
insert into _probe_result (setting, value, expected, detail)
select
  'auto_expose_new_tables',
  case when count(*) = 0 then 'off' else 'ON  <-- new tables are public by default' end,
  'off',
  coalesce(string_agg(format('%s in %s: %s', pg_get_userbyid(d.defaclrole),
                             coalesce(n.nspname, '-'), d.defaclacl::text), '; '), 'no entries')
from pg_default_acl d
left join pg_namespace n on n.oid = d.defaclnamespace
where pg_get_userbyid(d.defaclrole) <> 'supabase_admin'
  and coalesce(n.nspname, 'public') = 'public'
  and d.defaclacl::text ~ '(anon|authenticated)=';

-- 2. AUTOMATIC RLS. Create a table and look at it. Inside the transaction that
--    is about to be rolled back, so this is a measurement, not a change.
create table if not exists public._api_settings_probe(id int);

insert into _probe_result (setting, value, expected, detail)
select
  'automatic_rls',
  case when c.relrowsecurity then 'on' else 'OFF <-- a forgotten table would be unprotected' end,
  'on',
  format('a new table arrived with relrowsecurity=%s, grants=%s',
         c.relrowsecurity, coalesce(c.relacl::text, 'none'))
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = '_api_settings_probe';

-- 2b. And what that new table actually granted, which is the outcome setting 1
--     is trying to control. This is the line that matters most.
insert into _probe_result (setting, value, expected, detail)
select
  'new_table_grants_to_anon',
  case when coalesce(c.relacl::text, '') ~ 'anon=' then 'GRANTED <-- publicly readable'
       else 'none' end,
  'none',
  coalesce(c.relacl::text, 'no acl (owner only)')
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = '_api_settings_probe';

-- 3. DATA API. Not a Postgres fact: it is whether the platform runs PostgREST
--    in front of this database, so it is checked over HTTP.
--
--    NOT by requesting the bare root: /rest/v1/ returns 401 even when the API
--    is perfectly healthy, and the key belongs in HEADERS -- apikey and
--    Authorization -- not in a query parameter. An earlier version of this
--    file said otherwise and would have told you the API was off when it was
--    fine. Ask for a real table instead:
--
--      curl -s -o /dev/null -w '%{http_code}\n' \
--        -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--        "https://<ref>.supabase.co/rest/v1/events_public?select=id&limit=1"
--
--    200 means on. On an EMPTY project with no tables yet, ask for one that
--    cannot exist and read the error body: PGRST205 ("Could not find the
--    table ... in the schema cache") proves PostgREST is up AND that it
--    accepted the key, which is exactly the pair of facts wanted:
--
--      curl -s -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--        "https://<ref>.supabase.co/rest/v1/definitely_not_a_table"
--
--    401 with either probe means the key was rejected, not that the API is off.
insert into _probe_result (setting, value, expected, detail, informational) values
  ('data_api', 'not measurable in SQL', 'on',
   'curl -H "apikey: $ANON" .../rest/v1/events_public?select=id&limit=1 -> 200; '
   'on an empty project, .../rest/v1/no_such_table -> PGRST205', true);

-- 4. ANON'S PRIVILEGES ON BASE TABLES. The check that matters after a
--    `supabase db push` into a project that was born fail-open.
--
--    `alter default privileges ... revoke` does NOT reach backwards: a table
--    created earlier in the same push keeps whatever the platform granted it
--    at CREATE TABLE time. Measured, not assumed -- on a fail-open project,
--    public.events created by migration 20260828181200 arrives carrying
--    anon=arwdDxt, and 20260829090000_fail_closed_defaults.sql, which only
--    changes DEFAULT privileges, leaves it exactly as it is.
--
--    What saves it is that every stage-1 migration also does an explicit
--    `revoke all on table ... from anon, authenticated`. This asserts that it
--    worked. The intended end state is precise: anon reads the three _public
--    views and holds NOTHING on any base table.
--    Counting only the offending tables would pass on an empty schema as
--    happily as on a correct one, so the total is counted separately and a
--    schema with no base tables reports that rather than 'none'.
with bad as (
  select * from _base_tables where coalesce(acl, '') ~ 'anon=[a-zA-Z]'
)
insert into _probe_result (setting, value, expected, detail)
select
  'anon_privileges_on_base_tables',
  case when (select count(*) from _base_tables) = 0
         then 'NO BASE TABLES <-- nothing was checked'
       when (select count(*) from bad) = 0 then 'none'
       else 'HELD <-- ' || (select count(*) from bad) || ' table(s)' end,
  'none',
  case when (select count(*) from _base_tables) = 0
       then 'the schema has no base tables; this assertion proved nothing'
       else (select count(*) from _base_tables)
            || ' base table(s), excluding _api_settings_probe; '
            || coalesce((select string_agg(format('%s: %s', relname, acl), '; ') from bad),
                        'none grants anything to anon')
  end;

-- 4b. And the same for service_role, as INFORMATION rather than a verdict.
--     Nothing here uses the service_role key, and no migration grants to it --
--     but a fail-open project grants it at table creation, so a project born
--     fail-open will differ from one born fail-closed on exactly this line.
--     Recorded so that difference reads as explained rather than alarming.
insert into _probe_result (setting, value, expected, detail, informational)
select
  'service_role_on_base_tables',
  count(*) || ' of ' || (select count(*) from _base_tables) || ' base table(s)',
  null,
  'informational, no verdict. MEASURED 2026-09-11: 5 of 5 on BOTH projects, '
  || 'like-for-like with this file. An earlier version of this line predicted '
  || 'that a project born fail-open would differ from one born fail-closed; '
  || 'its own measurement contradicted that, so the prediction is gone and the '
  || 'observation is here instead. Supabase keeps service_role on new tables '
  || 'either way; the stage-1 revokes name only anon/authenticated, and '
  || 'nothing in this project uses that key. Excludes _api_settings_probe.'
  || case when count(*) > 0
          then ' Tables: ' || string_agg(relname, ', ') else '' end,
  true
from _base_tables
where coalesce(acl, '') ~ 'service_role=[a-zA-Z]';

-- 4c. RLS ON EVERY BASE TABLE. A real assertion, and the one that turns the
--     dev/prod asymmetry into a test of this repository.
--
--     Production has the platform's automatic-RLS event trigger, so it passes
--     here whatever the migrations say — a table created without `enable row
--     level security` is silently fixed and nobody finds out. Dev has no such
--     net, by deliberate decision (see PROJECT_SETUP.md). So on dev this row
--     passes ONLY if the migrations genuinely enable RLS themselves, which
--     makes dev the place a defective migration is visible at all.
--
--     Read a failure here on DEV as "a migration forgot enable row level
--     security". Read a failure on PRODUCTION as that plus "and the event
--     trigger is not doing its job either", which is worse.
with missing as (
  select relname from _base_tables where not rls
)
insert into _probe_result (setting, value, expected, detail)
select
  'rls_on_all_base_tables',
  case when (select count(*) from _base_tables) = 0
         then 'NO BASE TABLES <-- nothing was checked'
       when (select count(*) from missing) = 0 then 'all'
       else 'MISSING on ' || (select count(*) from missing) || ' table(s)' end,
  'all',
  case when (select count(*) from _base_tables) = 0
       then 'the schema has no base tables; this assertion proved nothing'
       else (select count(*) from _base_tables)
            || ' base table(s), excluding _api_settings_probe; '
            || coalesce((select 'WITHOUT RLS: ' || string_agg(relname, ', ') from missing),
                        'every one has relrowsecurity = t')
  end;

-- 5. HOW automatic RLS is (or is not) installed, and whether a migration
--    could install it here.
--
--    Supabase implements automatic RLS as a Postgres EVENT TRIGGER, not as a
--    row in a settings table. Two facts decide whether it can live in this
--    repository or has to live on a per-project checklist, and both are
--    readable rather than arguable.

-- 5a. What is actually installed. On a project where new tables arrive with
--     relrowsecurity=t, the object doing that should be visible here.
insert into _probe_result (setting, value, expected, detail, informational)
select
  'rls_event_triggers',
  case when count(*) = 0 then 'none installed' else count(*) || ' installed' end,
  null,
  coalesce(string_agg(format('%s (%s, owner %s, on %s)',
                             evtname, evtenabled, pg_get_userbyid(evtowner), evtevent), '; '),
           'pg_event_trigger is empty — nothing is forcing RLS on new tables'),
  true
from pg_event_trigger;

-- 5b. Could a migration create one HERE? Attempted for real, inside the
--     transaction that is about to be rolled back, and the exception caught --
--     because "postgres is not a superuser on Supabase" is a claim about the
--     platform and this is the project in front of us.
do $$
declare verdict text; detail text;
begin
  begin
    execute 'create or replace function pg_temp._probe_evt_fn() returns event_trigger '
            'language plpgsql as $f$ begin null; end $f$';
    execute 'create event trigger _probe_evt on ddl_command_end '
            'execute function pg_temp._probe_evt_fn()';
    execute 'drop event trigger _probe_evt';
    verdict := 'yes';
    detail  := 'this role created and dropped an event trigger, so automatic RLS '
               'CAN be versioned here. It lives in supabase/ops/install-ensure-rls.sql '
               'and NOT in supabase/migrations/ -- a migration would install it on dev '
               'too and kill the canary. See PROJECT_SETUP.md';
  exception
    when insufficient_privilege then
      verdict := 'no';
      detail  := 'permission denied. NOTE: this was expected once and measured to be '
                 'FALSE on both projects -- the migration role created one fine. If you '
                 'are reading this, the platform changed; re-check before concluding '
                 'automatic RLS cannot be versioned here';
    when others then
      verdict := 'unknown';
      detail  := 'attempt failed with ' || sqlstate || ': ' || sqlerrm;
  end;
  insert into _probe_result (setting, value, expected, detail, informational)
  values ('can_a_migration_install_automatic_rls', verdict, null, detail, true);
end $$;

select setting,
       value,
       coalesce(expected, '—') as expected,
       case when informational   then 'info'
            when value = expected then 'ok'
            else 'LOOK AT THIS' end as verdict,
       detail
  from _probe_result
 order by informational, setting;

rollback;
