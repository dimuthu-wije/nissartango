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

create temp table _probe_result(setting text, value text, expected text, detail text);

-- 1. AUTO-EXPOSE. The dashboard checkbox writes default privileges:
--      alter default privileges for role postgres in schema public
--        revoke select, insert, update, delete on tables from anon, authenticated, service_role;
--    so the setting IS this catalogue. Entries owned by supabase_admin are the
--    platform's own and are neither reachable nor revokable -- they fire only
--    for objects supabase_admin creates -- so they are excluded here.
insert into _probe_result
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

insert into _probe_result
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
insert into _probe_result
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
--    in front of this database. The honest check is an HTTP one --
--    `curl -s -o /dev/null -w '%{http_code}' "$URL/rest/v1/?apikey=$ANON"`
--    returns 200 when it is on. Recorded here so the three settings stay
--    together in one output.
insert into _probe_result values
  ('data_api', 'check over HTTP, not SQL', 'on',
   'GET /rest/v1/ with the publishable key returns 200 when enabled');

select setting,
       value,
       expected,
       case when value = expected or setting = 'data_api' then 'ok' else 'LOOK AT THIS' end as verdict,
       detail
  from _probe_result
 order by setting;

rollback;
