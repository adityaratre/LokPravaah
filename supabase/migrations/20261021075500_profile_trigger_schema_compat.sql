-- Keep the trusted-profile protection compatible with installations that have
-- not yet applied the optional V4 profile extension adding account_type.
create or replace function public.janwatch_protect_profile_trusted_fields()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  old_row jsonb := to_jsonb(old);
begin
  if auth.uid() is not null
     and new.id = auth.uid()
     and not public.is_janwatch_admin() then
    -- impact_points exists in the base schema.
    new.impact_points := old.impact_points;

    -- account_type is added by the optional V4 platform migration. Use the row's
    -- JSON representation so this trigger also works before that column exists.
    if old_row ? 'account_type' then
      new := jsonb_populate_record(new, jsonb_build_object('account_type', old_row->'account_type'));
    end if;
  end if;

  return new;
end;
$function$;
