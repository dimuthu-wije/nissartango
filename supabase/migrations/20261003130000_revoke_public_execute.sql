-- ============================================================================
-- 20261003130000_revoke_public_execute.sql
--
-- anon could call the two functions added an hour earlier. Closing that, and
-- the hole that let it happen.
--
-- WHAT WENT WRONG. Postgres grants EXECUTE on a new function to PUBLIC, and
-- every role is a member of PUBLIC. 20260828190100 knew this -- its one-time
-- sweep reads `from public, anon, authenticated`, and a comment in
-- 20260828190000 records learning that "revoking only from PUBLIC left anon
-- able to call every..." -- but the ALTER DEFAULT PRIVILEGES beside it reads
--
--     alter default privileges in schema public
--       revoke execute on functions from anon, authenticated;
--
-- with PUBLIC absent. So the sweep covered everything that existed and the
-- default covered nothing that PUBLIC would get. Measured on production
-- 2026-10-03: of twenty functions in `public`, exactly the two created after
-- that migration were callable by anon.
--
-- CONFIRMED FROM OUTSIDE, with the anon key, because the difference is visible
-- only in the message:
--
--     add_organizer_member -> 42501 "not authorised"
--                             the function RAN and hit its own check
--     is_admin             -> 42501 "permission denied for function is_admin"
--                             not callable at all
--
-- Not exploitable as it stood: both functions check is_owner/is_admin BEFORE
-- touching auth.users, so anon learned nothing and changed nothing. It is fixed
-- anyway, because "anon gets nothing: not a helper, not an RPC, not even one
-- that would only ever answer false" is the rule this project states, and a
-- rule that bends for the harmless case is not a rule.
--
-- AND THE TEST THAT SHOULD HAVE CAUGHT IT DID NOT. It asked
-- information_schema.role_routine_grants WHERE grantee = 'anon', and a grant to
-- PUBLIC produces no row for anon -- so the assertion "anon cannot execute any
-- function in public" was reading a list that could not contain the answer.
-- schema_tests.sql now asks has_function_privilege('anon', oid, 'EXECUTE'),
-- which resolves PUBLIC membership and is the question anyone thought was
-- being asked.
-- ============================================================================

-- The sweep, as 20260828190100 did it. A no-op for the eighteen functions that
-- were already covered; the explicit grants to `authenticated` are untouched,
-- because revoking from PUBLIC removes only PUBLIC's entry.
revoke execute on all functions in schema public from public;

-- The half that was missing. Without PUBLIC here, every future function repeats
-- this exactly as these two did.
alter default privileges in schema public
  revoke execute on functions from public;

notify pgrst, 'reload schema';
