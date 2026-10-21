-- Prevent normalized bank references from being reused across the two payment tables.
-- Per-table unique indexes do not prevent a reference from being attached to one
-- donation_intents row and a different upi_gateway_payments order.
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

drop trigger if exists donation_intents_cross_table_utr_guard on public.donation_intents;
create trigger donation_intents_cross_table_utr_guard
before insert or update of utr, order_id on public.donation_intents
for each row execute function public.janwatch_guard_cross_table_utr_reuse();

drop trigger if exists upi_gateway_cross_table_utr_guard on public.upi_gateway_payments;
create trigger upi_gateway_cross_table_utr_guard
before insert or update of bank_reference_number, order_id on public.upi_gateway_payments
for each row execute function public.janwatch_guard_cross_table_utr_reuse();
