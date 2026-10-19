-- Disable paired Android notification observers for manual-only donation processing.
-- Do not delete payment, pairing, or observation audit records: retained data is useful for reconciliation.
begin;

update public.upi_gateway_devices
set is_active = false
where is_active = true;

update public.upi_gateway_pairing_tokens
set used_at = coalesce(used_at, now())
where used_at is null;

commit;