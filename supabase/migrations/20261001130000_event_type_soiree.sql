-- ============================================================================
-- 20261001130000_event_type_soiree.sql
--
-- `soiree` has to exist in the enum too. Follows 20261001120000 immediately,
-- and it should have been part of it.
--
-- THE BUG, IN FULL. 20261001120000 added `formats text[]` constrained by a
-- CHECK listing seven values, and kept the single-valued `type` column because
-- dropping it means recreating events_public. The editor therefore writes BOTH:
-- `formats` as the set, and `type` as `formats[0]`. Six of the seven values are
-- enum labels. `soiree` is the one that is not -- and it is the one the whole
-- migration existed for. Ticking Soirée on Danse corse returned
--
--     invalid input value for enum event_type: "soiree"
--
-- so the first real use of the feature failed. Nothing was half-written: it is
-- one PATCH and the enum refused it.
--
-- WHY THIS WAS NOT CAUGHT. The lists were checked against each other in the
-- places they were COPIED -- FORMATS in format.js against the CHECK in the
-- migration, by tests/format.test.js -- and the enum was not one of the copies
-- anybody thought to compare, because the plan was for `type` to go away.
-- A column scheduled for deletion is still a column that gets written to.
-- tests/format.test.js now reads these migrations and binds all three.
--
-- `ADD VALUE` IN A TRANSACTION. supabase db push wraps each migration in one.
-- Postgres 12 and later permit ALTER TYPE ... ADD VALUE inside a transaction
-- block; what it forbids is USING the new value in the same transaction. This
-- migration only declares it -- the row that uses it is saved later, from the
-- editor -- so it is safe. Measured against dev before production, because
-- "the docs say 12+ allows it" is a claim about Postgres, not about this
-- project.
--
-- NO VIEW CHANGE AND NO CHECKSUM MOVE. Adding a label to an enum alters no
-- row of events_public, so content_checksum does not move and no rebuild is
-- triggered. The digest moves when an event is actually saved as a soiree.
-- ============================================================================

alter type public.event_type add value if not exists 'soiree';

-- The enum's labels and events_formats_known's list are now the same seven.
comment on type public.event_type is
  'Formats an event can have. Kept in step with events_formats_known '
  '(20261001120000) because events.formats[1] is written into events.type '
  'until the contract migration drops that column.';

notify pgrst, 'reload schema';
