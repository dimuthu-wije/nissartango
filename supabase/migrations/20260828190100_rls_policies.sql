-- ============================================================================
-- 20260828190100_rls_policies.sql
--
-- Three independent layers, all of which must pass. Keeping them straight is
-- most of understanding RLS:
--
--   GRANT      -- may this ROLE touch this TABLE / these COLUMNS at all?
--   RLS policy -- which ROWS may it touch?
--   trigger    -- is this particular TRANSITION legal?
--
-- Editors never get the `status` column in a GRANT, so no policy has to defend
-- it. That matters, because a policy could not: USING sees the old row,
-- WITH CHECK sees the new one, and no expression sees both -- "may move
-- approved -> cancelled but not pending -> approved" is not expressible in
-- that language. Transitions live in triggers; privileges keep editors out of
-- the column entirely.
-- ============================================================================

-- ===========================================================================
-- events
-- ===========================================================================

-- Authenticated editors read the base table (anon uses events_public and has
-- no grant here at all). Full-column SELECT is deliberate: an editor must see
-- review_note -- it is the channel you reject events through -- and RLS below
-- limits them to their own organizers' rows.
grant select on public.events to authenticated;

-- The editable surface. Everything omitted here is unreachable for an editor
-- no matter what any policy says:
--   id, slug        -- identity and permalink (slug also has its own trigger)
--   status          -- moderation, via approve_event / reject_event only
--   needs_review    -- set by trigger, cleared by mark_reviewed
--   review_note     -- your channel, not theirs
--   created_by      -- filled from auth.uid() by DEFAULT
--   created_at, updated_at
grant insert (title, type, starts_at, duration_minutes, timezone,
              recurrence, recurrence_end,
              location_name, location_address, location_postal_code, city,
              organizer_id, teachers,
              price_full, price_member, price_note,
              signup_url, image_path, body,
              cancelled_at, cancellation_note)
  on public.events to authenticated;

grant update (title, type, starts_at, duration_minutes, timezone,
              recurrence, recurrence_end,
              location_name, location_address, location_postal_code, city,
              organizer_id, teachers,
              price_full, price_member, price_note,
              signup_url, image_path, body,
              cancelled_at, cancellation_note)
  on public.events to authenticated;

grant delete on public.events to authenticated;

-- Row rules. Policies are OR'd, so the admin policies below simply add reach.
create policy events_member_select on public.events
  for select to authenticated
  using (public.is_member(organizer_id));

-- `status = 'pending'` in WITH CHECK is the fix for "a DEFAULT is not a
-- constraint". A default only applies when the column is omitted; without this
-- an editor who can name the column publishes themselves. Belt and braces:
-- they are not granted the column either.
create policy events_member_insert on public.events
  for insert to authenticated
  with check (
    public.is_member(organizer_id)
    and status = 'pending'
    and created_by = (select auth.uid())
  );

-- USING picks the rows they may attempt; WITH CHECK validates the result, so
-- an editor cannot move an event to an organizer they do not belong to.
-- Evaluated AFTER before-row triggers, so the rejected -> pending rewrite must
-- be legal here: it is, because this policy says nothing about status.
create policy events_member_update on public.events
  for update to authenticated
  using (public.is_member(organizer_id))
  with check (public.is_member(organizer_id));

-- Editors may delete their drafts, never a published event: a live URL is
-- already on Facebook. Taking an approved event off the agenda is
-- cancellation, which is a column they own.
create policy events_member_delete on public.events
  for delete to authenticated
  using (public.is_member(organizer_id) and status <> 'approved');

create policy events_admin_select on public.events
  for select to authenticated using (public.is_admin());
create policy events_admin_update on public.events
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy events_admin_delete on public.events
  for delete to authenticated using (public.is_admin());

-- ===========================================================================
-- event_exceptions
-- ===========================================================================
grant select, insert, update, delete on public.event_exceptions to authenticated;

create policy exceptions_member_all on public.event_exceptions
  for all to authenticated
  using (public.is_event_member(event_id))
  with check (public.is_event_member(event_id));

create policy exceptions_admin_all on public.event_exceptions
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===========================================================================
-- organizers
--
-- anon never reaches this table -- that is what organizers_public is for, and
-- why email and phone are safe here rather than merely unrendered.
-- ===========================================================================
grant select on public.organizers to authenticated;

grant update (name, website, instagram, facebook, tiktok, email, phone)
  on public.organizers to authenticated;   -- not id, not slug: both are URLs

create policy organizers_member_select on public.organizers
  for select to authenticated using (public.is_member(id));

create policy organizers_owner_update on public.organizers
  for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));

create policy organizers_admin_all on public.organizers
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- Creating and deleting organizers stays with you: no INSERT/DELETE grant to
-- authenticated at all, so even the admin policy above cannot be exercised
-- from a user token. Use the dashboard or service_role.

-- ===========================================================================
-- organizer_members -- the handover table
-- ===========================================================================
grant select, insert, update, delete on public.organizer_members to authenticated;

-- Note this policy reads organizer_members via is_member(), a DEFINER
-- function. Inline, the same subquery would be evaluated under this very
-- policy: "infinite recursion detected in policy for relation
-- organizer_members". This is the classic footgun.
create policy members_select on public.organizer_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_member(organizer_id)
    or public.is_admin()
  );

create policy members_owner_write on public.organizer_members
  for all to authenticated
  using (public.is_owner(organizer_id) or public.is_admin())
  with check (public.is_owner(organizer_id) or public.is_admin());

