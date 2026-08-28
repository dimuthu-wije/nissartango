-- ============================================================================
-- schema_tests.sql -- stage 1 behaviour tests (schema, constraints, triggers)
-- plus the grant surface: exactly what anon and authenticated may touch.
--
-- Refusals are asserted by SQLSTATE (NT001-NT005, see 20260828181000), never
-- by message text: prose gets reworded, and a permission error must never be
-- able to stand in for one of our rules.
--
-- Run against the LOCAL stack only; it writes rows and pokes auth.users.
--   ./scripts/test-schema.sh
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off

-- helper: run a statement that must fail, and report the message
create or replace function must_fail(label text, stmt text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % -- statement unexpectedly succeeded', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok   %  -> rejected: %', rpad(label, 42), sqlerrm;
end $$;

create or replace function must_fail_code(label text, stmt text, want text) returns void
language plpgsql as $$
declare got text;
begin
  execute stmt;
  raise exception 'FAIL: % -- statement unexpectedly succeeded', label;
exception when others then
  got := sqlstate;
  if sqlerrm like 'FAIL:%' then raise; end if;
  if got <> want then
    raise exception 'FAIL: % -- refused with % (%), expected %', label, got, left(sqlerrm,60), want;
  end if;
  raise notice 'ok   %  -> % : %', rpad(label, 40), got, left(sqlerrm, 46);
end $$;

create or replace function check_eq(label text, got text, want text) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL: % -- got %, want %', label, quote_nullable(got), quote_nullable(want);
  end if;
  raise notice 'ok   %  -> %', rpad(label, 42), coalesce(got, 'NULL');
end $$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'dim@example.org');

insert into public.organizers (id, name, slug, instagram, email, phone) values
  ('22222222-2222-2222-2222-222222222222', 'Nissartango', 'nissartango', 'nissartango',
   'contact@example.org', '+33 6 12 34 56 78');

-- === constraints ===========================================================
select must_fail('instagram must be a handle, not a URL',
  $$insert into public.organizers (name, slug, instagram)
    values ('X','x-org','https://instagram.com/x')$$);

select must_fail('organizer slug must be kebab-case',
  $$insert into public.organizers (name, slug) values ('X','X Org')$$);

-- === slug generation =======================================================
insert into public.events (title, type, starts_at, organizer_id, created_by)
values ('Milonga précédée d''une pràctica', 'milonga',
        timestamptz '2026-08-24 21:00+02', '22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111');
select check_eq('accents folded, date prefixed',
  (select slug from public.events where title like 'Milonga%'),
  '2026-08-24-milonga-precedee-d-une-practica');

-- 00:30 Paris on 1 September is 31 August 22:30 UTC. The slug must say the 1st.
insert into public.events (title, type, starts_at, organizer_id)
values ('Milonga de minuit', 'milonga', timestamptz '2026-09-01 00:30+02',
        '22222222-2222-2222-2222-222222222222');
select check_eq('date prefix uses Paris, not UTC',
  (select slug from public.events where title = 'Milonga de minuit'),
  '2026-09-01-milonga-de-minuit');

-- collision suffix
insert into public.events (title, type, starts_at, organizer_id)
values ('Practica du mardi', 'practica', timestamptz '2026-09-01 20:00+02',
        '22222222-2222-2222-2222-222222222222');
insert into public.events (title, type, starts_at, organizer_id)
values ('Practica du mardi', 'practica', timestamptz '2026-09-01 20:00+02',
        '22222222-2222-2222-2222-222222222222');
select check_eq('second identical title gets -2',
  (select string_agg(slug, ' | ' order by slug) from public.events where title = 'Practica du mardi'),
  '2026-09-01-practica-du-mardi | 2026-09-01-practica-du-mardi-2');

-- importer path: an explicit slug is kept verbatim, accents and all
insert into public.events (slug, title, type, starts_at, organizer_id)
values ('2026-08-24-milonga-précédée-d-une-pràctica-jeudi-c-est-permis-à-la-casita',
        'Legacy', 'milonga', timestamptz '2026-08-24 21:00+02',
        '22222222-2222-2222-2222-222222222222');
