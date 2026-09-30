-- ============================================================================
-- 20260930120000_payment_methods.sql
--
-- How you may pay on the door.
--
-- THE QUESTION THIS ANSWERS IS ASKED AT THE DOOR, not on the site, and that is
-- the point: someone arriving at a milonga with only a card, at a venue that
-- takes cash, has a wasted evening. It is the kind of fact an organizer knows
-- and never thinks to write, because they know it.
--
-- A TEXT ARRAY AND NOT A SIXTH TABLE, for the reason legacy_slugs is one: a
-- table would force lockstep edits to supabase/tests/content_inventory.sql,
-- supabase/ops/filter-content-dump.sh, E1's expected COPY count and the
-- teardown's truncate list. `teachers text[]` and `legacy_slugs text[]` are the
-- precedent, and an array rides along in all of them for free.
--
-- SLUGS, NOT LABELS. The stored values are ASCII (`especes`, `cb`, `cheque`)
-- and the French words live in the templates. A label in the database is a
-- label you cannot change without a migration, and one that has to be spelled
-- identically by every writer -- "espèces" and "especes" would be two payment
-- methods.
--
-- CONSTRAINED BY A CHECK, not an enum type. An enum needs ALTER TYPE to grow,
-- which cannot run in the same transaction as a statement using the new value
-- on older PostgreSQL, and this list will grow (virement, Lydia, Sumup). The
-- containment check refuses an unknown value just as firmly and is a one-line
-- migration to extend.
--
-- EMPTY MEANS "NOT SAID", NOT "CASH ONLY". Nothing renders for an empty array.
-- Defaulting to cash would put a claim on the page that no organizer made.
--
-- THE CONTENT CHECKSUM CHANGES ONCE. content_checksum is an md5 over the three
-- public views and events_public is one of them, so appending a column changes
-- the digest with no content change: expect exactly one drift-triggered
-- rebuild from the poller.
-- ============================================================================

alter table public.events
  add column payment_methods text[] not null default '{}';

comment on column public.events.payment_methods is
  'How you may pay on the door: slugs from (especes, cb, cheque, virement). '
  'Empty means the organizer did not say, NOT that only cash is taken.';

-- `<@` is containment: every element must be one of the four. An array
-- operator, deliberately -- a CHECK constraint may not contain a subquery
-- (0A000), which is the same wall legacy_slugs hit and wrote down.
--
-- NO DISTINCTNESS CONSTRAINT, and not for want of trying. "every element
-- appears once" needs `select distinct` or an aggregate over unnest(), and
-- both are subqueries, so Postgres refuses them here. A trigger could do it;
-- it is not worth one. The editor writes this from CHECKBOXES, which cannot
-- produce a duplicate, and the only other writer is somebody typing SQL by
-- hand. What IS enforceable without a subquery is a length bound, so a
-- runaway array is refused even though ['cb','cb'] is not.
alter table public.events
  add constraint events_payment_methods_known
      check (payment_methods <@ array['especes', 'cb', 'cheque', 'virement']::text[]),
  add constraint events_payment_methods_sane_length
      check (cardinality(payment_methods) <= 4);

-- ---------------------------------------------------------------------------
-- The view the build reads.
--
-- `create or replace view` keeps the existing grants and the deliberate
-- `security_invoker = false`, and permits APPENDING columns but not reordering
-- them -- so the list below is the previous one, verbatim, with
-- payment_methods added at the end. Do not tidy the order.
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
         legacy_slugs,
         payment_methods
    from public.events
   where status = 'approved';

-- Writable by an editor, like every other content column. Appended to the
-- existing column grants from 20260828190100_rls_policies.sql; a second
-- `grant insert/update (...)` ADDS columns rather than replacing the set.
grant insert (payment_methods), update (payment_methods)
  on public.events to authenticated;

notify pgrst, 'reload schema';
