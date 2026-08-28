-- ============================================================================
-- grants_check.sql -- READ ONLY. Safe to run against any project, including
-- production. It writes nothing, creates nothing and needs no fixtures.
--
-- This is the half of the test suite that local cannot answer: the platform's
-- own default privileges, what the extensions actually installed as, and
-- whether our REVOKEs won against whatever Supabase granted. Run it right
-- after the first `supabase db push`.
--
--   Dashboard -> SQL Editor -> paste this file      (simplest)
--   or: psql "$HOSTED_DB_URL" -f supabase/tests/grants_check.sql
--
-- Every row should read PASS. Anything else, send me the table.
-- ============================================================================

with checks as (

  -- ---- the entire anon surface --------------------------------------------
  select 1 as n, 'anon: table/view privileges in public' as check_name,
         'event_exceptions_public:SELECT events_public:SELECT organizers_public:SELECT' as expected,
         coalesce(string_agg(distinct table_name || ':' || privilege_type, ' '
                             order by table_name || ':' || privilege_type), 'none') as actual
    from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public'

  union all
  select 2, 'anon: executable functions in public',
         'none',
         coalesce(string_agg(distinct routine_name, ' ' order by routine_name), 'none')
    from information_schema.role_routine_grants
   where grantee = 'anon' and specific_schema = 'public'

  -- ---- what editors may call ----------------------------------------------
  union all
  select 3, 'authenticated: executable functions',
         'approve_event is_admin is_event_member is_member is_owner mark_reviewed reject_event slugify uuid_or_null',
         coalesce(string_agg(distinct routine_name, ' ' order by routine_name), 'none')
    from information_schema.role_routine_grants
   where grantee = 'authenticated' and specific_schema = 'public'

  -- ---- the columns an editor can write ------------------------------------
  union all
  select 4, 'authenticated: forbidden columns on events',
         'none',
         coalesce(string_agg(distinct column_name, ' ' order by column_name), 'none')
    from information_schema.column_privileges
   where grantee = 'authenticated' and table_schema = 'public' and table_name = 'events'
     and privilege_type in ('INSERT', 'UPDATE')
     and column_name in ('id','slug','status','needs_review','review_note',
                         'created_by','created_at','updated_at')

  -- ---- RLS is on, everywhere ----------------------------------------------
  union all
  select 5, 'RLS enabled on every public table',
         'all',
         coalesce(nullif(string_agg(c.relname, ' ' order by c.relname)
                         filter (where not c.relrowsecurity), ''), 'all')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'

  -- ---- the views exist and are the right kind -----------------------------
  union all
  select 6, 'public views bypass RLS (security_invoker off)',
         'event_exceptions_public events_public organizers_public',
         coalesce(string_agg(c.relname, ' ' order by c.relname), 'none')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and c.relname in ('events_public','organizers_public','event_exceptions_public')
     and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=true%'

  union all
  select 7, 'the admin queue view obeys the caller (invoker on)',
         'organizers_without_owner',
         coalesce(string_agg(c.relname, ' '), 'MISSING or wrong')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and c.relname = 'organizers_without_owner'
     and coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=true%'

  -- ---- the private columns are not in the public view ---------------------
  union all
  select 8, 'organizers_public exposes no email/phone',
         'none',
         coalesce(string_agg(column_name, ' '), 'none')
    from information_schema.columns
   where table_schema = 'public' and table_name = 'organizers_public'
     and column_name in ('email','phone')

  -- ---- helpers are DEFINER, and pinned ------------------------------------
  union all
  select 9, 'SECURITY DEFINER functions all pin search_path',
         'none',
         coalesce(string_agg(p.proname, ' ' order by p.proname), 'none')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'))  cfg
                      where cfg like 'search_path=%')

  -- ---- the image bucket is private ----------------------------------------
  union all
  select 10, 'event-images bucket is private',
         'private',
         coalesce((select case when public then 'PUBLIC' else 'private' end
                     from storage.buckets where id = 'event-images'), 'MISSING')

  -- ---- nothing is granted to anon/authenticated BY DEFAULT ----------------
  -- The code half of the dashboard's "Automatically expose new tables" toggle.
  --
  -- Scoped to the roles that create objects HERE. ALTER DEFAULT PRIVILEGES is
  -- per creating-role: a default owned by role R only fires for objects R
  -- creates. Migrations, the SQL editor and the table editor all act as
  -- `postgres`, so `postgres` is the role whose defaults decide whether a
  -- table you add tomorrow is public. See check 13 for the rest.
  union all
  select 12, 'no default privileges for anon/authenticated (roles we own)',
         'none',
         coalesce(string_agg(distinct pg_get_userbyid(d.defaclrole) || ':' || x.entry::text, ' '), 'none')
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral unnest(d.defaclacl) as x(entry)
   where n.nspname = 'public'
     and (x.entry::text like 'anon=%' or x.entry::text like 'authenticated=%')
     and pg_get_userbyid(d.defaclrole) in ('postgres', current_user)

  -- ---- the platform's own defaults, which we cannot alter -----------------
  -- A hosted project shows supabase_admin defaults granting everything to anon
  -- on future tables. They are NOT a hole: they fire only for objects
  -- supabase_admin creates, which is the platform itself, never us -- and
  -- `postgres` is not a member of supabase_admin, so they cannot be revoked
  -- even deliberately. Reported, never failed.
  union all
  select 13, 'default privileges owned by platform roles (informational)',
         '(informational)',
         coalesce(nullif(string_agg(distinct pg_get_userbyid(d.defaclrole), ' '), ''), 'none')
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral unnest(d.defaclacl) as x(entry)
   where n.nspname = 'public'
     and (x.entry::text like 'anon=%' or x.entry::text like 'authenticated=%')
     and pg_get_userbyid(d.defaclrole) not in ('postgres', current_user)

  -- ---- unaccent landed where we asked -------------------------------------
  union all
  select 11, 'unaccent installed in the extensions schema',
         'extensions',
         coalesce((select n.nspname from pg_extension e
                     join pg_namespace n on n.oid = e.extnamespace
                    where e.extname = 'unaccent'), 'NOT INSTALLED')
)
select n as "#",
       case when n = 13           then 'INFO'
            when actual = expected then 'PASS'
            else '*** FAIL ***' end as result,
       check_name as check,
       expected,
       actual
  from checks
 order by n;