select check_eq('explicit slug preserved for the importer',
  (select slug from public.events where title = 'Legacy'),
  '2026-08-24-milonga-précédée-d-une-pràctica-jeudi-c-est-permis-à-la-casita');

-- === slug immutability =====================================================
select must_fail_code('slug cannot be changed',
  $$update public.events set slug = 'nouveau' where title = 'Milonga de minuit'$$, 'NT002');

select must_fail('slug still frozen when starts_at moves',
  $$update public.events set slug = '2026-09-08-milonga-de-minuit',
                             starts_at = timestamptz '2026-09-08 00:30+02'
     where title = 'Milonga de minuit'$$);

-- moving the date alone is fine; the slug simply stays put
update public.events set starts_at = timestamptz '2026-09-08 00:30+02'
 where title = 'Milonga de minuit';
select check_eq('slug survives a reschedule',
  (select slug from public.events where title = 'Milonga de minuit'),
  '2026-09-01-milonga-de-minuit');

-- the deliberate escape hatch
begin;
  set local app.allow_slug_change = 'on';
  update public.events set slug = '2026-09-08-milonga-de-minuit'
   where title = 'Milonga de minuit';
commit;
select check_eq('escape hatch works inside a transaction',
  (select slug from public.events where title = 'Milonga de minuit'),
  '2026-09-08-milonga-de-minuit');

-- and closes again automatically
select must_fail_code('escape hatch does not leak past commit',
  $$update public.events set slug = 'encore' where title = 'Milonga de minuit'$$, 'NT002');

-- === recurrence + timezone validation ======================================
select must_fail('recurrence_end without a series',
  $$insert into public.events (title, type, starts_at, organizer_id, recurrence_end)
    values ('X','cours', now(), '22222222-2222-2222-2222-222222222222', current_date)$$);

select must_fail_code('recurrence_end before the first occurrence',
  $$insert into public.events (title, type, starts_at, organizer_id, recurrence, recurrence_end)
    values ('X','cours', timestamptz '2026-09-01 20:00+02',
            '22222222-2222-2222-2222-222222222222', 'weekly', date '2026-08-01')$$, 'NT004');

select must_fail_code('unknown timezone',
  $$insert into public.events (title, type, starts_at, organizer_id, timezone)
    values ('X','cours', now(), '22222222-2222-2222-2222-222222222222', 'Europe/Nice')$$, 'NT003');

select must_fail('negative price',
  $$insert into public.events (title, type, starts_at, organizer_id, price_full)
    values ('X','cours', now(), '22222222-2222-2222-2222-222222222222', -5)$$);

select must_fail('postal code must be 5 digits',
  $$insert into public.events (title, type, starts_at, organizer_id, location_postal_code)
    values ('X','cours', now(), '22222222-2222-2222-2222-222222222222', '06 000')$$);

-- === status / needs_review =================================================
select check_eq('status defaults to pending',
  (select status::text from public.events where title = 'Milonga de minuit'), 'pending');

update public.events set status = 'approved' where title = 'Milonga de minuit';
select check_eq('approving does not set needs_review',
  (select needs_review::text from public.events where title = 'Milonga de minuit'), 'false');

update public.events set body = 'Ouvert à tous.' where title = 'Milonga de minuit';
select check_eq('editing an approved event flags it',
  (select needs_review::text from public.events where title = 'Milonga de minuit'), 'true');
select check_eq('...and it stays live',
  (select status::text from public.events where title = 'Milonga de minuit'), 'approved');

update public.events set review_note = 'vu' where title = 'Milonga de minuit';
select check_eq('touching review_note does not re-flag',
  (select needs_review::text from public.events where title = 'Milonga de minuit'), 'true');

update public.events set status = 'approved', needs_review = false where title = 'Milonga de minuit';
select check_eq('clearing the flag by hand works',
  (select needs_review::text from public.events where title = 'Milonga de minuit'), 'false');

update public.events set body = 'Encore.' where title = 'Milonga de minuit';
update public.events set status = 'rejected' where title = 'Milonga de minuit';
select check_eq('a moderation decision clears the flag',
  (select needs_review::text from public.events where title = 'Milonga de minuit'), 'false');

