-- Serialize normalized cross-table UTR checks so concurrent writes cannot both
-- pass the existence check for the same reference.
create or replace function public.janwatch_guard_cross_table_utr_reuse()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_reference text;
begin
  if tg_table_name = 'donation_intents' then
    v_reference := nullif(lower(btrim(new.utr)), '');
    if v_reference is null then return new; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_reference, 0));

    if exists (
      select 1 from public.upi_gateway_payments p
      where nullif(lower(btrim(p.bank_reference_number)), '') = v_reference
        and p.order_id is distinct from new.order_id
    ) then
      raise exception 'This UTR is already linked to a different gateway payment order';
    end if;
  elsif tg_table_name = 'upi_gateway_payments' then
    v_reference := nullif(lower(btrim(new.bank_reference_number)), '');
    if v_reference is null then return new; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_reference, 0));

    if exists (
      select 1 from public.donation_intents d
      where nullif(lower(btrim(d.utr)), '') = v_reference
        and d.order_id is distinct from new.order_id
    ) then
      raise exception 'This bank reference is already linked to a different donation order';
    end if;
  end if;

  return new;
end;
$function$;
