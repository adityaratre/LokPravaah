-- LokPravaah Blog & Updates (safe to run more than once after v4_platform_migration.sql)
-- Only super_admin accounts can create, edit, publish, or delete posts.

-- Add the AI switch to the existing flag constraint (the table predates this feature).
alter table public.app_feature_flags drop constraint if exists app_feature_flags_flag_key_check;
alter table public.app_feature_flags add constraint app_feature_flags_flag_key_check
  check (flag_key in ('reporting','public_chat','rewards','civic_toolkit','evidence_upload','community_support','janwatch_ai'));
insert into public.app_feature_flags(flag_key, enabled, label, description)
values ('janwatch_ai', true, 'LokPravaah AI assistant', 'Allow signed-in citizens to use the multi-provider AI assistant. Provider keys remain server-side.')
on conflict (flag_key) do nothing;

create table if not exists public.site_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (char_length(slug) between 1 and 160),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  excerpt text not null default '' check (char_length(excerpt) <= 500),
  body text not null check (char_length(btrim(body)) between 10 and 20000),
  post_type text not null default 'blog' check (post_type in ('blog','app_update','feature_update')),
  link_url text,
  is_published boolean not null default false,
  author_id uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_posts_link_https_check check (link_url is null or link_url ~* '^https://')
);
create index if not exists site_posts_public_idx on public.site_posts(is_published, published_at desc) where is_published = true;
create index if not exists site_posts_created_idx on public.site_posts(created_at desc);
alter table public.site_posts enable row level security;

drop policy if exists "site posts public read published" on public.site_posts;
create policy "site posts public read published" on public.site_posts
  for select to anon, authenticated
  using (is_published = true or public.is_janwatch_super_admin());

drop policy if exists "site posts super admin insert" on public.site_posts;
create policy "site posts super admin insert" on public.site_posts
  for insert to authenticated
  with check (public.is_janwatch_super_admin() and author_id = auth.uid());

drop policy if exists "site posts super admin update" on public.site_posts;
create policy "site posts super admin update" on public.site_posts
  for update to authenticated
  using (public.is_janwatch_super_admin())
  with check (public.is_janwatch_super_admin());

drop policy if exists "site posts super admin delete" on public.site_posts;
create policy "site posts super admin delete" on public.site_posts
  for delete to authenticated
  using (public.is_janwatch_super_admin());

-- Author role tags are server-stamped by the database trigger, not trusted from the browser.
alter table public.community_messages add column if not exists author_role text not null default 'member';

create or replace function public.janwatch_set_message_author()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_name text; v_role text;
begin
  select coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1), 'Citizen')
    into v_name
  from auth.users u left join public.profiles p on p.id = u.id
  where u.id = new.user_id;
  new.author_name := coalesce(nullif(btrim(v_name), ''), 'Citizen');
  select case
      when exists (select 1 from public.user_roles ur where ur.user_id = new.user_id and ur.role = 'super_admin') then 'super_admin'
      when exists (select 1 from public.user_roles ur where ur.user_id = new.user_id and ur.role = 'admin') then 'admin'
      when exists (select 1 from public.user_roles ur where ur.user_id = new.user_id and ur.role = 'moderator') then 'moderator'
      else 'member' end
    into v_role;
  new.author_role := coalesce(v_role, 'member');
  new.body := btrim(new.body);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists janwatch_set_message_author_trigger on public.community_messages;
create trigger janwatch_set_message_author_trigger
  before insert or update of body, user_id, author_role on public.community_messages
  for each row execute function public.janwatch_set_message_author();

update public.community_messages cm
set author_role = case
  when exists (select 1 from public.user_roles ur where ur.user_id = cm.user_id and ur.role = 'super_admin') then 'super_admin'
  when exists (select 1 from public.user_roles ur where ur.user_id = cm.user_id and ur.role = 'admin') then 'admin'
  when exists (select 1 from public.user_roles ur where ur.user_id = cm.user_id and ur.role = 'moderator') then 'moderator'
  else 'member' end;

-- Ensure the PostgREST API roles can access the table; RLS above limits which rows/actions succeed.
grant select on public.site_posts to anon, authenticated;
grant insert, update, delete on public.site_posts to authenticated;



-- Stable self-role endpoint keeps navigation and the admin entry independent of report queries.
create or replace function public.janwatch_current_user_role()
returns text language sql stable security definer set search_path = public
as $$
  select ur.role from public.user_roles ur where ur.user_id = auth.uid() limit 1
$$;
revoke all on function public.janwatch_current_user_role() from public, anon;
grant execute on function public.janwatch_current_user_role() to authenticated;

-- Allow accounts to read only their own role; super admins can inspect assignments.
alter table public.user_roles enable row level security;
drop policy if exists "user roles read own or super admin" on public.user_roles;
create policy "user roles read own or super admin" on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.is_janwatch_super_admin());
grant select on public.user_roles to authenticated;

-- Keep already-posted messages' public badges in sync when a moderator/admin role changes.
create or replace function public.janwatch_refresh_chat_roles()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_user_id uuid;
begin
  if TG_OP = 'DELETE' then
    v_user_id := OLD.user_id;
  else
    v_user_id := NEW.user_id;
  end if;
  if v_user_id is not null then
    update public.community_messages
    set author_role = case
      when exists (select 1 from public.user_roles ur where ur.user_id = v_user_id and ur.role = 'super_admin') then 'super_admin'
      when exists (select 1 from public.user_roles ur where ur.user_id = v_user_id and ur.role = 'admin') then 'admin'
      when exists (select 1 from public.user_roles ur where ur.user_id = v_user_id and ur.role = 'moderator') then 'moderator'
      else 'member' end
    where user_id = v_user_id;
  end if;
  return null; -- AFTER trigger return values are ignored.
end;
$$;
drop trigger if exists janwatch_refresh_chat_roles_trigger on public.user_roles;
create trigger janwatch_refresh_chat_roles_trigger
  after insert or update or delete on public.user_roles
  for each row execute function public.janwatch_refresh_chat_roles();

notify pgrst, 'reload schema';