-- An organizer with no owner is unmaintainable and only you could fix it.
--
-- With one deliberate exception. organizer_members.user_id cascades from
-- auth.users, so deleting an ACCOUNT deletes its memberships -- and a guard
-- that refuses would make "delete my account" impossible for anyone who
-- solely owns an organizer. Account deletion has to win: the organizer is
-- left ownerless and an admin reassigns it, which is recoverable, whereas a
-- user who cannot leave is not.
--
-- The tell is that the user row is already gone by the time this fires: the
-- parent DELETE runs first, then the referential-integrity cascade.
-- SECURITY DEFINER because it reads auth.users, where an editor holds no
-- privilege at all. Without it the guard still "works" -- every removal is
-- refused -- but with "permission denied for schema auth", which is a
-- different refusal that would also refuse the cases we want to allow.
create or replace function public.organizer_members_keep_an_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;   -- the account itself is being deleted; let it go
  end if;

  if old.role = 'owner' and not exists (
    select 1 from public.organizer_members m
     where m.organizer_id = old.organizer_id
       and m.role = 'owner'
       and (m.user_id, m.organizer_id) <> (old.user_id, old.organizer_id)
  ) then
    raise exception 'organizer % would be left with no owner', old.organizer_id
      using errcode = 'NT001';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger t50_members_keep_an_owner
  after delete or update on public.organizer_members
  for each row execute function public.organizer_members_keep_an_owner();

-- ---------------------------------------------------------------------------
-- Ownerless organizers, for the admin queue.
--
-- The guard above deliberately lets account deletion leave an organizer with
-- no owner, on the grounds that it is recoverable. It is only recoverable if
-- somebody notices: otherwise the first sign is an editor who cannot edit,
-- months later. This belongs next to the pending events in your queue.
--
-- security_invoker = true, unlike the three public views: this one must obey
-- the caller's policies, so an admin sees every ownerless organizer and an
-- editor sees only their own. A definer view here would show every organizer
-- on the site to anyone signed in.
-- ---------------------------------------------------------------------------
create view public.organizers_without_owner
  with (security_invoker = true) as
  select o.id, o.name, o.slug, o.created_at
    from public.organizers o
   where not exists (
     select 1 from public.organizer_members m
      where m.organizer_id = o.id and m.role = 'owner'
   );

revoke all on public.organizers_without_owner from anon, authenticated;
grant select on public.organizers_without_owner to authenticated;

-- ===========================================================================
-- user_roles -- deliberately unreachable
--
-- No grants to anon or authenticated, so the only reader is is_admin(), which
-- runs as owner. Nobody can enumerate the admins, and there is no policy on
-- this table for is_admin() to recurse into. Roles are managed from the
-- dashboard or with service_role.
-- ===========================================================================

-- ===========================================================================
-- Moderation RPCs.
--
-- Since NOBODY holds UPDATE on events.status -- admins are `authenticated`
-- too, and column grants cannot tell an admin from an editor -- every status
-- change goes through one of these. That is the point: the set of legal
-- transitions is this file, not an emergent property of a policy.
-- ===========================================================================

create or replace function public.approve_event(p_event uuid, p_note text default null)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.events;
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  update public.events
     set status = 'approved',
         review_note = coalesce(p_note, review_note)
   where id = p_event
  returning * into result;

  if not found then
    raise exception 'no such event %', p_event using errcode = 'no_data_found';
  end if;
  return result;
end;
$$;

create or replace function public.reject_event(p_event uuid, p_note text)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.events;
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception 'a rejection needs a reason' using errcode = 'NT005';
  end if;

  update public.events
     set status = 'rejected', review_note = p_note
   where id = p_event
  returning * into result;

  if not found then
    raise exception 'no such event %', p_event using errcode = 'no_data_found';
  end if;
  return result;
end;
$$;

-- Clears the flag on an approved event you have looked at. Not a status
-- change, so the flagging trigger leaves it alone.
create or replace function public.mark_reviewed(p_event uuid)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.events;
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  update public.events set needs_review = false
   where id = p_event
  returning * into result;

  if not found then
    raise exception 'no such event %', p_event using errcode = 'no_data_found';
  end if;
  return result;
end;
$$;

-- ===========================================================================
-- Function privileges, swept.
--
-- Supabase's default privileges grant EXECUTE on every new function in
-- `public` to anon, authenticated and service_role. Left alone, that means
-- anon can CALL approve_event -- it would be turned away by the is_admin()
-- check inside, but that is one layer where this file claims two, and the
-- claim is the dangerous part.
--
-- Revoke from everyone, then hand back exactly the list that has to be
-- callable, and let supabase/tests/schema_tests.sql assert that list.
-- ===========================================================================
revoke execute on all functions in schema public from public, anon, authenticated;

-- Future functions, so a later migration cannot silently reopen this.
alter default privileges in schema public
  revoke execute on functions from anon, authenticated;

-- Policies evaluate these as the calling user, so authenticated needs them.
grant execute on function public.is_admin()            to authenticated;
grant execute on function public.is_member(uuid)       to authenticated;
grant execute on function public.is_owner(uuid)        to authenticated;
grant execute on function public.is_event_member(uuid) to authenticated;
grant execute on function public.uuid_or_null(text)    to authenticated;

-- Called from the INSERT trigger, which runs as the editor doing the insert.
grant execute on function public.slugify(text) to authenticated;

-- The moderation RPCs. Callable by any signed-in user; each refuses anyone
-- who is not an admin. That is now the SECOND line, not the only one.
grant execute on function public.approve_event(uuid, text) to authenticated;
grant execute on function public.reject_event(uuid, text)  to authenticated;
grant execute on function public.mark_reviewed(uuid)       to authenticated;

-- anon gets nothing: not a helper, not an RPC, not even one that would only
-- ever answer false.
