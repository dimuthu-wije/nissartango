-- ============================================================================
-- rls_tests.sql -- stage 2 proofs, in-database.
--
-- Every assertion runs as a real role with a real auth.uid(), the way
-- PostgREST arrives: `set role authenticated` plus a JWT subject.
-- scripts/prove-rls.sh proves the same things over HTTP;
-- supabase/tests/grants_check.sql is the read-only half you can run against
-- a hosted project.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off

-- ============================================================================
-- Stage 2 proofs, in-database. Every assertion runs as a real role with a real
-- auth.uid(), the same way PostgREST arrives: `set role authenticated` plus a
-- JWT subject. scripts/prove-rls.sh then proves the same things over HTTP.
-- ============================================================================

create or replace function must_fail(label text, stmt text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % -- statement unexpectedly succeeded', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok   %  -> refused: %', rpad(label, 46), left(sqlerrm, 60);
end $$;

create or replace function check_eq(label text, got text, want text) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL: % -- got %, want %', label, quote_nullable(got), quote_nullable(want);
  end if;
  raise notice 'ok   %  -> %', rpad(label, 46), coalesce(got, 'NULL');
end $$;

-- must_fail only proves something was refused. Where a permission error could
-- masquerade as the rule under test, assert the SQLSTATE -- not the message,
-- which is English prose today and may be French tomorrow.
create or replace function must_fail_code(label text, stmt text, want text) returns void
language plpgsql as $$
declare
  got text;
begin
  execute stmt;
  raise exception 'FAIL: % -- statement unexpectedly succeeded', label;
exception when others then
  got := sqlstate;
  if sqlerrm like 'FAIL:%' then raise; end if;
  if got <> want then
    raise exception 'FAIL: % -- refused with % (%), expected %',
      label, got, left(sqlerrm, 60), want;
  end if;
  raise notice 'ok   %  -> % : %', rpad(label, 40), got, left(sqlerrm, 46);
end $$;

-- how many rows a write actually touched, under the caller's policies
create or replace function touched(stmt text) returns text
language plpgsql as $$
declare n integer;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n::text;
end $$;

-- === fixtures (as postgres) ================================================
insert into auth.users (id, email) values
  ('a11ce000-0000-0000-0000-000000000001', 'alice@example.org'),   -- owner, org A
  ('b0b00000-0000-0000-0000-000000000002', 'bob@example.org'),     -- editor, org A
  ('ca401000-0000-0000-0000-000000000003', 'carol@example.org'),   -- owner, org B
  ('da5e0000-0000-0000-0000-000000000004', 'dave@example.org');    -- admin

insert into public.organizers (id, name, slug, email, phone) values
  ('0a000000-0000-0000-0000-0000000000aa', 'Nissartango', 'nissartango',
   'contact@nissartango.fr', '+33 6 12 34 56 78'),
  ('0b000000-0000-0000-0000-0000000000bb', 'Rosa Gervasi', 'rosa-gervasi',
   'rosa@example.org', '+33 6 98 76 54 32');

insert into public.organizer_members (organizer_id, user_id, role) values
  ('0a000000-0000-0000-0000-0000000000aa', 'a11ce000-0000-0000-0000-000000000001', 'owner'),
  ('0a000000-0000-0000-0000-0000000000aa', 'b0b00000-0000-0000-0000-000000000002', 'editor'),
  ('0b000000-0000-0000-0000-0000000000bb', 'ca401000-0000-0000-0000-000000000003', 'owner');

insert into public.user_roles (user_id, role) values
  ('da5e0000-0000-0000-0000-000000000004', 'admin');

insert into public.events (id, title, type, starts_at, organizer_id, status, created_by) values
  ('e0000000-0000-0000-0000-00000000000a', 'Milonga de la Casita', 'milonga',
   timestamptz '2026-09-10 21:00+02', '0a000000-0000-0000-0000-0000000000aa', 'approved',
   'a11ce000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-00000000000b', 'Practica secrète', 'practica',
   timestamptz '2026-09-11 20:00+02', '0a000000-0000-0000-0000-0000000000aa', 'pending',
   'b0b00000-0000-0000-0000-000000000002'),
  ('e0000000-0000-0000-0000-00000000000c', 'Stage Rosa', 'stage',
   timestamptz '2026-09-12 14:00+02', '0b000000-0000-0000-0000-0000000000bb', 'approved',
   'ca401000-0000-0000-0000-000000000003'),
  ('e0000000-0000-0000-0000-00000000000d', 'Stage Rosa (brouillon)', 'stage',
   timestamptz '2026-09-19 14:00+02', '0b000000-0000-0000-0000-0000000000bb', 'pending',
   'ca401000-0000-0000-0000-000000000003');

insert into public.event_exceptions (event_id, occurrence_date, note) values
  ('e0000000-0000-0000-0000-00000000000a', date '2026-08-15', 'Pas de milonga (Assomption)');

insert into storage.objects (bucket_id, name, owner) values
  ('event-images', '0a000000-0000-0000-0000-0000000000aa/e0000000-0000-0000-0000-00000000000a/affiche.jpg',
   'a11ce000-0000-0000-0000-000000000001');

\echo ''
\echo '--- as anon (the public site, and anyone with the anon key) ---'
set role anon;

select must_fail('anon cannot read the events table',
  $$select * from public.events$$);
select must_fail('anon cannot read the organizers table',
  $$select * from public.organizers$$);
select must_fail('anon cannot read organizer_members',
  $$select * from public.organizer_members$$);
select must_fail('anon cannot read user_roles',
  $$select * from public.user_roles$$);
select must_fail('anon cannot call is_admin()',
  $$select public.is_admin()$$);

select check_eq('anon sees approved events in the view',
  (select string_agg(title, ', ' order by title) from public.events_public),
  'Milonga de la Casita, Stage Rosa');
select check_eq('...and pending events are simply absent',
  (select count(*)::text from public.events_public where title like '%secrète%'), '0');

select must_fail('the phone column does not exist for anon',
  $$select phone from public.organizers_public$$);
select must_fail('nor does email',
  $$select email from public.organizers_public$$);
select check_eq('anon sees public organizer columns',
  (select string_agg(name || '/' || slug, ', ' order by name) from public.organizers_public),
  'Nissartango/nissartango, Rosa Gervasi/rosa-gervasi');

select check_eq('anon sees exceptions of published events only',
  (select count(*)::text from public.event_exceptions_public), '1');

-- the auto-updatable-view trap
select must_fail('anon cannot write through events_public',
  $$insert into public.events_public (slug, title, type, starts_at, organizer_id)
    values ('x','X','cours', now(), '0a000000-0000-0000-0000-0000000000aa')$$);
select must_fail('anon cannot write through organizers_public',
  $$update public.organizers_public set name = 'pwned'$$);

select check_eq('anon may read image objects (build-time download)',
  (select count(*)::text from storage.objects where bucket_id = 'event-images'), '1');
select must_fail('anon cannot upload',
  $$insert into storage.objects (bucket_id, name) values ('event-images','x/y/z.jpg')$$);

reset role;

\echo ''
\echo '--- as bob, editor of Nissartango ---'
set role authenticated;
set request.jwt.claim.sub = 'b0b00000-0000-0000-0000-000000000002';

select check_eq('an editor sees only their organizer''s events',
  (select string_agg(title, ', ' order by title) from public.events),
  'Milonga de la Casita, Practica secrète');
select check_eq('including their own pending one',
  (select status::text from public.events where title = 'Practica secrète'), 'pending');
select check_eq('another organizer''s pending event is invisible',
  (select count(*)::text from public.events where title like 'Stage Rosa%'), '0');

select check_eq('editing own event works',
  touched($$update public.events set body = 'Ambiance milonguera.'
             where id = 'e0000000-0000-0000-0000-00000000000a'$$), '1');
select must_fail('an editor cannot touch status at all',
  $$update public.events set status = 'approved'
     where id = 'e0000000-0000-0000-0000-00000000000b'$$);
select must_fail('nor needs_review',
  $$update public.events set needs_review = false
     where id = 'e0000000-0000-0000-0000-00000000000a'$$);
select must_fail('nor review_note',
  $$update public.events set review_note = 'approuvé stp'
     where id = 'e0000000-0000-0000-0000-00000000000b'$$);
select must_fail('nor the slug',
  $$update public.events set slug = 'joli-slug'
     where id = 'e0000000-0000-0000-0000-00000000000b'$$);

select check_eq('an editor may cancel their own live event',
  touched($$update public.events
               set cancelled_at = now(), cancellation_note = 'Salle fermée'
             where id = 'e0000000-0000-0000-0000-00000000000a'$$), '1');

select check_eq('another organizer''s event cannot be edited',
  touched($$update public.events set title = 'volé'
             where id = 'e0000000-0000-0000-0000-00000000000c'$$), '0');

select must_fail('an editor cannot self-publish on insert',
  $$insert into public.events (title, type, starts_at, organizer_id, status)
    values ('Auto-publiée','cours', timestamptz '2026-10-01 20:00+02',
            '0a000000-0000-0000-0000-0000000000aa', 'approved')$$);
select must_fail('nor insert for an organizer they do not belong to',
  $$insert into public.events (title, type, starts_at, organizer_id)
    values ('Chez Rosa','cours', timestamptz '2026-10-01 20:00+02',
            '0b000000-0000-0000-0000-0000000000bb')$$);

insert into public.events (title, type, starts_at, organizer_id)
values ('Nouveau cours', 'cours', timestamptz '2026-10-01 19:00+02',
        '0a000000-0000-0000-0000-0000000000aa');
select check_eq('a legitimate insert lands as pending, owned by them',
  (select status::text || '/' || (created_by = 'b0b00000-0000-0000-0000-000000000002')::text
     from public.events where title = 'Nouveau cours'), 'pending/true');

select check_eq('an editor cannot delete a published event',
  touched($$delete from public.events where id = 'e0000000-0000-0000-0000-00000000000a'$$), '0');
select check_eq('but may delete their own draft',
  touched($$delete from public.events where title = 'Nouveau cours'$$), '1');

select must_fail('an editor cannot approve anything',
  $$select public.approve_event('e0000000-0000-0000-0000-00000000000b')$$);

select check_eq('reading organizer_members does not recurse',
  (select count(*)::text from public.organizer_members), '2');
select check_eq('an editor is not an owner: no member writes',
  touched($$delete from public.organizer_members
             where user_id = 'a11ce000-0000-0000-0000-000000000001'$$), '0');
select check_eq('an editor cannot see the other organizer at all',
  (select count(*)::text from public.organizers), '1');

select check_eq('the ownerless view obeys the caller, not the view owner',
  (select coalesce(string_agg(name, ', '), 'none') from public.organizers_without_owner),
  'none');

insert into storage.objects (bucket_id, name)
values ('event-images', '0a000000-0000-0000-0000-0000000000aa/e0000000-0000-0000-0000-00000000000b/flyer.jpg');
select must_fail('an editor cannot write into another organizer''s folder',
  $$insert into storage.objects (bucket_id, name)
    values ('event-images','0b000000-0000-0000-0000-0000000000bb/x/flyer.jpg')$$);
select must_fail('nor into a malformed path',
  $$insert into storage.objects (bucket_id, name)
    values ('event-images','pas-un-uuid/x/flyer.jpg')$$);

reset role;
reset request.jwt.claim.sub;

\echo ''
\echo '--- as carol, another organizer ---'
set role authenticated;
set request.jwt.claim.sub = 'ca401000-0000-0000-0000-000000000003';
select check_eq('carol sees only her own events',
  (select string_agg(title, ', ' order by title) from public.events),
  'Stage Rosa, Stage Rosa (brouillon)');
select check_eq('and only her own organizer row',
  (select string_agg(name, ',') from public.organizers), 'Rosa Gervasi');
select check_eq('nissartango''s phone is unreachable',
  (select count(*)::text from public.organizers
    where phone = '+33 6 12 34 56 78'), '0');
select must_fail_code('she cannot remove herself as the last owner',
  $$delete from public.organizer_members
     where organizer_id = '0b000000-0000-0000-0000-0000000000bb'$$,
  'NT001');
reset role;
reset request.jwt.claim.sub;

-- === deleting an account must not be blocked by its own membership =========
reset role;
reset request.jwt.claim.sub;

select check_eq('precondition: carol solely owns Rosa Gervasi',
  (select count(*)::text from public.organizer_members
    where organizer_id = '0b000000-0000-0000-0000-0000000000bb' and role = 'owner'), '1');

delete from auth.users where email = 'carol@example.org';
select check_eq('deleting the account succeeds',
  (select count(*)::text from auth.users where email = 'carol@example.org'), '0');
select check_eq('...and takes the membership with it',
  (select count(*)::text from public.organizer_members
    where organizer_id = '0b000000-0000-0000-0000-0000000000bb'), '0');
select check_eq('...leaving an ownerless organizer for an admin to reassign',
  (select name from public.organizers where id = '0b000000-0000-0000-0000-0000000000bb'),
  'Rosa Gervasi');
select check_eq('...and her events, which outlive her account',
  (select count(*)::text from public.events
    where organizer_id = '0b000000-0000-0000-0000-0000000000bb'), '2');
-- created_by is ON DELETE SET NULL, and nothing keys off it: ownership is by
-- organizer. Anything that assumed created_by was non-null would break here.
select check_eq('...with created_by nulled, not the row deleted',
  (select count(*)::text from public.events
    where organizer_id = '0b000000-0000-0000-0000-0000000000bb'
      and created_by is null), '2');
select check_eq('...and the approved one is still published',
  (select count(*)::text from public.events_public
    where organizer_id = '0b000000-0000-0000-0000-0000000000bb'), '1');

-- The state is recoverable only if somebody sees it.
select check_eq('the ownerless organizer surfaces for the admin queue',
  (select string_agg(name, ', ') from public.organizers_without_owner),
  'Rosa Gervasi');

-- reinstate her so the admin assertions below still have something to look at
insert into auth.users (id, email)
values ('ca401000-0000-0000-0000-000000000003', 'carol@example.org');
insert into public.organizer_members (organizer_id, user_id, role)
values ('0b000000-0000-0000-0000-0000000000bb', 'ca401000-0000-0000-0000-000000000003', 'owner');

\echo ''
\echo '--- as dave, admin ---'
set role authenticated;
set request.jwt.claim.sub = 'da5e0000-0000-0000-0000-000000000004';

select check_eq('an admin sees every event',
  (select count(*)::text from public.events), '4');
select must_fail('but still cannot set status by hand',
  $$update public.events set status = 'approved'
     where id = 'e0000000-0000-0000-0000-00000000000b'$$);

select check_eq('approve_event does it',
  (select status::text from public.approve_event('e0000000-0000-0000-0000-00000000000b')),
  'approved');
select must_fail('a rejection needs a reason',
  $$select public.reject_event('e0000000-0000-0000-0000-00000000000d', '')$$);
select check_eq('reject_event records one',
  (select status::text || '/' || review_note
     from public.reject_event('e0000000-0000-0000-0000-00000000000d', 'Doublon')),
  'rejected/Doublon');
select check_eq('mark_reviewed clears the queue flag',
  (select needs_review::text
     from public.mark_reviewed('e0000000-0000-0000-0000-00000000000a')), 'false');
select check_eq('an admin can read a private phone number',
  (select phone from public.organizers where slug = 'nissartango'), '+33 6 12 34 56 78');

reset role;
reset request.jwt.claim.sub;

\echo ''
\echo '--- the anon key still cannot see any of it ---'
set role anon;
select check_eq('the newly approved event is now public',
  (select count(*)::text from public.events_public where title = 'Practica secrète'), '1');
select check_eq('the rejected one is not',
  (select count(*)::text from public.events_public where title like '%brouillon%'), '0');
select must_fail('and review notes remain unreachable',
  $$select review_note from public.events_public$$);
reset role;

drop function must_fail(text, text);
drop function must_fail_code(text, text, text);
drop function check_eq(text, text, text);
drop function touched(text);

\echo ''
\echo 'ALL RLS TESTS PASSED'
