-- ============================================================================
-- 20260828181200_events.sql
-- The events table, its constraints, its indexes, and the four triggers that
-- encode the rules we decided: stable slugs, sane recurrence, and
-- "an edit to an approved event stays live but is flagged for review".
-- ============================================================================

create table public.events (
  id                  uuid primary key default gen_random_uuid(),

  -- Date-prefixed and UNIQUE. Generated once at creation (trigger below) and
  -- never auto-updated, including when starts_at moves. Public links are
  -- forever; a slug that follows the date would break every share and every
  -- Google result the first time a milonga is rescheduled.
  slug                text not null unique,

  title               text not null check (btrim(title) <> ''),
  type                public.event_type not null,

  -- Absolute instant. Rendering and recurrence expansion both convert to
  -- Europe/Paris; the database stores UTC internally, as timestamptz always does.
  starts_at           timestamptz not null,

  -- duration_minutes, not ends_at: a weekly series has ONE shape and MANY
  -- occurrences, so an absolute end timestamp is only meaningful for the first.
  duration_minutes    integer check (duration_minutes > 0 and duration_minutes <= 10080),

  -- Per-event, because a stage in Milan or a festival abroad is plausible.
  timezone            text not null default 'Europe/Paris',

  recurrence          public.recurrence_type not null default 'none',
  recurrence_end      date,
  -- Individual skipped/moved occurrences live in public.event_exceptions
  -- (below), not in an array column, so each one can carry a public reason.

  location_name       text,
  location_address    text,
  location_postal_code text check (location_postal_code ~ '^[0-9]{5}$'),
  city                text not null default 'Nice' check (btrim(city) <> ''),

  -- on delete restrict: deleting an organizer that still has events should
  -- fail loudly rather than orphan or silently remove listings.
  organizer_id        uuid not null references public.organizers (id) on delete restrict,

  teachers            text[] not null default '{}',

  -- Numeric columns for the amounts that go into schema.org offers, plus a
  -- free-text note, because real listings say "participation libre",
  -- "au chapeau", "10€ / 8€ adhérent".
  price_full          numeric(6,2) check (price_full   >= 0),
  price_member        numeric(6,2) check (price_member >= 0),
  price_note          text,

  signup_url          text check (signup_url ~ '^https?://'),
  image_path          text,          -- object path in the Storage bucket
  body                text,          -- markdown

  -- MODERATION state. Nothing but a trigger and the two admin functions in
  -- stage 2 ever writes this; editors are not granted the column at all.
  status              public.event_status not null default 'pending',

  -- LIFECYCLE state, orthogonal to moderation. Set = the event is off; the
  -- page still exists and says Annulé. Un-cancelling is nulling it, with no
  -- guessing about which status to restore, and an event cancelled while
  -- pending is still not published, because published is status = 'approved'
  -- and nothing else.
  cancelled_at        timestamptz,

  -- Public-facing, shown under the Annulé banner. Distinct from review_note,
  -- which is the private editor/admin channel.
  cancellation_note   text,

  -- Set when an editor changes an already-approved event. The event stays
  -- live; it just shows up in your review queue.
  needs_review        boolean not null default false,
  review_note         text,

  -- auth.uid() is null when you insert as postgres or service_role (SQL editor,
  -- importer), so this stays nullable. Stage 2's INSERT policy is what forces
  -- created_by = auth.uid() for real editors.
  created_by          uuid references auth.users (id) on delete set null default auth.uid(),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- An end date on a one-off event is always a mistake.
  constraint events_recurrence_end_needs_series
    check (recurrence <> 'none' or recurrence_end is null),

  -- A cancellation reason with nothing cancelled is a half-finished edit.
  constraint events_note_needs_cancellation
    check (cancellation_note is null or cancelled_at is not null)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- The public build's query, and the only one that runs on every deploy.
-- "Published" is one expression -- status = 'approved' -- and it is the same
-- expression in this index, in the events_public view, and in stage 2's anon
-- grant. Cancellation does not appear here at all: a cancelled event is still
-- published, it just renders differently.
create index events_approved_starts_at_idx
  on public.events (starts_at) where status = 'approved';

-- Your moderation queue: pending first, oldest first.
create index events_status_created_at_idx
  on public.events (status, created_at);

-- "everything my organizer runs", the editor area's main list.
create index events_organizer_id_starts_at_idx
  on public.events (organizer_id, starts_at);

-- Approved-but-changed. Tiny partial index; the queue joins it in.
create index events_needs_review_idx
  on public.events (updated_at) where needs_review;

-- slug already has a unique index from the column constraint.

-- ===========================================================================
-- TRIGGER 1 (insert): generate the slug, once.
-- ===========================================================================
create or replace function public.events_set_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  base      text;
  candidate text;
  n         integer := 1;
begin
  -- An explicit slug wins. This is how the markdown importer keeps the URLs
  -- the site already has, accents and all.
  if new.slug is not null and btrim(new.slug) <> '' then
    return new;
  end if;

  -- Date prefix in the EVENT'S timezone. `starts_at at time zone 'Europe/Paris'`
  -- converts the stored UTC instant to Paris wall-clock time; without it, a
  -- 00:30 milonga on 1 September is stored as 22:30 UTC on 31 August and would
  -- get a slug dated the day before.
  base := to_char(
            new.starts_at at time zone coalesce(new.timezone, 'Europe/Paris'),
            'YYYY-MM-DD'
          ) || '-' || left(public.slugify(new.title), 70);
  base := trim(both '-' from base);

  candidate := base;
  while exists (select 1 from public.events e where e.slug = candidate) loop
    n := n + 1;
    candidate := base || '-' || n::text;
  end loop;

  -- Two simultaneous inserts of the same title could both pass this loop; the
  -- unique index is the real guarantee and one of them gets a duplicate-key
  -- error. At this site's write volume that is theoretical.
  new.slug := candidate;
  return new;
end;
$$;

create trigger t10_events_set_slug
  before insert on public.events
  for each row execute function public.events_set_slug();

-- ===========================================================================
-- TRIGGER 2 (update): the slug is immutable.
--
-- To change one deliberately, open a transaction and flip the escape hatch:
--
--   begin;
--   set local app.allow_slug_change = 'on';
--   update public.events set slug = '2026-09-01-practica-du-mardi'
--    where id = '...';
--   commit;
--
-- `set local` dies with the transaction, so the hatch cannot be left open.
-- And when you do this, add a redirect for the old slug -- the old URL is
-- already in someone's bookmarks.
-- ===========================================================================
create or replace function public.events_protect_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug
     and coalesce(current_setting('app.allow_slug_change', true), 'off') <> 'on'
  then
    raise exception
      'slug is immutable (event %); set local app.allow_slug_change = ''on'' to change it deliberately',
      old.id
      using errcode = 'NT002';   -- see the code table in 20260828181000
  end if;
  return new;
end;
$$;

create trigger t10_events_protect_slug
  before update on public.events
  for each row execute function public.events_protect_slug();

-- ===========================================================================
-- TRIGGER 0 (insert + update): validation that a CHECK constraint cannot do.
-- CHECK expressions must be immutable, and both of these depend on the
-- timezone database, which is only STABLE.
-- ===========================================================================
create or replace function public.events_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    raise exception 'unknown timezone %', new.timezone using errcode = 'NT003';
  end if;

  if new.recurrence <> 'none'
     and new.recurrence_end is not null
     and new.recurrence_end < (new.starts_at at time zone new.timezone)::date
  then
    raise exception 'recurrence_end (%) is before the first occurrence (%)',
      new.recurrence_end, (new.starts_at at time zone new.timezone)::date
      using errcode = 'NT004';
  end if;

  return new;
end;
$$;

-- t05, so validation runs BEFORE the slug trigger derives anything from these
-- columns. Otherwise a bad timezone is reported by `at time zone` inside slug
-- generation (22023) instead of by the rule that is supposed to own it, and
-- the specific error this file promises is unreachable on insert.
create trigger t05_events_validate
  before insert or update on public.events
  for each row execute function public.events_validate();

-- ===========================================================================
-- TRIGGER 4 (update): "stays live, flagged for review".
--
-- An editor fixing a typo at 18:00 the day before a milonga must not take the
-- listing off the site. So the row keeps status = 'approved' and lands in your
-- queue instead. A moderation decision (any status change) clears the flag.
--
-- Note what is NOT in the content list: status, review_note, needs_review,
-- updated_at. Approving an event must not re-flag it.
-- ===========================================================================
create or replace function public.events_flag_review()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  content_changed boolean;
begin
  content_changed :=
    (new.title, new.type, new.starts_at, new.duration_minutes, new.timezone,
     new.recurrence, new.recurrence_end,
     new.location_name, new.location_address, new.location_postal_code, new.city,
     new.organizer_id, new.teachers,
     new.price_full, new.price_member, new.price_note,
     new.signup_url, new.image_path, new.body,
     new.cancelled_at, new.cancellation_note)
    is distinct from
    (old.title, old.type, old.starts_at, old.duration_minutes, old.timezone,
     old.recurrence, old.recurrence_end,
     old.location_name, old.location_address, old.location_postal_code, old.city,
     old.organizer_id, old.teachers,
     old.price_full, old.price_member, old.price_note,
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

create trigger t30_events_flag_review
  before update on public.events
  for each row execute function public.events_flag_review();

-- ===========================================================================
-- TRIGGER 5 (update): updated_at.
-- Named t40 so it fires last; trigger order within a timing is alphabetical.
-- ===========================================================================
create trigger t40_events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- event_exceptions
--
-- Was `exceptions date[]` on events. An array deletes an occurrence silently:
-- the reader of a weekly practica just sees nothing on 15 August and cannot
-- tell a cancellation from a data-entry gap. A row per exception carries the
-- reason, so the agenda can print "Pas de practica le 15 août (Assomption)".
--
-- kind = 'moved' additionally carries the new instant, for the milonga that
-- shifts a day rather than disappearing.
-- ===========================================================================
create table public.event_exceptions (
  event_id         uuid not null references public.events (id) on delete cascade,

  -- Which occurrence this is about, defined EXACTLY as
  -- public.occurrence_local_date(occurrence start instant, event timezone):
  -- the local date in the event's own timezone. Not UTC, not a timestamptz.
  -- Stage 3's expansion must key occurrences the same way or an exception
  -- matches nothing and a cancelled date stays quietly on the agenda.
  occurrence_date  date not null,

  kind             public.exception_kind not null default 'cancelled',

  -- Public-facing French, rendered in the agenda. Optional: a bare skip is
  -- still better than a silent one.
  note             text,

  -- Required for 'moved', forbidden otherwise.
  moved_starts_at  timestamptz,

  created_at       timestamptz not null default now(),

  primary key (event_id, occurrence_date),

  constraint event_exceptions_moved_needs_target
    check ((kind = 'moved') = (moved_starts_at is not null))
);

comment on table public.event_exceptions is
  'One row per skipped or moved occurrence of a recurring event, with a public reason.';

-- The build reads these per event, in date order, alongside the series.
create index event_exceptions_event_id_date_idx
  on public.event_exceptions (event_id, occurrence_date);

-- ---------------------------------------------------------------------------
-- An exception is public content, so touching one has to flag its parent the
-- same way editing the event body does -- otherwise cancelling an occurrence
-- of a live series bypasses the review queue entirely.
-- ---------------------------------------------------------------------------
create or replace function public.event_exceptions_flag_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target uuid := coalesce(new.event_id, old.event_id);
begin
  update public.events e
     set needs_review = true
   where e.id = target
     and e.status = 'approved'
     and e.needs_review = false;
  return coalesce(new, old);
end;
$$;

create trigger t30_event_exceptions_flag_parent
  after insert or update or delete on public.event_exceptions
  for each row execute function public.event_exceptions_flag_parent();

-- ---------------------------------------------------------------------------
-- Locked until stage 2.
--
-- Note for stage 2: RLS WITH CHECK is evaluated on the row as it exists AFTER
-- before-row triggers have run, exactly like an ordinary CHECK constraint. So
-- the resubmit rule above (rejected -> pending) has to be legal under the
-- editor UPDATE policy, or a legitimate edit is refused by a policy the
-- trigger itself walked the row into.
--
-- And note what a policy CANNOT say: USING sees the old row, WITH CHECK sees
-- the new one, and no expression sees both. "May move approved -> cancelled
-- but not pending -> approved" is not expressible. Transition rules therefore
-- live in triggers, and `status` is kept out of editors' hands by never
-- granting UPDATE on the column at all -- privileges and RLS are independent
-- layers, and both must pass.
-- ---------------------------------------------------------------------------
alter table public.events            enable row level security;
alter table public.event_exceptions  enable row level security;

revoke all on table public.events           from anon, authenticated;
revoke all on table public.event_exceptions from anon, authenticated;
