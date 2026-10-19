-- Require the claimed transfer amount to match the original donation before manual approval.
-- The reviewer must also confirm the UTR against the receiving-bank statement.
create or replace function public.janwatch_admin_review_manual_donation(
  p_claim_id uuid,
  p_action text,
  p_note text default null,
  p_verified_utr text default null
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
  if auth.uid() is null or coalesce(v_role,'') not in ('admin','super_admin') then
    raise exception 'Administrator permission required';
  end if;
  if p_action not in ('confirm','reject') then
    raise exception 'Action must be confirm or reject';
  end if;
  if v_note is null or char_length(v_note) not between 3 and 1000 then
    raise exception 'Add a review note between 3 and 1000 characters';
  end if;

  select * into v_claim
  from public.donation_manual_review_claims
  where id = p_claim_id
  for update;
  if not found then raise exception 'Manual review claim not found'; end if;
  if v_claim.status <> 'pending_review' then raise exception 'This claim has already been reviewed'; end if;

  select * into v_donation
  from public.donation_intents
  where id = v_claim.donation_intent_id
  for update;
  if not found then raise exception 'Donation record not found'; end if;

  if p_action = 'confirm' then
    if v_utr is null or v_utr !~ '^[A-Za-z0-9_-]{6,80}$' then
      raise exception 'Enter the actual bank UTR after checking the receiving-bank statement';
    end if;
    if v_claim.claimed_amount_paise is null or v_claim.claimed_amount_paise <> v_donation.amount_paise then
      raise exception 'Claimed amount differs from this donation. Do not approve it as fully paid; reconcile the actual amount received first.';
    end if;

    v_result := public.janwatch_admin_manual_verify_donation(v_donation.id, v_utr, left(v_note,500));

    update public.donation_manual_review_claims
    set status = 'confirmed',
        claimed_utr = v_utr,
        admin_review_note = left(v_note,1000),
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        updated_at = now()
    where id = p_claim_id;

    insert into public.donation_admin_review_audit(donation_intent_id,claim_id,actor_id,action,details)
    values(v_donation.id,p_claim_id,auth.uid(),'manual_donation_confirmed',
      jsonb_build_object('utr',v_utr,'note',v_note,'amount_paise',v_claim.claimed_amount_paise));

    return jsonb_build_object(
      'status','confirmed',
      'message','Donation verified after the amount and UTR were checked against the receiving-bank record.',
      'verification',v_result
    );
  end if;

  update public.donation_manual_review_claims
  set status = 'rejected',
      admin_review_note = left(v_note,1000),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  where id = p_claim_id;

  insert into public.donation_admin_review_audit(donation_intent_id,claim_id,actor_id,action,details)
  values(v_donation.id,p_claim_id,auth.uid(),'manual_donation_claim_rejected',jsonb_build_object('note',v_note));

  return jsonb_build_object('status','rejected','message','Payment claim rejected. The donation remains unverified.');
end;
$function$;

revoke all on function public.janwatch_admin_review_manual_donation(uuid,text,text,text) from public, anon;
grant execute on function public.janwatch_admin_review_manual_donation(uuid,text,text,text) to authenticated;
