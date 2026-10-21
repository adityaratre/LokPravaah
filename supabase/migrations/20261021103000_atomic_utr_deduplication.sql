-- Make bank reference uniqueness atomic under concurrent manual-review approvals.
-- The admin RPCs already check for duplicate UTRs, but check-then-write alone races.
create unique index if not exists donation_intents_utr_unique_normalized
  on public.donation_intents (lower(btrim(utr)))
  where utr is not null and btrim(utr) <> '';

create unique index if not exists upi_gateway_payments_bank_reference_unique_normalized
  on public.upi_gateway_payments (lower(btrim(bank_reference_number)))
  where bank_reference_number is not null and btrim(bank_reference_number) <> '';
