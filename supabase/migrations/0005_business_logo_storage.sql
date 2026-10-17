insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'business-logos',
  'business-logos',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view business logos" on storage.objects;
drop policy if exists "Business owners can upload their logo" on storage.objects;
drop policy if exists "Business owners can delete their logo" on storage.objects;

create policy "Public can view business logos"
on storage.objects for select
to public
using (bucket_id = 'business-logos');

create policy "Business owners can upload their logo"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'business-logos'
  and exists (
    select 1
    from public.businesses b
    where b.id::text = (storage.foldername(name))[1]
      and b.owner_id = (select auth.uid())
  )
);

create policy "Business owners can delete their logo"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'business-logos'
  and exists (
    select 1
    from public.businesses b
    where b.id::text = (storage.foldername(name))[1]
      and b.owner_id = (select auth.uid())
  )
);
