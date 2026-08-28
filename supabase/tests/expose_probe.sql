-- ============================================================================
-- expose_probe.sql -- "would a table I create right now be public?"
--
-- grants_check.sql answers this from the catalogs, by reasoning about which
-- role owns which default privileges. This answers it by DOING it, which is
-- worth having in a project where the catalogs have surprised us five times.
--
-- SAFE, but not read-only in the strict sense: it creates a table inside a
-- transaction and rolls back, so nothing is committed and nothing is left
-- behind. It runs as whoever you are connected as -- which is the point: run
-- it the way you actually create tables (SQL editor, or the CLI), because the
-- answer depends on the role doing the creating.
--
--   Dashboard -> SQL Editor -> paste this file
--
-- If your client shows no result table, it displayed the ROLLBACK instead of
-- the SELECT; run the statements one at a time.
-- ============================================================================

begin;

create table public._expose_probe (id integer);

select case
         when count(*) = 0 then 'PASS'
         else '*** FAIL ***'
       end                                                  as result,
       'a new table created by ' || current_user            as who,
       coalesce(string_agg(distinct grantee || ':' || privilege_type, ' '
                           order by grantee || ':' || privilege_type),
                'is reachable by nobody until granted')     as what_anon_got
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name = '_expose_probe'
   and grantee in ('anon', 'authenticated');

rollback;
