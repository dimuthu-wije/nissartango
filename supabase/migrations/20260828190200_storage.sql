-- ============================================================================
-- 20260828190200_storage.sql
--
-- Storage policies are a SEPARATE system from table RLS and are the easiest
-- thing in a Supabase project to leave wide open: a bucket marked public is
-- readable by anyone who can guess a path, forever, with no policy involved.
--
-- This bucket is PRIVATE, and reads are granted by an explicit policy on
-- storage.objects. The build downloads images with the anon key at build time
-- and Astro serves the optimized copies from Cloudflare, so nothing on the
-- public site ever points at supabase.co.
--
-- Path convention, enforced by the policies below:
--     event-images/<organizer_id>/<event_id>/<filename>
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-images', 'event-images', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do nothing;

-- Read: anyone, but only inside this bucket. This is what the build uses.
create policy "event images are readable"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'event-images');

-- Write: only into your own organizer's folder. uuid_or_null() means a
-- malformed path fails to match instead of raising -- a policy that errors is
-- a policy that can be probed.
create policy "editors write their own organizer folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'event-images'
    and public.is_member(public.uuid_or_null((storage.foldername(name))[1]))
  );

create policy "editors update their own organizer folder"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'event-images'
    and public.is_member(public.uuid_or_null((storage.foldername(name))[1]))
  )
  with check (
    bucket_id = 'event-images'
    and public.is_member(public.uuid_or_null((storage.foldername(name))[1]))
  );

create policy "editors delete their own organizer folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'event-images'
    and public.is_member(public.uuid_or_null((storage.foldername(name))[1]))
  );

-- Note there is no policy granting anon anything on storage.buckets, and none
-- on any other bucket. A second bucket added later starts closed.
