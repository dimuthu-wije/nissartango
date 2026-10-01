-- ============================================================================
-- 20261001120000_event_formats.sql
--
-- An evening can be a class AND social dancing. One column could not say so.
--
-- `events.type` is a single enum value, and the commonest format there is --
-- an hour of teaching followed by two hours of dancing -- needs two. The
-- workaround in production is the title: "Milonga précédée d'une practica"
-- encodes in prose what the schema could not hold, which means nothing can
-- filter on it and a reader gets one badge for a two-part evening.
--
-- A SECOND CONCERN WAS RIDING IN THE SAME COLUMN. Confirmed 2026-10-01 that
-- this agenda covers bachata, kizomba and danse corse deliberately, and the
-- enum is entirely tango vocabulary -- so Danse corse was stored as a
-- `milonga` and its page showed a reader the badge **Milonga**. `soiree` is
-- added here for a social dance evening that is not a milonga, because
-- "milonga" is what a TANGO social evening is called, not what any is.
--
-- The dance STYLE is still not a column, on purpose. Every such event names
-- its dance in its title, and a `dance` column only earns its keep when
-- something filters on it -- Outstanding item 5. Adding it now would be
-- building a key for a lock nobody has cut.
--
-- TEXT[] WITH A CHECK, NOT AN ENUM ARRAY, for the reason payment_methods
-- gives at length: `alter type ... add value` cannot be used in the same
-- transaction as a statement using the new value on older PostgreSQL, and
-- this list grows (soiree today, and a `bal` or an `atelier` later).
-- Containment refuses an unknown value just as firmly in one line.
--
-- `type` IS LEFT IN PLACE, and this is deliberate rather than lazy. Removing a
-- column from a view needs DROP and CREATE, not `create or replace`, and a
-- freshly created view here is DANGEROUS: Supabase's default privileges grant
-- ALL on new objects in public to anon, events_public is a simple enough view
-- to be auto-updatable, and it runs `security_invoker = false` by design -- so
-- a recreate that forgot the `revoke all` from 20260828190000 would hand anon
-- INSERT through a view that bypasses RLS. content_checksum depends on
-- events_public too, so the drop cascades to it.
--
-- That is a contract migration to write carefully and on its own, once nothing
-- reads `type`. Until then the two columns agree because the backfill below
-- makes them agree and the editor writes both.
--
-- NULLABLE, FOR ONE DEPLOY ONLY. The editor currently live does not send
-- `formats`, and `not null` here would make every event it creates fail
-- between this migration and the next deploy. Every existing row is
-- backfilled, the site falls back to `[type]` for a row that somehow has
-- neither, and the contract migration sets `not null`.
--
-- THE CONTENT CHECKSUM CHANGES ONCE, as it did for payment_methods: appending
-- a column to events_public changes the md5 with no content change. Expect
-- exactly one drift-triggered rebuild from the poller.
-- ============================================================================

alter table public.events
  add column formats text[];

comment on column public.events.formats is
  'What happens, as a SET: slugs from (cours, practica, milonga, stage, demo, '
  'festival, soiree). A class followed by dancing is two of them. Supersedes '
  'the single-valued `type`, which is kept until a contract migration can drop '
  'it safely -- see 20261001120000.';

-- Every existing row, from the column it supersedes. `type::text` because the
-- target is text[]; the enum's labels and these slugs are the same strings.
update public.events
   set formats = array[type::text];

alter table public.events
  add constraint events_formats_known
      check (formats is null
             or formats <@ array['cours', 'practica', 'milonga', 'stage',
                                 'demo', 'festival', 'soiree']::text[]),
  -- At least one, because an event with no format is not describable; at most
  -- three, because the same bound on payment_methods is what stands in for the
  -- distinctness constraint Postgres will not accept (a CHECK may not contain
  -- a subquery, 0A000). ['cours','cours'] is still accepted; a runaway is not.
  add constraint events_formats_sane_length
      check (formats is null or cardinality(formats) between 1 and 3);

-- ---------------------------------------------------------------------------
-- The view the build reads.
--
-- `create or replace view` keeps the existing grants, keeps the deliberate
-- `security_invoker = false`, and permits APPENDING columns but not reordering
-- them -- so the list below is the previous one, verbatim, with formats added
-- at the end. Do not tidy the order, and do not remove `type` here: see the
-- header.
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
         payment_methods,
         formats
    from public.events
   where status = 'approved';

-- Writable by an editor, like every other content column. Appended to the
-- existing column grants; a second `grant insert/update (...)` ADDS columns
-- rather than replacing the set.
grant insert (formats), update (formats)
  on public.events to authenticated;

notify pgrst, 'reload schema';
