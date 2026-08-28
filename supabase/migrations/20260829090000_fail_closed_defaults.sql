-- ============================================================================
-- 20260829090000_fail_closed_defaults.sql
--
-- The first migration written AFTER the schema was pushed to a hosted project.
-- Everything before this is history now: it has run against a real database
-- and its checksums are recorded, so it gets appended to, never edited.
--
-- WHAT THIS IS
--
-- The dev project was configured in the dashboard with "Automatically expose
-- new tables" OFF, so a new table is unreachable until something grants on it
-- explicitly. This migration says the same thing in code, for three reasons:
--
--   1. A dashboard setting does not travel. When the production project is
--      created in a few months, nothing in this repo would remind anyone --
--      the same failure mode as putting TZ=Europe/Paris in a build env.
--   2. `supabase db reset` locally would otherwise disagree with the hosted
--      project about the exact behaviour the security model rests on: a table
--      could work locally and 401 on the dev project, or worse, be public
--      locally and teach us the wrong lesson.
--   3. It is the same fail-closed posture as every `revoke all` in stage 1,
--      applied to tables that do not exist yet.
--
-- ALTER DEFAULT PRIVILEGES is per creating-role: this affects objects created
-- by the role running the migration (postgres), which is every object these
-- migrations make.
--
-- Note the local counterpart in supabase/config.toml:
--     auto_expose_new_tables = false
-- Both are needed. This one governs privileges; that one governs how the local
-- stack is provisioned in the first place.
-- ============================================================================

alter default privileges in schema public
  revoke all on tables from anon, authenticated;

alter default privileges in schema public
  revoke all on sequences from anon, authenticated;

-- Already revoked in 20260828190100 for functions; repeated here so all three
-- object types are stated in one place. Revoking twice is a no-op.
alter default privileges in schema public
  revoke execute on functions from anon, authenticated;

-- A note on the third dashboard setting, "Enable automatic RLS": it is ON.
-- Nothing is needed here to match it, because every table these migrations
-- create already enables RLS explicitly, and enabling it twice does nothing.
-- What keeps the two honest is the assertion in supabase/tests/grants_check.sql
-- that RLS is on for every table in `public` -- which fails loudly if either
-- the setting or a future migration lets one through.
