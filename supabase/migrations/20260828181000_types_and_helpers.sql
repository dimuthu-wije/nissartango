-- ============================================================================
-- 20260828181000_types_and_helpers.sql
-- Enum types + reusable trigger helpers. No tables yet.
-- ============================================================================

-- unaccent turns "Pràctica" into "Practica" so slugs stay ASCII.
-- On Supabase, extensions live in their own schema, never in public.
create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- SQLSTATE codes for this application's own rules.
--
-- Tests assert on these, never on message text: the messages are English
-- today, may be French tomorrow, and are the kind of thing you reword without
-- thinking about the test suite. A code also cannot be produced accidentally
-- by the platform, so a permission error can never masquerade as one of our
-- rules -- which is the failure this project keeps producing.
--
--   NT001  an organizer would be left with no owner
--   NT002  an event slug was changed without the escape hatch
--   NT003  unknown timezone
--   NT004  recurrence_end precedes the first occurrence
--   NT005  a rejection was submitted without a reason
--
-- Standard codes are kept where a standard one fits: 42501 for "not
-- authorised" (PostgREST maps it to 401/403), 23514 for real CHECK
-- constraints, 23505 for unique violations.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Enums. A Postgres enum is a closed set: writing an event with
-- type = 'concert' fails at the database, not in application code.
-- Adding a value later is `alter type ... add value`, in its own migration.
-- ---------------------------------------------------------------------------
create type public.event_type as enum
  ('cours', 'practica', 'milonga', 'stage', 'demo', 'festival');

create type public.recurrence_type as enum
  ('none', 'weekly', 'biweekly', 'monthly');

-- MODERATION state only. Cancellation is lifecycle state and lives in
-- events.cancelled_at, because the two are orthogonal: a cancelled event is
-- still an approved one, and folding them into a single enum would lose that
-- the moment it was used -- cancelling an approved event would erase the fact
-- that it was ever approved, and cancelling a pending event would publish
-- something nobody approved.
create type public.event_status as enum
  ('pending', 'approved', 'rejected');

-- Enum VALUES are the expensive thing to add later (from PG12 `alter type ...
-- add value` runs in a transaction, but the value is unusable until that
-- transaction commits, so a late addition is a two-migration dance around live
-- data). 'moved' therefore ships now, though only 'cancelled' is common.
create type public.exception_kind as enum
  ('cancelled', 'moved');

create type public.member_role as enum
  ('owner', 'editor');

create type public.app_role as enum
  ('admin');

-- ---------------------------------------------------------------------------
-- slugify(): accent-folded, lowercase, hyphen-separated.
--   'Milonga précédée d''une pràctica' -> 'milonga-precedee-d-une-practica'
-- STABLE, not IMMUTABLE: unaccent depends on a dictionary that could be
-- reloaded, so Postgres will not let us index on this. We only call it from a
-- trigger, so that is fine.
-- `set search_path = ''` forces every reference to be schema-qualified; it is
-- the standard defence against a caller shadowing a function we depend on.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, for an unglamorous reason found by testing: this is called
-- from an INSERT trigger, so it runs as whoever is inserting -- an editor,
-- holding the `authenticated` role -- and unaccent() lives in the extensions
-- schema. As an invoker-rights function it fails with "permission denied for
-- schema extensions" for every editor insert. The alternative, granting
-- authenticated USAGE on extensions, opens the whole schema to reach one
-- text function. This one takes text and returns text; it reads nothing.
create or replace function public.slugify(value text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select trim(both '-' from
    regexp_replace(
      lower(extensions.unaccent(coalesce(value, ''))),
      '[^a-z0-9]+', '-', 'g'
    )
  );
$$;

comment on function public.slugify(text) is
  'Accent-folded lowercase hyphen slug. Used once at event creation.';

-- ---------------------------------------------------------------------------
-- set_updated_at(): one function, attached to every table that has the column.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- occurrence_local_date(): THE definition of which calendar day an occurrence
-- belongs to.
--
--   "the local date of the occurrence's start instant, in the event's timezone"
--
-- This is the key event_exceptions rows are written against, so stage 3's
-- expansion in JavaScript MUST produce the identical date. If the two drift,
-- an exception matches no occurrence and a cancelled date quietly stays on the
-- agenda -- silent, and seasonal. A 00:30 milonga is stored as 22:30 UTC the
-- previous day, so a UTC-based date is off by one for every after-midnight
-- event, half the year over.
--
-- This function is the reference implementation. The build's test fixture
-- compares against it.
-- ---------------------------------------------------------------------------
create or replace function public.occurrence_local_date(at timestamptz, tz text)
returns date
language sql
stable
set search_path = ''
as $$
  select (at at time zone coalesce(tz, 'Europe/Paris'))::date;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