-- a pending event being edited is not flagged: it was never live
update public.events set body = 'x' where title = 'Practica du mardi' and slug like '%mardi';
select check_eq('editing a pending event does not flag it',
  (select needs_review::text from public.events where slug = '2026-09-01-practica-du-mardi'), 'false');

-- === rejected events resubmit on edit ======================================
-- 'Milonga de minuit' was left rejected by the block above.
select check_eq('precondition: event is rejected',
  (select status::text from public.events where title = 'Milonga de minuit'), 'rejected');

update public.events set review_note = 'toujours non' where title = 'Milonga de minuit';
select check_eq('an admin note does not resubmit it',
  (select status::text from public.events where title = 'Milonga de minuit'), 'rejected');

update public.events set body = 'Corrigé.' where title = 'Milonga de minuit';
select check_eq('editing a rejected event returns it to pending',
  (select status::text from public.events where title = 'Milonga de minuit'), 'pending');
select check_eq('...without flagging it as a live change',
  (select needs_review::text from public.events where title = 'Milonga de minuit'), 'false');
select check_eq('...and the rejection note is kept as context',
  (select review_note from public.events where title = 'Milonga de minuit'), 'toujours non');

-- === cancellation is lifecycle, not moderation =============================
select must_fail('a reason with nothing cancelled',
  $$update public.events set cancellation_note = 'pourquoi ?'
     where slug = '2026-09-01-practica-du-mardi'$$);

update public.events set status = 'approved' where slug = '2026-09-01-practica-du-mardi';
update public.events set cancelled_at = now(), cancellation_note = 'Salle indisponible'
 where slug = '2026-09-01-practica-du-mardi';
select check_eq('a cancelled event is still approved',
  (select status::text from public.events where slug = '2026-09-01-practica-du-mardi'), 'approved');
select check_eq('...so it stays inside the published predicate',
  (select count(*)::text from public.events
    where status = 'approved' and slug = '2026-09-01-practica-du-mardi'), '1');
select check_eq('cancelling a live event reaches the review queue',
  (select needs_review::text from public.events where slug = '2026-09-01-practica-du-mardi'), 'true');

update public.events set cancelled_at = null, cancellation_note = null
 where slug = '2026-09-01-practica-du-mardi';
select check_eq('un-cancelling is nulling the column',
  (select coalesce(cancelled_at::text, 'null') from public.events
    where slug = '2026-09-01-practica-du-mardi'), 'null');

-- The case the old enum got wrong: cancelling something never approved.
update public.events set cancelled_at = now()
 where slug = '2026-09-01-practica-du-mardi-2';
select check_eq('cancelling a pending event does not publish it',
  (select status::text from public.events where slug = '2026-09-01-practica-du-mardi-2'), 'pending');
select check_eq('...and it is outside the published predicate',
  (select count(*)::text from public.events
    where status = 'approved' and slug = '2026-09-01-practica-du-mardi-2'), '0');

-- === event_exceptions ======================================================
insert into public.events (id, title, type, starts_at, organizer_id, recurrence, status)
values ('33333333-3333-3333-3333-333333333333', 'Practica hebdo', 'practica',
        timestamptz '2026-08-04 21:00+02', '22222222-2222-2222-2222-222222222222',
        'weekly', 'approved');

select must_fail('moved exception needs a new time',
  $$insert into public.event_exceptions (event_id, occurrence_date, kind)
    values ('33333333-3333-3333-3333-333333333333', date '2026-08-11', 'moved')$$);

select must_fail('cancelled exception must not carry one',
  $$insert into public.event_exceptions (event_id, occurrence_date, kind, moved_starts_at)
    values ('33333333-3333-3333-3333-333333333333', date '2026-08-11', 'cancelled',
            timestamptz '2026-08-12 21:00+02')$$);

insert into public.event_exceptions (event_id, occurrence_date, note)
values ('33333333-3333-3333-3333-333333333333', date '2026-08-15', 'Pas de practica (Assomption)');
select check_eq('an exception carries a public reason',
  (select note from public.event_exceptions
    where event_id = '33333333-3333-3333-3333-333333333333'),
  'Pas de practica (Assomption)');
