-- LokPravaah role visibility + chat badge repair.
-- Run in Supabase SQL Editor after the base platform schema is installed.
-- This does NOT grant roles. It only lets a signed-in user read their own assigned role,
-- exposes a narrow role-check RPC, and refreshes chat badges from the database's role table.

create or replace function public.janwatch_current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select ur.role
  from public.user_roles ur
  where ur.user_id = auth.uid()
  limit 1
$$;

revoke all on function public.janwatch_current_user_role() from public, anon;
grant execute on function public.janwatch_current_user_role() to authenticated;

alter table public.user_roles enable row level security;
drop policy if exists "lokpravaah_read_own_role" on public.user_roles;
create policy "lokpravaah_read_own_role"
on public.user_roles
for select to authenticated
using (user_id = auth.uid() or public.is_janwatch_super_admin());
grant select on public.user_roles to authenticated;

alter table public.community_messages
  add column if not exists author_role text not null default 'member';

create or replace function public.janwatch_set_message_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_role text;
begin
  select coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1), 'Citizen')
    into v_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = new.user_id;

  new.author_name := coalesce(nullif(btrim(v_name), ''), 'Citizen');
  select case
    when exists (select 1 from public.user_roles ur where ur.user_id = new.user_id and ur.role = 'super_admin') then 'super_admin'
    when exists (select 1 from public.user_roles ur where ur.user_id = new.user_id and ur.role = 'admin') then 'admin'
    when exists (select 1 from public.user_roles ur where ur.user_id = new.user_id and ur.role = 'moderator') then 'moderator'
    else 'member'
  end into v_role;
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

create or replace function public.janwatch_refresh_chat_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
  else
    v_user_id := new.user_id;
  end if;

  if v_user_id is not null then
    update public.community_messages cm
    set author_role = case
      when exists (select 1 from public.user_roles ur where ur.user_id = v_user_id and ur.role = 'super_admin') then 'super_admin'
      when exists (select 1 from public.user_roles ur where ur.user_id = v_user_id and ur.role = 'admin') then 'admin'
      when exists (select 1 from public.user_roles ur where ur.user_id = v_user_id and ur.role = 'moderator') then 'moderator'
      else 'member'
    end
    where cm.user_id = v_user_id;
  end if;
  return null;
end;
$$;

drop trigger if exists janwatch_refresh_chat_roles_trigger on public.user_roles;
create trigger janwatch_refresh_chat_roles_trigger
after insert or update or delete on public.user_roles
for each row execute function public.janwatch_refresh_chat_roles();

-- Backfill existing messages so previously posted messages show the current database role.
update public.community_messages cm
set author_role = case
  when exists (select 1 from public.user_roles ur where ur.user_id = cm.user_id and ur.role = 'super_admin') then 'super_admin'
  when exists (select 1 from public.user_roles ur where ur.user_id = cm.user_id and ur.role = 'admin') then 'admin'
  when exists (select 1 from public.user_roles ur where ur.user_id = cm.user_id and ur.role = 'moderator') then 'moderator'
  else 'member'
end;

notify pgrst, 'reload schema';
