-- ============================================================================
-- 20260919120000_legacy_slugs.sql
--
-- Legacy URLs become content instead of a hand-maintained file.
--
-- THE BUG THIS REMOVES. `public/_redirects` hard-coded one event's slug in four
-- rules, and every destination was that event's page. Those pages exist only
-- while the event is `approved`, because `events_public` filters on it. So the
-- first time anybody rejected or deleted that event:
--
--     fetch-content drops it from the snapshot
--       -> astro does not build /evenements/<slug>/
--       -> verify-build.mjs check 7 "_redirects points at ..., not in dist/"
--       -> build exits 1, deploy fails, site freezes on the last good copy
--
-- Using the moderation feature would have broken the deploy. The moderation
-- layer became usable on 2026-09-19 when the first admin was bootstrapped, so
-- this stopped being theoretical that morning.
--
-- WHY A COLUMN AND NOT A SIXTH TABLE. A table would force lockstep edits to
-- `supabase/tests/content_inventory.sql`, `supabase/ops/filter-content-dump.sh`,
-- E1's expected COPY count and the teardown's truncate list -- four files that
-- must agree about the shape of the content, in a backup deliverable that is
-- already proven. An array column rides along in every one of them for free.
-- `teachers text[]` is the precedent.
--
-- WHAT IS STORED. One canonical legacy slug per entry: the slug as it actually
-- was, accents and all. NOT the URL, and not the percent-encoded spelling --
-- those are derivable, and `scripts/fetch-content.mjs` derives all four
-- variants (encoded/raw, with/without trailing slash). Storing four spellings
-- of one fact is how the hand-written file got stale in the first place.
--
-- NO SHAPE CONSTRAINT, DELIBERATELY. A legacy slug is a historical artefact of
-- whatever the URL once was. `slugify()` would reject the very value this
-- column exists to hold -- the Casita slug is accented, which is the whole
-- reason it needed redirecting.
--
-- A WITHDRAWN EVENT'S LEGACY URL NOW 404s. When an event leaves
-- `events_public`, its legacy slugs leave with it and no rule is generated.
-- Recorded as acceptable at this scale rather than as correct: a 404 on a URL
-- for an event that no longer exists is honest, and redirecting it to the
-- agenda would be a lie about what was there. It stops being the right answer
-- if withdrawal becomes routine, at which point the destination wants to be a
-- tombstone page rather than nothing.
--
-- THE CONTENT CHECKSUM CHANGES ONCE. `content_checksum` is an md5 over
-- `events_public` rows as text, so adding a column changes the digest even
-- though no content changed. Expect exactly one drift-triggered rebuild from
-- the poller after this is applied. That is the system working, not a fault.
-- ============================================================================

alter table public.events
  add column legacy_slugs text[] not null default '{}';

comment on column public.events.legacy_slugs is
  'Slugs this event used to be published under. One canonical spelling each, '
  'accents included; the URL variants are derived at build time. Empty for '
  'anything that has only ever had its current slug.';

-- NULL and blank entries are both silently destructive: a null becomes the
-- string "null" in a generated path, and a blank generates a redirect from
-- /evenements/ itself, which would shadow every event page. Neither is
-- expressible as a subquery inside a CHECK, so both are caught with array
-- operators instead.
alter table public.events
  add constraint events_legacy_slugs_no_nulls
      check (array_position(legacy_slugs, null) is null),
  add constraint events_legacy_slugs_no_blanks
      check (not (legacy_slugs && array['', ' ']::text[]));

-- ---------------------------------------------------------------------------
-- The view the build reads.
--
-- `create or replace view` keeps the existing grants and the deliberate
-- `security_invoker = false`, and it permits APPENDING columns but not
-- reordering them -- so the list below is the original, verbatim, with
-- legacy_slugs added at the end. Do not tidy the order.
--
-- Legacy slugs are public by definition: they are URLs that were crawled.
-- Nothing here widens what anon can read.
-- ---------------------------------------------------------------------------
create or replace view public.events_public as
  select id, slug, title, type,
         starts_at, duration_minutes, timezone,
         recurrence, recurrence_end,
         location_name, location_address, location_postal_code, city,
         organizer_id, teachers,
         price_full, price_member, price_note,
         signup_url, image_path, body,
         cancelled_at, cancellation_note,
         created_at, updated_at,
         legacy_slugs
    from public.events
   where status = 'approved';

notify pgrst, 'reload schema';
