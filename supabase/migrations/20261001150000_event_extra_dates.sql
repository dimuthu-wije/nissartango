-- ============================================================================
-- 20261001150000_event_extra_dates.sql
--
-- A three-day workshop is ONE event.
--
-- `recurrence` says "every week until", which is the wrong shape for "13, 14
-- and 15 November". Production has the answer stored the only way it could be:
-- three separate rows, 2026-10-02/03/04-stage-avec-mauro-et-sol, with the same
-- title, teachers and price. Every correction has to be made three times -- the
-- price note was, this afternoon -- and a reader opening one date sees a price
-- that looks like one evening's.
--
-- AN ARRAY, NOT A SIXTH TABLE, for the reason 20260930120000 set out at length:
-- a table forces lockstep edits to supabase/tests/content_inventory.sql,
-- supabase/ops/filter-content-dump.sh, the restore rehearsal's expected COPY
-- count, the teardown's truncate list, and it would add a fourth collection to
-- the snapshot and to src/content.config.ts. `teachers`, `legacy_slugs`,
-- `payment_methods` and `formats` are all arrays and ride along in each of
-- those for free.
--
-- `starts_at` STAYS THE ANCHOR, and these are ADDITIONAL days. Holding every
-- date in one array would mean two sources of truth for the first one -- the
-- slug is derived from it, `recurrence_end` is validated against it -- so the
-- array holds the others and each is given `starts_at`'s time of day, converted
-- through src/lib/zone.js so a workshop spanning the end of October keeps its
-- local hour across the changeover.
--
-- ONE TIME OF DAY FOR ALL OF THEM, deliberately. A Saturday at 14:00 and a
-- Sunday at 11:00 is already expressible: it is an exception of kind `moved`
-- with `moved_starts_at`, which exists, is tested, and renders with
-- schema.org's previousStartDate. Giving every extra date its own timestamp
-- would duplicate that machinery and then disagree with it.
--
-- NOT ALONGSIDE A RECURRENCE. events_extra_dates_need_single_date refuses a
-- non-empty array on a repeating event. Two date generators on one row is a
-- thing no reader of this schema could reason about, and nothing wants it: a
-- weekly practica with two extra one-off nights is two events.
--
-- NO DISTINCTNESS CONSTRAINT, and no "must be after the first date" either.
-- The first needs `select distinct` or an aggregate over unnest(), and a CHECK
-- may not contain a subquery (0A000) -- the wall legacy_slugs and
-- payment_methods both hit. The second needs `starts_at at time zone timezone`,
-- which is STABLE and not IMMUTABLE, so a CHECK will not take it either; that
-- is why the recurrence_end comparison lives in events_validate() rather than
-- in a constraint. Both are handled where they can be: expand() in
-- src/lib/occurrences.js sorts and de-duplicates, so a repeated or
-- out-of-order date renders correctly whatever is stored, and validate.js
-- refuses them at the form with a message that explains.
--
-- THE CHECKSUM MOVES ONCE: a column appended to events_public changes the md5
-- over its rows with no content change.
-- ============================================================================

alter table public.events
  add column extra_dates date[] not null default '{}';

comment on column public.events.extra_dates is
  'Additional days this event also happens on, each at starts_at''s time of '
  'day in the event''s timezone. For a workshop over several days, which is '
  'not a recurrence. Empty for everything else; requires recurrence = none.';

alter table public.events
  add constraint events_extra_dates_need_single_date
      check (cardinality(extra_dates) = 0 or recurrence = 'none'),
  -- A festival is days, not months. 30 is well past anything real and still
  -- refuses an array that has run away.
  add constraint events_extra_dates_sane_length
      check (cardinality(extra_dates) <= 30);

-- ---------------------------------------------------------------------------
-- The review flag. extra_dates is CONTENT: adding a day to a published
-- workshop changes what the agenda shows, so it belongs in this comparison.
--
-- Spelled out rather than left alone because this is the omission that bit
-- today: payment_methods was added on 2026-09-30 and never joined this list,
-- so changing it did not flag an event for review. A new content column that
-- forgets this function is invisible for exactly as long as nobody looks.
--
-- Body taken from 20261001140000 with extra_dates added to both tuples and
-- nothing else touched.
-- ---------------------------------------------------------------------------
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
     new.recurrence, new.recurrence_end, new.extra_dates,
     new.location_name, new.location_address, new.location_postal_code, new.city,
     new.organizer_id, new.teachers,
     new.price_full, new.price_member, new.price_note, new.payment_methods,
     new.signup_url, new.image_path, new.body,
     new.cancelled_at, new.cancellation_note)
    is distinct from
    (old.title, old.formats, old.starts_at, old.duration_minutes, old.timezone,
     old.recurrence, old.recurrence_end, old.extra_dates,
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
-- ---------------------------------------------------------------------------
-- The view the build reads. `create or replace` keeps the grants and the
-- deliberate security_invoker = false, and permits APPENDING a column: the
-- list below is 20261001140000's, verbatim, with extra_dates at the end.
-- ---------------------------------------------------------------------------
create or replace view public.events_public as
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
         formats,
         extra_dates
    from public.events
   where status = 'approved';

grant insert (extra_dates), update (extra_dates)
  on public.events to authenticated;

notify pgrst, 'reload schema';
