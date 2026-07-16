-- ============================================================================
-- Profile avatars — cloud profile photos via Supabase Storage.
-- From the user-profile feature (2026-07-16).
--
-- The photo file lives in a public Storage bucket at avatars/<user_id>/avatar.jpg
-- (public read so an <img> can show it without a token; writes are locked to the
-- owner). The photo's URL is saved on the user's profile row.
-- ============================================================================

-- 1) Where we remember each user's photo URL (null = no photo).
alter table public.profiles add column if not exists avatar_url text;

-- 2) The bucket. public=true means anyone with the URL can VIEW the image
--    (avatars aren't secret); uploading/replacing/deleting is gated below.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 3) Storage access rules on the objects in that bucket.
--    Read: anyone (public avatars). Write/replace/delete: only the owner, and
--    only inside their own folder avatars/<their-user-id>/...
--    (storage.foldername(name))[1] is the first path segment (the user id).
drop policy if exists "avatars public read"  on storage.objects;
create policy "avatars public read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars owner insert" on storage.objects;
create policy "avatars owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
