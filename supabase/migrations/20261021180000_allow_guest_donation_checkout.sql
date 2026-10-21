-- Permit safe pending donation intents for unauthenticated guest checkout.
-- Guest records cannot claim bank references or mark themselves paid; admin verification remains authoritative.
drop policy if exists "public can create pending guest donation intents" on public.donation_intents;
create policy "public can create pending guest donation intents"
on public.donation_intents
for insert
to anon
with check (
  donor_user_id is null
  and status = 'pending'
  and gateway_payment_id is null
  and utr is null
  and verified_at is null
  and admin_hidden = false
  and currency = 'INR'
  and amount_paise between 100 and 10000000
  and (donor_name is null or char_length(btrim(donor_name)) <= 80)
  and (donor_email is null or char_length(btrim(donor_email)) <= 254)
  and (message is null or char_length(message) <= 300)
  and (not is_anonymous or (donor_name is null and donor_email is null))
  and (not show_message_publicly or (not is_anonymous and show_on_leaderboard))
);
grant insert on public.donation_intents to anon;
