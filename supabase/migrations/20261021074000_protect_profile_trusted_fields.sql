-- Prevent authenticated users from editing trusted profile fields through
-- the existing "profiles update own" row-level policy.
-- The UI may update ordinary profile preferences, but points/account type remain
-- controlled by trusted backend/admin workflows.

create or replace function public.janwatch_protect_profile_trusted_fields()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
begin
  if auth.uid() is not null
     and new.id = auth.uid()
     and not public.is_janwatch_admin() then
    new.impact_points := old.impact_points;
    new.account_type := old.account_type;
  end if;

  return new;
end;
$function$;

drop trigger if exists janwatch_protect_profile_trusted_fields_trigger on public.profiles;
create trigger janwatch_protect_profile_trusted_fields_trigger
before update on public.profiles
for each row
execute function public.janwatch_protect_profile_trusted_fields();
