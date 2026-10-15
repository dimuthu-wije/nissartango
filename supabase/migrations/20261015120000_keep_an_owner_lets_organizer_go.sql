-- The last-owner guard lets a deleted ORGANIZER go, as it already does an account.
--
-- WHAT WAS WRONG. `organizer_members_keep_an_owner` (20260828190100) refuses to
-- remove the last `owner` of an organizer, which is right. It carries one
-- deliberate escape hatch, for account deletion:
--
--     if tg_op = 'DELETE'
--        and not exists (select 1 from auth.users u where u.id = old.user_id)
--     then return old; end if;
--
-- There is no matching hatch for the organizer. So deleting an organizer --
-- whose memberships cascade by design -- raised NT001 and refused, because the
-- owner's account was still there and the guard saw an owner leaving with no
-- replacement. The CASCADE on organizer_members.organizer_id existed precisely
-- to make that deletion work, and the guard was quietly cancelling it.
--
-- Measured on dev 2026-10-15, in a transaction rolled back afterwards:
--
--     without this change   delete events, then organizer  -> ERROR NT001
--     with it               delete events, then organizer  -> DELETE 3, DELETE 1
--     either way            delete a membership on its own -> ERROR NT001
--
-- The third line is the point. The guard still does its job; it just stops
-- firing when there is no longer an organizer to be left ownerless.
--
-- WHY THE TEST WORKS, and it is the same tell the original comment names for
-- accounts: the parent DELETE runs first, then the referential-integrity
-- cascade, so by the time this AFTER trigger fires the organizers row is
-- already gone. Asking whether it still exists is therefore asking "am I being
-- cascaded from the parent, or removed on my own" -- which is exactly the
-- distinction that matters here, and the only one that distinguishes them.
--
-- NOT A NEW POLICY. Deleting an organizer was already SQL-only and
-- postgres-only: `authenticated` holds SELECT and a column-level UPDATE, no
-- DELETE and no INSERT. Nothing here widens who may do it. It only stops the
-- guard from refusing a deletion the schema was built to allow, which until
-- today had to be worked around by disabling the trigger by hand -- a habit
-- that ends with somebody leaving it disabled.
--
-- The RESTRICT on events.organizer_id is untouched and still bites first: an
-- organizer with events cannot be deleted at all, which is why the measurement
-- above deletes the events first.

create or replace function public.organizer_members_keep_an_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The account itself is being deleted; let it go. Account deletion has to
  -- win: the organizer is left ownerless and an admin reassigns it, which is
  -- recoverable, whereas a user who cannot leave is not. (20260828190100)
  if tg_op = 'DELETE'
     and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;

  -- The organizer itself is being deleted; let it go. Same tell as above --
  -- the parent row is already gone when an AFTER trigger fires on a cascaded
  -- child -- and the same reasoning: there is no ownerless organizer to
  -- protect once there is no organizer.
  if tg_op = 'DELETE'
     and not exists (select 1 from public.organizers o where o.id = old.organizer_id) then
    return old;
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

-- The trigger itself is unchanged and is NOT recreated: `create or replace
-- function` keeps the existing t50_members_keep_an_owner pointing at the new
-- body. Dropping and recreating it would be a window, however short, in which
-- the guard does not exist.
