-- LokPravaah public download centre + super-admin upload management.
-- Safe to run on the existing production project; uses IF NOT EXISTS and replaces only named policies.
begin;

create table if not exists public.download_files (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 140),
  description text,
  file_name text not null,
  storage_path text not null unique,
  file_size bigint not null check (file_size > 0 and file_size <= 524288000),
  version text,
  is_published boolean not null default false,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists download_files_published_created_idx
  on public.download_files (is_published, created_at desc);

create or replace function public.is_lokpravaah_download_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  );
$$;
revoke all on function public.is_lokpravaah_download_admin() from public;
grant execute on function public.is_lokpravaah_download_admin() to anon, authenticated;

alter table public.download_files enable row level security;
drop policy if exists "Public can read published downloads" on public.download_files;
create policy "Public can read published downloads" on public.download_files
  for select to anon, authenticated using (is_published = true or public.is_lokpravaah_download_admin());
drop policy if exists "Super admins manage downloads" on public.download_files;
create policy "Super admins manage downloads" on public.download_files
  for all to authenticated using (public.is_lokpravaah_download_admin())
  with check (public.is_lokpravaah_download_admin());
grant select on public.download_files to anon, authenticated;
grant insert, update, delete on public.download_files to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('app-downloads', 'app-downloads', true, 524288000, null)
on conflict (id) do update set public = true, file_size_limit = 524288000;

drop policy if exists "Public can download published app files" on storage.objects;
create policy "Public can download published app files" on storage.objects
  for select to anon, authenticated using (bucket_id = 'app-downloads');
drop policy if exists "Super admins upload app files" on storage.objects;
create policy "Super admins upload app files" on storage.objects
  for insert to authenticated with check (bucket_id = 'app-downloads' and public.is_lokpravaah_download_admin());
drop policy if exists "Super admins update app files" on storage.objects;
create policy "Super admins update app files" on storage.objects
  for update to authenticated using (bucket_id = 'app-downloads' and public.is_lokpravaah_download_admin())
  with check (bucket_id = 'app-downloads' and public.is_lokpravaah_download_admin());
drop policy if exists "Super admins delete app files" on storage.objects;
create policy "Super admins delete app files" on storage.objects
  for delete to authenticated using (bucket_id = 'app-downloads' and public.is_lokpravaah_download_admin());

commit;
