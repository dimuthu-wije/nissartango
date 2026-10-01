-- ============================================================================
-- 20261001140000_drop_event_type.sql
--
-- The contract half of 20261001120000: `formats` becomes the only column that
-- says what an event is.
--
-- WHY NOW RATHER THAN LATER. While both columns exist the editor writes BOTH --
-- `formats` as the set, `formats[1]` into `type` -- and that is not merely
-- redundant, it is what made 20261001130000 necessary: `soiree` was a legal
-- value of one and not of the other, so the first use of the feature failed
-- with `invalid input value for enum event_type`. A test now watches those
-- lists for divergence. Removing the column removes the possibility instead,
-- which is the better of the two.
--
-- ---------------------------------------------------------------------------
-- THE DANGEROUS PART, AND WHY IT IS WRITTEN OUT IN FULL
-- ---------------------------------------------------------------------------
-- `create or replace view` cannot drop a column, so events_public has to be
-- DROPPED and CREATED. A freshly created view in `public` is subject to
-- Supabase's default privileges, which grant ALL on new objects to anon. Both
-- these views are simple enough to be auto-updatable, and events_public runs
-- with the default `security_invoker = false` BY DESIGN -- it exists so anon
-- can read a column-restricted projection without holding any privilege on the
-- base table. Put those together and a recreate that omits the `revoke all`
-- hands anon INSERT through a view that bypasses RLS.
--
-- So the revoke below is not tidiness. 20260828190000 documents it as the
-- reason those three views are granted the way they are, and this is the first
-- migration since that recreates one.
--
-- content_checksum is dropped first because it DEPENDS on events_public: the
-- drop would otherwise fail (which is the safe failure) or, with CASCADE, take
-- it silently (which is not). It is recreated below from 20260831120000
-- verbatim -- it reads `t::text` over whole rows, so it needs no change for a
-- column leaving, only re-pointing at the new view.
--
-- ORDER OF OPERATIONS, and each step depends on the one before:
--   1. views dropped, so nothing holds a reference to events.type
--   2. formats backfilled from type -- the LAST moment that is possible
--   3. formats made NOT NULL, now that every row has one
--   4. type dropped, then the enum, which is used by nothing else
--   5. views recreated without type, and re-granted
--
-- THE EDITOR BREAKS BETWEEN THIS AND ITS NEXT DEPLOY. The editor live when
-- this is applied sends `type` in every insert and update, and PostgREST
-- answers an unknown column with a 400. The window is however long it takes to
-- run `npm run deploy:editor`, it fails loudly rather than writing anything
-- wrong, and this agenda has one editor. The alternative -- a DEFAULT on a
-- column about to be deleted, so both editors work for ten minutes -- means
-- writing a value nobody chose into the column whose whole problem was being
-- a value nobody chose.
--
-- THE CHECKSUM MOVES ONCE. events_public loses a column, so md5 over its rows
-- changes with no content change: one poller rebuild.
-- ============================================================================

drop view public.content_checksum;
drop view public.events_public;

-- Step 2. Defensive, and the last chance: a row created by the previous editor
-- between 20261001120000 and its deploy has `type` and no `formats`. Production
-- had none when this was written (11 of 11 backfilled) -- this is here so the
-- migration does not depend on that having stayed true.
update public.events
   set formats = array[type::text]
 where formats is null or cardinality(formats) = 0;

-- Step 3. `formats` was nullable for exactly one deploy, for the reason above.
-- That deploy has happened, so the column can carry the NOT NULL that `type`
-- used to.
alter table public.events
  alter column formats set not null;

-- The null branch in both checks is now unreachable, and a constraint that
-- cannot fire reads as though a null were acceptable. Replaced rather than
-- left: the next person to read these should see what they actually enforce.
alter table public.events
  drop constraint events_formats_known,
  drop constraint events_formats_sane_length,
  add constraint events_formats_known
      check (formats <@ array['cours', 'practica', 'milonga', 'stage',
                              'demo', 'festival', 'soiree']::text[]),
  add constraint events_formats_sane_length
      check (cardinality(formats) between 1 and 3);

comment on column public.events.formats is
  'What happens, as a SET: slugs from (cours, practica, milonga, stage, demo, '
  'festival, soiree). A class followed by dancing is two of them. Replaced the '
  'single-valued `type` column, dropped 2026-10-01.';

