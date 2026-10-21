-- Ensure every submitted payment-proof path refers to an existing private object
-- owned by the authenticated donor. This also protects against stale/fabricated
-- paths passed directly to the SECURITY DEFINER submission RPC.
create or replace function public.janwatch_validate_donation_evidence_objects()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, storage, pg_temp
as $function$
declare
  v_path text;
begin
  if tg_op = 'UPDATE'
     and new.screenshot_path is not distinct from old.screenshot_path
     and new.evidence_paths is not distinct from old.evidence_paths
     and new.user_id is not distinct from old.user_id then
    return new;
  end if;

  if new.user_id is null then
    raise exception 'Payment evidence must belong to a signed-in donor';
  end if;

  for v_path in
    select distinct path
    from unnest(
      coalesce(
        nullif(new.evidence_paths, '{}'::text[]),
        array[new.screenshot_path]::text[]
      )
    ) as evidence(path)
  loop
    if v_path is null
       or left(v_path, char_length(new.user_id::text || '/')) <> new.user_id::text || '/'
       or not exists (
         select 1
         from storage.objects o
         where o.bucket_id = 'donation-payment-evidence'
           and o.name = v_path
           and o.owner = new.user_id
       ) then
      raise exception 'Payment evidence file is missing or is not owned by this donor';
    end if;
  end loop;

  return new;
end;
$function$;

drop trigger if exists donation_manual_review_evidence_objects_guard
  on public.donation_manual_review_claims;

create trigger donation_manual_review_evidence_objects_guard
before insert or update of screenshot_path, evidence_paths, user_id
on public.donation_manual_review_claims
for each row
execute function public.janwatch_validate_donation_evidence_objects();