select check_eq('adding an exception flags the live parent',
  (select needs_review::text from public.events
    where id = '33333333-3333-3333-3333-333333333333'), 'true');

update public.events set needs_review = false, status = 'approved'
 where id = '33333333-3333-3333-3333-333333333333';
delete from public.event_exceptions
 where event_id = '33333333-3333-3333-3333-333333333333';
select check_eq('removing one flags it too',
  (select needs_review::text from public.events
    where id = '33333333-3333-3333-3333-333333333333'), 'true');

insert into public.event_exceptions (event_id, occurrence_date, kind, moved_starts_at, note)
values ('33333333-3333-3333-3333-333333333333', date '2026-08-18', 'moved',
        timestamptz '2026-08-19 21:00+02', 'Décalée au mercredi');
select check_eq('a moved occurrence keeps its new instant',
  (select to_char(moved_starts_at at time zone 'Europe/Paris', 'YYYY-MM-DD HH24:MI')
     from public.event_exceptions where kind = 'moved'), '2026-08-19 21:00');

select must_fail('one exception per occurrence date',
  $$insert into public.event_exceptions (event_id, occurrence_date)
    values ('33333333-3333-3333-3333-333333333333', date '2026-08-18')$$);

delete from public.events where id = '33333333-3333-3333-3333-333333333333';
select check_eq('exceptions cascade with the event',
  (select count(*)::text from public.event_exceptions), '0');

-- === occurrence_date, past midnight and across DST =========================
-- A 00:30 Wednesday milonga. In Paris it is the 5th; in UTC it is the 4th at
-- 22:30. Every one of these assertions fails if anything keys occurrences off
-- the UTC date -- which is exactly how a cancelled occurrence would stay on
-- the agenda, half the year, silently.
select check_eq('summer: local date is the day after the UTC date',
  public.occurrence_local_date(timestamptz '2026-08-05 00:30+02', 'Europe/Paris')::text
    || ' vs ' || (timestamptz '2026-08-05 00:30+02' at time zone 'UTC')::date::text,
  '2026-08-05 vs 2026-08-04');

-- Same series in November: Paris is now UTC+1, so the instant is 23:30 UTC.
select check_eq('winter: still the local date, offset has changed',
  public.occurrence_local_date(timestamptz '2026-11-04 00:30+01', 'Europe/Paris')::text
    || ' vs ' || (timestamptz '2026-11-04 00:30+01' at time zone 'UTC')::date::text,
  '2026-11-04 vs 2026-11-03');

-- And the two boundary weekends themselves: 25 October 2026 (03:00 -> 02:00)
-- and 29 March 2026 (02:00 -> 03:00). A 21:00 practica keeps its wall clock.
select check_eq('a 21:00 practica is 21:00 either side of the October change',
  (select string_agg(to_char(d at time zone 'Europe/Paris', 'YYYY-MM-DD HH24:MI'), ' | ' order by d)
     from (values (timestamptz '2026-10-20 21:00+02'),
                  (timestamptz '2026-10-27 21:00+01')) v(d)),
  '2026-10-20 21:00 | 2026-10-27 21:00');

-- The exception key round-trips: write the row using the same function stage 3
-- must use, and it matches.
insert into public.events (id, title, type, starts_at, timezone, organizer_id, recurrence, status)
values ('44444444-4444-4444-4444-444444444444', 'Milonga de minuit hebdo', 'milonga',
        timestamptz '2026-08-05 00:30+02', 'Europe/Paris',
        '22222222-2222-2222-2222-222222222222', 'weekly', 'approved');
insert into public.event_exceptions (event_id, occurrence_date, note)
select '44444444-4444-4444-4444-444444444444',
       public.occurrence_local_date(timestamptz '2026-08-12 00:30+02', 'Europe/Paris'),
       'Pas de milonga cette nuit';
select check_eq('the exception is keyed on the Paris date',
  (select occurrence_date::text from public.event_exceptions
    where event_id = '44444444-4444-4444-4444-444444444444'), '2026-08-12');
