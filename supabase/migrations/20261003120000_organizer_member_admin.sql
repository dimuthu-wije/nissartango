-- ============================================================================
-- 20261003120000_organizer_member_admin.sql
--
-- Let an organizer's owner add and see its members, from the editor.
--
-- WHAT THIS REPLACES. Onboarding one organizer cost three SQL statements and a
-- lookup: they sign in (which is the only way an auth.users row appears), you
-- find their uid by email in the dashboard, you insert the organizers row, you
-- insert the organizer_members row. The event form has worked the whole time --
-- a member creates a `pending` event and the queue publishes it. The bottleneck
-- was never the form; it was becoming a member.
--
-- EVERYTHING EXCEPT THE EMAIL LOOKUP ALREADY WORKED. `authenticated` has had
-- select/insert/update/delete on organizer_members since 20260828190100, with
-- members_owner_write restricting writes to an owner of that organizer. The one
-- missing piece is resolving an email to a uid: auth.users is unreachable from
-- PostgREST, and organizer_members.user_id references it. Hence two SECURITY
-- DEFINER functions and no new table, no new grant, no new policy.
--
-- REMOVAL GETS NO FUNCTION. An owner can already DELETE through the existing
-- policy once they have the uid, and the listing below gives them the uid. Less
-- surface is worth more than symmetry. t50_members_keep_an_owner still refuses
-- to leave an organizer ownerless.
--
-- THE HONEST COST: add_organizer_member is an oracle. Calling it tells the
-- caller whether an email has an account here, and that cannot be hidden
-- without also hiding the one thing the caller needs to be told -- "ask them to
-- sign in once first". It is bounded rather than removed: only an owner of the
-- organizer being changed, or an admin, may call it, and nobody becomes an
-- owner except by this same path or by your hand. A public signup flow would
-- change that calculus and should re-read this comment.
--
-- NO INVITE FOR SOMEBODY WHO HAS NEVER SIGNED IN, deliberately (decided
-- 2026-10-03). It would mean a table of pending invites keyed on an email, a
-- trigger on auth.users to apply them, and a second path into membership that
-- has to agree with this one. The flow for the next few organizers is: tell
-- them to sign in once, then add them.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Who belongs to this organizer, with their email.
--
-- members_select already lets any member read the rows; this exists only
-- because the rows carry a uuid and a person needs an email. SECURITY DEFINER
-- for the join to auth.users, and therefore it re-checks authorisation itself:
-- a definer function runs as its owner and RLS does not apply to it.
-- ---------------------------------------------------------------------------
create or replace function public.organizer_member_emails(p_organizer uuid)
returns table (user_id uuid, email text, role public.member_role, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_owner(p_organizer) or public.is_admin()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return query
    select m.user_id, u.email::text, m.role, m.created_at
      from public.organizer_members m
      join auth.users u on u.id = m.user_id
     where m.organizer_id = p_organizer
     order by m.role, u.email;
end;
$$;

comment on function public.organizer_member_emails(uuid) is
  'Members of one organizer with their email addresses. Owner or admin only.';

-- ---------------------------------------------------------------------------
-- Add somebody, by the only identifier a human has: their email.
--
-- IDEMPOTENT, and that is also how a role is changed: calling it again for an
-- existing member sets the role rather than failing. "Add them again to promote
-- them" is a reasonable thing to try and there is no reason to punish it.
-- ---------------------------------------------------------------------------
create or replace function public.add_organizer_member(
  p_organizer uuid,
  p_email     text,
  p_role      public.member_role default 'editor'
)
returns public.organizer_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
  result public.organizer_members;
begin
  if not (public.is_owner(p_organizer) or public.is_admin()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- Case-insensitively and trimmed: an email typed by a person has neither
  -- property guaranteed, and auth.users stores what GoTrue was given.
  select u.id into target
    from auth.users u
   where lower(u.email) = lower(btrim(p_email))
   limit 1;

  if target is null then
    -- A distinct code, because this is the ONE failure the person on the other
    -- end can fix, and the editor has to be able to say how.
    raise exception 'no account for %', p_email using errcode = 'NT006';
  end if;

  insert into public.organizer_members (organizer_id, user_id, role)
  values (p_organizer, target, p_role)
      on conflict (organizer_id, user_id) do update set role = excluded.role
  returning * into result;

  return result;
end;
$$;

comment on function public.add_organizer_member(uuid, text, public.member_role) is
  'Add a member by email, or change their role. Owner or admin only. '
  'Raises NT006 when no account exists for that address -- they must sign in '
  'to the editor once before they can be added.';

-- Neither is granted to anon. An editor-role member cannot call them either;
-- the functions check is_owner/is_admin themselves, but the grant is the outer
-- boundary and `authenticated` is as narrow as it goes while still being
-- callable from the editor at all.
grant execute on function public.organizer_member_emails(uuid) to authenticated;
grant execute on function public.add_organizer_member(uuid, text, public.member_role) to authenticated;

notify pgrst, 'reload schema';
