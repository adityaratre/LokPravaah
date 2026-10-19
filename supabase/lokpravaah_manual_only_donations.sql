-- Manual-only donation workflow: user history, ticket creation, and admin verification UX fix.
-- Keep the UPI QR/session creation endpoints available; stop notification-driven confirmation separately at the Worker.
begin;

-- Anonymous means hidden on public surfaces. Keep the owning account reference when one exists
-- so the donor can still see their own donation history and raise a support ticket.
create index if not exists donation_intents_user_history_idx
  on public.donation_intents(donor_user_id, created_at desc)
  where donor_user_id is not null;

create or replace function public.janwatch_get_my_donations()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_items jsonb;
begin
  if v_user is null then
    raise exception 'Sign in to view your donation history';
  end if;

  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', d.id,
      'order_id', d.order_id,
      'amount_paise', d.amount_paise,
      'currency', d.currency,
      'status', d.status,
      'donor_name', case when d.is_anonymous then null else d.donor_name end,
      'is_anonymous', d.is_anonymous,
      'record_source', d.record_source,
      'utr', d.utr,
      'created_at', d.created_at,
      'verified_at', d.verified_at,
      'claim_status', c.status,
      'claimed_utr', c.claimed_utr,
      'claimed_amount_paise', c.claimed_amount_paise,
      'payment_timestamp', c.payment_timestamp,
      'admin_review_note', c.admin_review_note,
      'reviewed_at', c.reviewed_at,
      'ticket_number', t.ticket_number,
      'ticket_status', t.status
    ) as item,
    d.created_at
    from public.donation_intents d
    left join lateral (
      select cl.status, cl.claimed_utr, cl.claimed_amount_paise, cl.payment_timestamp,
             cl.admin_review_note, cl.reviewed_at
      from public.donation_manual_review_claims cl
      where cl.donation_intent_id = d.id and cl.user_id = v_user
      order by cl.created_at desc
      limit 1
    ) c on true
    left join lateral (
      select st.ticket_number, st.status
      from public.support_tickets st
      where st.user_id = v_user and st.payment_order_id = d.order_id
      order by st.created_at desc
      limit 1
    ) t on true
    where d.donor_user_id = v_user
    order by d.created_at desc
    limit 100
  ) recent;

  return jsonb_build_object('donations', v_items, 'refreshed_at', now());
end;
$function$;
revoke all on function public.janwatch_get_my_donations() from public, anon;
grant execute on function public.janwatch_get_my_donations() to authenticated;