select check_eq('the slug agrees with the exception key',
  (select left(slug, 10) from public.events
    where id = '44444444-4444-4444-4444-444444444444'), '2026-08-05');

-- === updated_at ============================================================
select check_eq('updated_at moved on update',
  (select (updated_at > created_at)::text from public.events where title = 'Milonga de minuit'), 'true');

-- === privileges ============================================================
select check_eq('anon has no privileges on events',
  (select coalesce(string_agg(privilege_type, ','), 'none')
     from information_schema.role_table_grants
    where grantee = 'anon' and table_name = 'events'), 'none');
select check_eq('anon has no privileges on organizers',
  (select coalesce(string_agg(privilege_type, ','), 'none')
     from information_schema.role_table_grants
    where grantee = 'anon' and table_name = 'organizers'), 'none');
select check_eq('anon has no privileges on event_exceptions',
  (select coalesce(string_agg(privilege_type, ','), 'none')
     from information_schema.role_table_grants
    where grantee = 'anon' and table_name = 'event_exceptions'), 'none');
select check_eq('RLS enabled on all five tables',
  (select string_agg(relname || '=' || relrowsecurity::text, ' ' order by relname)
     from pg_class where relnamespace = 'public'::regnamespace
      and relname in ('events','event_exceptions','organizers','organizer_members','user_roles')),
  'event_exceptions=true events=true organizer_members=true organizers=true user_roles=true');
-- Nothing granted by DEFAULT either: the code half of the hosted project's
-- "Automatically expose new tables = off", so a table added tomorrow starts
-- closed here exactly as it does there.
--
-- Scoped to postgres, the role that creates everything in these migrations.
-- A hosted project also carries supabase_admin-owned defaults that grant
-- anon everything -- they fire only for objects supabase_admin creates, and
-- postgres cannot revoke them. See check 13 in grants_check.sql.
select check_eq('no default privileges for anon or authenticated',
  (select coalesce(string_agg(distinct pg_get_userbyid(d.defaclrole) || ':' || x.entry::text, ' '), 'none')
     from pg_default_acl d
     join pg_namespace n on n.oid = d.defaclnamespace
     cross join lateral unnest(d.defaclacl) as x(entry)
    where n.nspname = 'public'
      and (x.entry::text like 'anon=%' or x.entry::text like 'authenticated=%')
      and pg_get_userbyid(d.defaclrole) in ('postgres', current_user)), 'none');

-- The entire anon surface in the public schema, in one assertion: SELECT on
-- three views, nothing else. If a future migration grants anon anything, or
-- adds a table without revoking, this fails. (Storage is a separate schema
-- with its own grants; the policies there are proved in rls_tests.sql.)
-- The same question for FUNCTIONS. anon must not be able to call anything in
-- public -- not even a helper that would only answer false.
select check_eq('anon cannot execute any function in public',
  (select coalesce(string_agg(distinct routine_name, ' ' order by routine_name), 'none')
     from information_schema.role_routine_grants
    where grantee = 'anon' and specific_schema = 'public'), 'none');

-- And the exact list authenticated CAN call. A new function that forgets its
-- revoke shows up here as a test failure rather than as an open RPC.
select check_eq('authenticated can call exactly the intended functions',
  (select coalesce(string_agg(distinct routine_name, ' ' order by routine_name), 'none')
     from information_schema.role_routine_grants
    where grantee = 'authenticated' and specific_schema = 'public'
      and routine_name not in ('must_fail','check_eq','touched')),
  'approve_event is_admin is_event_member is_member is_owner mark_reviewed reject_event slugify uuid_or_null');

select check_eq('anon holds SELECT on the three public views and nothing else',
  (select coalesce(string_agg(distinct table_name || ':' || privilege_type, ' '
                              order by table_name || ':' || privilege_type), 'none')
     from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'),
  'event_exceptions_public:SELECT events_public:SELECT organizers_public:SELECT');

\echo ''
\echo 'ALL SCHEMA TESTS PASSED'

drop function must_fail(text, text);
drop function check_eq(text, text, text);