-- events_flag_review() compares the content columns BY NAME, `new.type` among
-- them, and plpgsql resolves those at runtime -- so dropping the column would
-- leave a trigger that raises `record "new" has no field "type"` on the next
-- edit of any event. Found by running the suite, not by reading: the local
-- stack's seed insert failed on exactly that.
--
-- AND `payment_methods` IS ADDED TO THE LIST, which is a fix rather than
-- housekeeping. It was added on 2026-09-30 and never joined this comparison, so
-- changing how an event may be paid for did NOT flag it for review -- a content
-- change a reader sees, landing silently on a live listing. `formats` would have
-- inherited the same omission by being the column that replaced `type`.
--
-- The list still deliberately excludes status, review_note, needs_review and
-- updated_at: approving an event must not re-flag it. legacy_slugs is excluded
-- too -- it is derived by a trigger, so including it would flag an event for a
-- change it made to itself.
create or replace function public.events_flag_review()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  content_changed boolean;
begin
  content_changed :=
    (new.title, new.formats, new.starts_at, new.duration_minutes, new.timezone,
     new.recurrence, new.recurrence_end,
     new.location_name, new.location_address, new.location_postal_code, new.city,
     new.organizer_id, new.teachers,
     new.price_full, new.price_member, new.price_note, new.payment_methods,
     new.signup_url, new.image_path, new.body,
     new.cancelled_at, new.cancellation_note)
    is distinct from
    (old.title, old.formats, old.starts_at, old.duration_minutes, old.timezone,
     old.recurrence, old.recurrence_end,
     old.location_name, old.location_address, old.location_postal_code, old.city,
     old.organizer_id, old.teachers,
     old.price_full, old.price_member, old.price_note, old.payment_methods,
     old.signup_url, old.image_path, old.body,
     old.cancelled_at, old.cancellation_note);

  -- Editing a rejected event RESUBMITS it. Without this, an editor reworks a
  -- rejected event and it sits in limbo forever: not live, not in your queue.
  -- review_note is deliberately kept -- "rejected because X, then changed" is
  -- exactly the context you want when it comes back around.
  if old.status = 'rejected' and new.status = 'rejected' and content_changed then
    new.status := 'pending';
    new.needs_review := false;
    return new;
  end if;

  if new.status is distinct from old.status then
    new.needs_review := false;                  -- somebody just ruled on it
  elsif old.status = 'approved' and content_changed then
    -- Live, and changed under you. Cancelling counts: cancelled_at is in the
    -- content tuple above, so a cancellation reaches your queue like any other
    -- edit to a published event -- it is the one you most want to see.
    new.needs_review := true;
  end if;

  return new;
end;
$$;

-- Step 4. The column, then the type it used. `drop type` with no CASCADE is
-- deliberate: if anything else still depends on event_type -- a function
-- signature, another column -- this migration FAILS here rather than removing
-- it. Nothing did when this was written; the failure is the check.
alter table public.events
  drop column type;

drop type public.event_type;

-- ---------------------------------------------------------------------------
-- Step 5. The views, recreated. events_public is 20261001120000's list with
-- `type` removed; content_checksum is 20260831120000's body unchanged.
-- ---------------------------------------------------------------------------
create view public.events_public as
  select id, slug, title,
         starts_at, duration_minutes, timezone,
         recurrence, recurrence_end,
         location_name, location_address, location_postal_code, city,
         organizer_id, teachers,
         price_full, price_member, price_note,
         signup_url, image_path, body,
         cancelled_at, cancellation_note,
         created_at, updated_at,
         legacy_slugs,
         payment_methods,
         formats
    from public.events
   where status = 'approved';

create view public.content_checksum as
  select
    md5(
      coalesce((select string_agg(t::text, E'\n' order by t.id)
                  from public.events_public t), '')
      || E'\x1e' ||
      coalesce((select string_agg(t::text, E'\n' order by t.id)
                  from public.organizers_public t), '')
      || E'\x1e' ||
      coalesce((select string_agg(t::text, E'\n' order by t.event_id, t.occurrence_date)
                  from public.event_exceptions_public t), '')
    ) as checksum,
    (select count(*) from public.events_public)           as n_events,
    (select count(*) from public.organizers_public)       as n_organizers,
    (select count(*) from public.event_exceptions_public) as n_exceptions;

comment on view public.events_public is
  'Published events: the column whitelist anon may read. `status = ''approved''` '
  'here is the same expression as the partial index; cancellation is a column, '
  'so a cancelled event is still published and still has a page.';

comment on view public.content_checksum is
  'One row: md5 over every row of the three public views, plus their counts. '
  'Read by the rebuild poller and recorded in each deployment''s build-info.json.';

-- THE REVOKE IS THE POINT. See the header: without it, Supabase's default
-- privileges leave anon with ALL on a freshly created, auto-updatable,
-- security-definer view over public.events.
revoke all on public.events_public    from anon, authenticated;
revoke all on public.content_checksum from anon, authenticated;

grant select on public.events_public    to anon, authenticated;
grant select on public.content_checksum to anon, authenticated;

notify pgrst, 'reload schema';