create or replace function public.janwatch_create_donation_support_ticket(
  p_donation_id uuid,
  p_subject text default null,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_donation public.donation_intents%rowtype;
  v_claim public.donation_manual_review_claims%rowtype;
  v_existing public.support_tickets%rowtype;
  v_ticket public.support_tickets%rowtype;
  v_subject text := left(btrim(coalesce(p_subject,'')), 120);
  v_description text := left(btrim(coalesce(p_description,'')), 5000);
  v_reference text;
  v_amount bigint;
begin
  if v_user is null then raise exception 'Sign in to raise a donation support ticket'; end if;
  if p_donation_id is null then raise exception 'Select a donation first'; end if;
  if char_length(v_subject) < 6 then raise exception 'Ticket subject must be at least 6 characters'; end if;
  if char_length(v_description) < 10 then raise exception 'Please describe the issue in at least 10 characters'; end if;

  select * into v_donation
  from public.donation_intents
  where id = p_donation_id and donor_user_id = v_user
  for share;
  if not found then raise exception 'Donation was not found in your account'; end if;

  select * into v_existing
  from public.support_tickets
  where user_id = v_user
    and payment_order_id = v_donation.order_id
    and status not in ('resolved','closed','rejected')
  order by created_at desc
  limit 1;
  if found then
    return jsonb_build_object(
      'status','existing',
      'ticket_id',v_existing.id,
      'ticket_number',v_existing.ticket_number,
      'ticket_status',v_existing.status,
      'message','There is already an open support ticket for this donation.'
    );
  end if;

  select * into v_claim
  from public.donation_manual_review_claims
  where donation_intent_id = v_donation.id and user_id = v_user
  order by created_at desc
  limit 1;

  v_reference := coalesce(v_donation.utr, v_claim.claimed_utr);
  v_amount := coalesce(v_claim.claimed_amount_paise, v_donation.amount_paise);

  insert into public.support_tickets(
    user_id, category, subcategory, subject, description, status, priority,
    payment_order_id, payment_reference, claimed_amount_paise, payment_timestamp
  ) values (
    v_user,
    'Donations & UPI',
    case
      when v_donation.status = 'succeeded' then 'Donation history / receipt'
      when v_claim.status = 'pending_review' then 'Payment pending manual review'
      when v_donation.status in ('failed','expired','cancelled') then 'Payment failed / session expired'
      else 'Paid but website not confirmed'
    end,
    v_subject,
    v_description || E'\n\nDonation reference: ' || v_donation.order_id ||
      E'\nDonation amount: ₹' || to_char(v_donation.amount_paise::numeric / 100, 'FM999999990.00') ||
      E'\nCurrent donation status: ' || v_donation.status ||
      case when v_reference is not null then E'\nClaimed / verified UTR: ' || v_reference else '' end,
    'open',
    'high',
    v_donation.order_id,
    v_reference,
    v_amount,
    coalesce(v_claim.payment_timestamp, v_donation.verified_at, v_donation.created_at)
  )
  returning * into v_ticket;

  insert into public.support_ticket_messages(ticket_id, sender_id, message, is_internal_note, attachments)
  values(v_ticket.id, v_user, v_description, false, '[]'::jsonb);

  insert into public.support_ticket_audit(ticket_id, actor_id, action, new_value)
  values(v_ticket.id, v_user, 'donation_support_ticket_created',
         jsonb_build_object('donation_id',v_donation.id,'order_id',v_donation.order_id,'status',v_donation.status));

  return jsonb_build_object(
    'status','created',
    'ticket_id',v_ticket.id,
    'ticket_number',v_ticket.ticket_number,
    'ticket_status',v_ticket.status,
    'message','Donation support ticket created. You can follow replies and status from Support tickets.'
  );
end;
$function$;
revoke all on function public.janwatch_create_donation_support_ticket(uuid,text,text) from public, anon;
grant execute on function public.janwatch_create_donation_support_ticket(uuid,text,text) to authenticated;

-- "DONE" is a valid, common review note. Keep minimums low enough to not block an otherwise valid approval.
create or replace function public.janwatch_admin_manual_verify_donation(
  p_donation_id uuid, p_utr text, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_role text;
  v_donation public.donation_intents%rowtype;
  v_gateway public.upi_gateway_payments%rowtype;
  v_utr text := nullif(btrim(p_utr),'');
  v_note text := nullif(btrim(p_note),'');
  v_previous_status text;
begin
  select role into v_role from public.user_roles where user_id = auth.uid() limit 1;
  if auth.uid() is null or coalesce(v_role,'') not in ('admin','super_admin') then
    raise exception 'Administrator permission required';
  end if;
  if v_utr is null or v_utr !~ '^[A-Za-z0-9_-]{6,80}$' then
    raise exception 'A real UTR/bank reference (6-80 characters) is required';
  end if;
  if v_note is null or char_length(v_note) not between 3 and 500 then
    raise exception 'Add a review note between 3 and 500 characters';
  end if;

  select * into v_donation from public.donation_intents where id = p_donation_id for update;
  if not found then raise exception 'Donation record not found'; end if;
  if v_donation.status = 'succeeded' then
    if v_donation.utr = v_utr then
      return jsonb_build_object('status','succeeded','alreadyVerified',true,'message','This donation was already verified with the same UTR.');
    end if;
    raise exception 'Donation is already verified with a different UTR';
  end if;
  if v_donation.status not in ('pending','failed','suspicious','expired','cancelled') then
    raise exception 'Donation state is not eligible for manual verification';
  end if;
  if exists (select 1 from public.donation_intents d where d.utr = v_utr and d.id <> p_donation_id) then
    raise exception 'This UTR is already linked to another donation';
  end if;
  if exists (select 1 from public.upi_gateway_payments p where p.bank_reference_number = v_utr and p.order_id <> v_donation.order_id) then
    raise exception 'This bank reference is linked to another payment order';
  end if;

  select * into v_gateway from public.upi_gateway_payments where order_id = v_donation.order_id for update;
  if found and v_gateway.status = 'SUCCESS' and v_gateway.bank_reference_number is distinct from v_utr then
    raise exception 'Gateway already records a different successful bank reference for this order';
  end if;

  v_previous_status := v_donation.status;
  update public.donation_intents
  set status = 'succeeded',
      utr = v_utr,
      verified_at = coalesce(verified_at, now()),
      updated_at = now(),
      gateway_payment_id = coalesce(gateway_payment_id, v_gateway.id::text)
  where id = p_donation_id;

  insert into public.donation_manual_reviews(donation_id, reviewed_by, order_id, amount_paise, utr, review_note, prior_status)
  values(p_donation_id, auth.uid(), v_donation.order_id, v_donation.amount_paise, v_utr, v_note, v_previous_status);

  -- Keep old checkout attempt information for reconciliation. This is an administrative status
  -- sync only; it does not depend on the Android observer and never sends money.
  update public.upi_gateway_payments
  set status = 'SUCCESS', queue_position = 0, bank_reference_number = v_utr,
      completed_at = coalesce(completed_at, now()), observed_at = coalesce(observed_at, now()), updated_at = now()
  where order_id = v_donation.order_id
    and status in ('ACTIVE','PROCESSING','FAILED','EXPIRED','CANCELLED','SUSPICIOUS');

  if v_gateway.id is not null then
    update public.upi_gateway_observations
    set status = 'SUCCESS', matched_payment_id = v_gateway.id
    where bank_reference_number = v_utr and status in ('UNMATCHED','PROCESSING');
  end if;

  insert into public.audit_logs(actor_id, action, target_type, target_id, metadata)
  values(auth.uid(), 'donation_manually_verified', 'donation', p_donation_id::text,
    jsonb_build_object('order_id',v_donation.order_id,'amount_paise',v_donation.amount_paise,'utr',v_utr,
      'prior_status',v_previous_status,'review_note',v_note));

  return jsonb_build_object('status','succeeded','alreadyVerified',false,'message','Donation manually verified. UTR and review note were saved to the private audit trail.');
end;
$function$;
revoke all on function public.janwatch_admin_manual_verify_donation(uuid,text,text) from public, anon;
grant execute on function public.janwatch_admin_manual_verify_donation(uuid,text,text) to authenticated;

create or replace function public.janwatch_admin_review_manual_donation(
  p_claim_id uuid, p_action text, p_note text default null, p_verified_utr text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_role text;
  v_claim public.donation_manual_review_claims%rowtype;
  v_donation public.donation_intents%rowtype;
  v_utr text := nullif(btrim(p_verified_utr),'');
  v_note text := nullif(btrim(p_note),'');
  v_result jsonb;
begin
  select role into v_role from public.user_roles where user_id = auth.uid() limit 1;
  if auth.uid() is null or coalesce(v_role,'') not in ('admin','super_admin') then raise exception 'Administrator permission required'; end if;
  if p_action not in ('confirm','reject') then raise exception 'Action must be confirm or reject'; end if;
  if v_note is null or char_length(v_note) not between 3 and 1000 then raise exception 'Add a review note between 3 and 1000 characters'; end if;

  select * into v_claim from public.donation_manual_review_claims where id = p_claim_id for update;
  if not found then raise exception 'Manual review claim not found'; end if;
  if v_claim.status <> 'pending_review' then raise exception 'This claim has already been reviewed'; end if;
  select * into v_donation from public.donation_intents where id = v_claim.donation_intent_id for update;
  if not found then raise exception 'Donation record not found'; end if;

  if p_action = 'confirm' then
    if v_utr is null or v_utr !~ '^[A-Za-z0-9_-]{6,80}$' then
      raise exception 'Enter the actual bank UTR after checking the receiving-bank statement';
    end if;
    v_result := public.janwatch_admin_manual_verify_donation(v_donation.id, v_utr, left(v_note,500));
    update public.donation_manual_review_claims set status = 'confirmed', claimed_utr = v_utr,
      admin_review_note = left(v_note,1000), reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where id = p_claim_id;
    insert into public.donation_admin_review_audit(donation_intent_id,claim_id,actor_id,action,details)
    values(v_donation.id,p_claim_id,auth.uid(),'manual_donation_confirmed',jsonb_build_object('utr',v_utr,'note',v_note));
    return jsonb_build_object('status','confirmed','message','Donation verified after the UTR was checked against the receiving-bank record.','verification',v_result);
  end if;

  update public.donation_manual_review_claims set status = 'rejected',
    admin_review_note = left(v_note,1000), reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = p_claim_id;
  insert into public.donation_admin_review_audit(donation_intent_id,claim_id,actor_id,action,details)
  values(v_donation.id,p_claim_id,auth.uid(),'manual_donation_claim_rejected',jsonb_build_object('note',v_note));
  return jsonb_build_object('status','rejected','message','Payment claim rejected. The donation remains unverified.');
end;
$function$;
revoke all on function public.janwatch_admin_review_manual_donation(uuid,text,text,text) from public, anon;
grant execute on function public.janwatch_admin_review_manual_donation(uuid,text,text,text) to authenticated;

commit;