-- Unify donor payment-proof submission with the admin manual-review queue.
-- The prior submit RPC wrote donation_payment_claims, while the admin panel reads
-- donation_manual_review_claims. Keep one canonical review queue and preserve all files.
begin;

alter table public.donation_manual_review_claims
  add column if not exists evidence_paths text[] not null default '{}'::text[];

create or replace function public.janwatch_submit_donation_payment_claim(
  p_order_id text,
  p_amount_paise bigint,
  p_reference text,
  p_note text,
  p_evidence_paths text[]
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
  v_ref text := nullif(btrim(p_reference),'');
  v_note text := nullif(btrim(p_note),'');
  v_paths text[] := coalesce(p_evidence_paths,'{}'::text[]);
  v_existing boolean := false;
begin
  if v_user is null then raise exception 'Please sign in to submit payment evidence'; end if;
  if p_order_id is null or char_length(btrim(p_order_id)) not between 8 and 80 then
    raise exception 'Enter the donation order ID';
  end if;
  if p_amount_paise is null or p_amount_paise < 100 or p_amount_paise > 10000000 then
    raise exception 'Invalid amount';
  end if;
  if v_note is null or char_length(v_note) not between 10 and 1000 then
    raise exception 'Explain the payment issue in 10-1000 characters';
  end if;
  if v_ref is not null and v_ref !~ '^[A-Za-z0-9_-]{6,80}$' then
    raise exception 'UPI / bank reference must contain 6-80 letters, numbers, underscore or hyphen';
  end if;
  if cardinality(v_paths) < 1 or cardinality(v_paths) > 4 then
    raise exception 'Upload 1-4 payment screenshots or PDF files';
  end if;
  if exists (
    select 1 from unnest(v_paths) as evidence(path)
    where evidence.path is null
       or evidence.path !~ ('^' || v_user::text || '/[A-Za-z0-9._/-]{1,250}$')
       or evidence.path like '%..%'
       or left(evidence.path, char_length(v_user::text || '/' || btrim(p_order_id) || '/'))
          <> v_user::text || '/' || btrim(p_order_id) || '/'
  ) then
    raise exception 'An evidence file path is invalid or does not belong to this donation order';
  end if;

  select * into v_donation
  from public.donation_intents
  where order_id = btrim(p_order_id)
  for update;
  if not found then raise exception 'Donation order not found. Check the order ID from the checkout'; end if;
  if v_donation.amount_paise <> p_amount_paise then raise exception 'Amount does not match this donation order'; end if;
  if v_donation.donor_user_id is not null and v_donation.donor_user_id <> v_user then
    raise exception 'This donation order belongs to a different account';
  end if;
  if v_donation.status = 'succeeded' then
    raise exception 'This donation is already confirmed. Contact support if the confirmation is incorrect';
  end if;
  if v_donation.status not in ('pending','failed','suspicious','expired','cancelled') then
    raise exception 'This donation state cannot be submitted for manual review';
  end if;

  select * into v_claim
  from public.donation_manual_review_claims
  where donation_intent_id = v_donation.id
  for update;
  v_existing := found;

  if v_existing then
    if v_claim.user_id <> v_user then
      raise exception 'A payment claim already exists for this donation under another account';
    end if;
    if v_claim.status = 'confirmed' then
      raise exception 'This payment claim was already confirmed';
    end if;

    update public.donation_manual_review_claims
    set screenshot_path = v_paths[1],
        evidence_paths = v_paths,
        claimed_utr = coalesce(v_ref, claimed_utr),
        claimed_amount_paise = p_amount_paise,
        user_note = v_note,
        status = 'pending_review',
        admin_review_note = null,
        reviewed_by = null,
        reviewed_at = null,
        updated_at = now()
    where id = v_claim.id
    returning * into v_claim;
  else
    insert into public.donation_manual_review_claims(
      donation_intent_id,user_id,screenshot_path,evidence_paths,claimed_utr,
      claimed_amount_paise,user_note,status
    ) values (
      v_donation.id,v_user,v_paths[1],v_paths,v_ref,p_amount_paise,v_note,'pending_review'
    ) returning * into v_claim;
  end if;

  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(v_user,'donation_payment_claim_submitted','donation',v_donation.id::text,
    jsonb_build_object('order_id',v_donation.order_id,'claim_id',v_claim.id,
      'evidence_count',cardinality(v_paths),'updated_existing_claim',v_existing));

  return jsonb_build_object(
    'status','pending_review',
    'claim_id',v_claim.id,
    'message',case when v_existing
      then 'Your open payment review was updated with the new evidence.'
      else 'Payment proof submitted for administrator review. Do not pay again until the bank status is checked.'
    end
  );
end;
$function$;

revoke all on function public.janwatch_submit_donation_payment_claim(text,bigint,text,text,text[]) from public, anon;
grant execute on function public.janwatch_submit_donation_payment_claim(text,bigint,text,text,text[]) to authenticated;

create or replace function public.janwatch_admin_get_donation_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_role text;
  v_settings jsonb;
  v_donations jsonb;
  v_requests jsonb;
  v_claims jsonb;
begin
  select role into v_role from public.user_roles where user_id = auth.uid() limit 1;
  if auth.uid() is null or coalesce(v_role, '') not in ('admin','super_admin') then
    raise exception 'Administrator permission required';
  end if;

  select to_jsonb(s) - 'id' into v_settings
  from public.donation_settings s where id = true;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'order_id',d.order_id,'amount_paise',d.amount_paise,'currency',d.currency,
    'donor_user_id',d.donor_user_id,'donor_name',d.donor_name,'donor_email',d.donor_email,
    'is_anonymous',d.is_anonymous,'show_on_leaderboard',d.show_on_leaderboard,
    'show_message_publicly',d.show_message_publicly,'admin_hidden',d.admin_hidden,
    'admin_removed',d.admin_removed,'admin_removed_at',d.admin_removed_at,
    'admin_removed_by',d.admin_removed_by,'admin_removal_note',d.admin_removal_note,
    'record_source',d.record_source,'recorded_by',d.recorded_by,
    'message',d.message,'status',d.status,'utr',d.utr,'gateway_payment_id',d.gateway_payment_id,
    'created_at',d.created_at,'verified_at',d.verified_at
  ) order by d.created_at desc), '[]'::jsonb) into v_donations
  from (select * from public.donation_intents order by created_at desc limit 1000) d;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'requested_by',r.requested_by,'changes',r.changes,'status',r.status,
    'review_note',r.review_note,'reviewed_by',r.reviewed_by,'reviewed_at',r.reviewed_at,'created_at',r.created_at
  ) order by r.created_at desc), '[]'::jsonb) into v_requests
  from (select * from public.donation_settings_change_requests order by created_at desc limit 100) r;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'donation_intent_id',c.donation_intent_id,'order_id',d.order_id,
    'donation_amount_paise',d.amount_paise,'donation_status',d.status,
    'donor_name',case when d.is_anonymous then 'Anonymous' else d.donor_name end,
    'donor_email',case when d.is_anonymous then null else d.donor_email end,
    'user_id',c.user_id,'claimed_utr',c.claimed_utr,'claimed_amount_paise',c.claimed_amount_paise,
    'payment_timestamp',c.payment_timestamp,'user_note',c.user_note,
    'screenshot_path',c.screenshot_path,'evidence_paths',case
      when cardinality(c.evidence_paths) > 0 then to_jsonb(c.evidence_paths)
      else jsonb_build_array(c.screenshot_path) end,
    'status',c.status,'admin_review_note',c.admin_review_note,'reviewed_by',c.reviewed_by,
    'reviewed_at',c.reviewed_at,'created_at',c.created_at
  ) order by c.created_at desc), '[]'::jsonb) into v_claims
  from (select * from public.donation_manual_review_claims order by created_at desc limit 1000) c
  join public.donation_intents d on d.id = c.donation_intent_id;

  return jsonb_build_object('role',v_role,'settings',coalesce(v_settings,'{}'::jsonb),
    'donations',v_donations,'change_requests',v_requests,'manual_reviews',v_claims);
end;
$function$;

revoke all on function public.janwatch_admin_get_donation_data() from public, anon;
grant execute on function public.janwatch_admin_get_donation_data() to authenticated;

commit;
