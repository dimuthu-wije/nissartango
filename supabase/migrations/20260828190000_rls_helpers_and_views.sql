-- ============================================================================
-- 20260828190000_rls_helpers_and_views.sql
--
-- The two halves of stage 2's foundation:
--   1. SECURITY DEFINER helpers that answer "who is this?" without recursing.
--   2. Public views -- the ONLY thing anon is ever granted.
-- Policies and column grants come in the next migration.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers.
--
-- Why SECURITY DEFINER, and the footgun it defuses:
-- the policy on organizer_members needs to ask "is this user a member of this
-- organizer?", which means reading organizer_members. Written as an inline
-- subquery, that read is itself subject to the policy being evaluated, and
-- Postgres raises "infinite recursion detected in policy". A SECURITY DEFINER
-- function runs as its OWNER (postgres), who is not subject to RLS, so the
-- question is answered outside the policy that asked it.
--
-- The price of DEFINER is that the function ignores RLS, so each one must be
-- small, read-only, and answer exactly one question. `set search_path = ''` is
-- mandatory here, not stylistic: without it a caller can put their own schema
-- in front and have this function call THEIR organizer_members.
--
-- `(select auth.uid())` rather than bare auth.uid(): wrapping it makes Postgres
-- evaluate it once as an InitPlan instead of once per row.
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
     where r.user_id = (select auth.uid()) and r.role = 'admin'
  );
$$;

create or replace function public.is_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizer_members m
     where m.organizer_id = org and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_owner(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizer_members m
     where m.organizer_id = org
       and m.user_id = (select auth.uid())
       and m.role = 'owner'
  );
$$;

-- "may I touch this event?" -- one hop through events to its organizer.
create or replace function public.is_event_member(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.events e
      join public.organizer_members m on m.organizer_id = e.organizer_id
     where e.id = p_event and m.user_id = (select auth.uid())
  );
$$;

-- Storage paths are text; a malformed one must not raise, just fail to match.
create or replace function public.uuid_or_null(value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return value::uuid;
exception when others then
  return null;
end;
$$;

-- EXECUTE is granted to PUBLIC by default, and -- this is the part that bit us
-- -- Supabase ALSO sets default privileges granting EXECUTE on new functions
-- in `public` directly to anon, authenticated and service_role. A revoke from
-- the PUBLIC pseudo-role does NOT remove an explicit grant to anon: they are
-- separate grants. Revoking only from PUBLIC left anon able to call every
-- helper here, and every RPC in the next migration.
--
-- So: name the roles. The sweep at the end of 20260828190100 catches anything
-- added later and forgotten.
revoke execute on function public.is_admin()            from public, anon, authenticated;
revoke execute on function public.is_member(uuid)       from public, anon, authenticated;
revoke execute on function public.is_owner(uuid)        from public, anon, authenticated;
revoke execute on function public.is_event_member(uuid) from public, anon, authenticated;
revoke execute on function public.uuid_or_null(text)    from public, anon, authenticated;

grant execute on function public.is_admin()            to authenticated;
grant execute on function public.is_member(uuid)       to authenticated;
grant execute on function public.is_owner(uuid)        to authenticated;
grant execute on function public.is_event_member(uuid) to authenticated;
grant execute on function public.uuid_or_null(text)    to authenticated;

-- ===========================================================================
-- Public views.
--
-- anon is granted SELECT on these three views and NOTHING else -- no table, no
-- function, no storage object outside the image bucket. "Never rendered in the
-- template" is not a security boundary; a column that is not in the view is.
--
-- These views deliberately keep the default `security_invoker = false`, so
-- they execute as their owner and bypass RLS on the base tables. That IS the
-- mechanism: it lets anon read a column-restricted projection of organizers
-- without holding any privilege on organizers itself. Supabase's linter flags
-- definer views as a matter of course; this one is intentional, and the
-- restriction lives in the column list and the WHERE clause below.
-- ===========================================================================

-- Public organizer columns. email and phone are absent, and that absence is
-- the enforcement -- verify with the curl proof in scripts/prove-rls.sh.
create view public.organizers_public as
  select id, name, slug, website, instagram, facebook, tiktok,
         created_at, updated_at
    from public.organizers;

-- Published events. `status = 'approved'` here is the same expression as the
-- partial index in stage 1; cancellation is a column, not a status, so a
-- cancelled event is still published and still has a page.
create view public.events_public as
  select id, slug, title, type,
         starts_at, duration_minutes, timezone,
         recurrence, recurrence_end,
         location_name, location_address, location_postal_code, city,
         organizer_id, teachers,
         price_full, price_member, price_note,
         signup_url, image_path, body,
         cancelled_at, cancellation_note,
         created_at, updated_at
    from public.events
   where status = 'approved';

-- Exceptions belonging to published events, so the agenda can print
-- "pas de practica le 15 août" instead of silently skipping a week.
create view public.event_exceptions_public as
  select x.event_id, x.occurrence_date, x.kind, x.note, x.moved_starts_at
    from public.event_exceptions x
    join public.events e on e.id = x.event_id
   where e.status = 'approved';

-- ---------------------------------------------------------------------------
-- Grants on the views.
--
-- REVOKE FIRST. Supabase's default privileges grant ALL on new objects in
-- public to anon -- and for privilege purposes a view is a table. Both
-- single-table views here are simple enough to be auto-updatable, so a bare
-- default grant would let anon INSERT through a view that bypasses RLS by
-- design. Revoking, then granting only SELECT, closes that.
-- ---------------------------------------------------------------------------
revoke all on public.organizers_public        from anon, authenticated;
revoke all on public.events_public            from anon, authenticated;
revoke all on public.event_exceptions_public  from anon, authenticated;

grant select on public.organizers_public       to anon, authenticated;
grant select on public.events_public           to anon, authenticated;
grant select on public.event_exceptions_public to anon, authenticated;
