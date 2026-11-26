-- Run after the Laii Agenda tables and Neon roles have been provisioned.
begin;

create table if not exists public.business_logos (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  filename text not null check (filename ~ '^[0-9a-f-]{36}\.(png|jpg|webp|gif|pdf)$'),
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf')),
  contents bytea not null check (octet_length(contents) between 1 and 5242880)
);

alter table public.business_logos enable row level security;

create policy business_logos_owner on public.business_logos
  for all to authenticated
  using (business_id in (select id from public.businesses where owner_id = (select laii_private.user_id())))
  with check (business_id in (select id from public.businesses where owner_id = (select laii_private.user_id())));

revoke all on public.business_logos from public, anonymous;
grant select, insert, update, delete on public.business_logos to authenticated;
grant select on public.business_logos to service_role;

commit;
