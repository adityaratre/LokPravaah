-- LokPravaah manual UPI payment confirmation fallback.
-- Apply after the donation and Cloudflare UPI gateway schema migrations.
-- Screenshots and user-entered UTRs are claims only; only the signed webhook or an admin-verified bank UTR confirms a donation.
begin;

alter table public.donation_intents
  add column if not exists admin_removed boolean not null default false;

create table if not exists public.donation_manual_review_claims (
  id uuid primary key default gen_random_uuid(),
  donation_intent_id uuid not null unique references public.donation_intents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  screenshot_path text not null,
  claimed_utr text check (claimed_utr is null or char_length(claimed_utr) between 6 and 80),
  claimed_amount_paise bigint check (claimed_amount_paise is null or claimed_amount_paise between 100 and 10000000),
  payment_timestamp timestamptz,
  user_note text check (user_note is null or char_length(user_note) <= 2000),
  status text not null default 'pending_review' check (status in ('pending_review','confirmed','rejected')),
  admin_review_note text check (admin_review_note is null or char_length(admin_review_note) <= 1000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists donation_manual_review_claims_status_created_idx
  on public.donation_manual_review_claims(status, created_at desc);

create table if not exists public.donation_manual_reviews (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references public.donation_intents(id) on delete restrict,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  order_id text not null,
  amount_paise bigint not null,
  utr text not null,
  review_note text not null,
  prior_status text not null,
  created_at timestamptz not null default now()
);
create index if not exists donation_manual_reviews_order_created_idx
  on public.donation_manual_reviews(order_id, created_at desc);

create table if not exists public.donation_admin_review_audit (
  id uuid primary key default gen_random_uuid(),
  donation_intent_id uuid references public.donation_intents(id) on delete set null,
  claim_id uuid references public.donation_manual_review_claims(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists donation_admin_review_audit_created_idx
  on public.donation_admin_review_audit(created_at desc);

alter table public.donation_manual_review_claims enable row level security;
alter table public.donation_manual_reviews enable row level security;
alter table public.donation_admin_review_audit enable row level security;
revoke all on public.donation_manual_review_claims from public, anon, authenticated;
revoke all on public.donation_manual_reviews from public, anon, authenticated;
revoke all on public.donation_admin_review_audit from public, anon, authenticated;
grant all on public.donation_manual_review_claims to service_role;
grant all on public.donation_manual_reviews to service_role;
grant all on public.donation_admin_review_audit to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('donation-payment-evidence', 'donation-payment-evidence', false, 10485760,
        array['image/jpeg','image/png','image/webp','application/pdf']::text[])
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']::text[];

create or replace function public.can_upload_donation_payment_evidence(p_order_id text)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
  select exists (
    select 1 from public.donation_intents d
    where d.order_id = p_order_id and d.status <> 'succeeded'
      and d.created_at > now() - interval '30 days'
  );
$$;
revoke all on function public.can_upload_donation_payment_evidence(text) from public;
grant execute on function public.can_upload_donation_payment_evidence(text) to authenticated;

drop policy if exists donation_payment_evidence_upload_own on storage.objects;
create policy donation_payment_evidence_upload_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'donation-payment-evidence'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists donation_payment_evidence_read_own_admin on storage.objects;
create policy donation_payment_evidence_read_own_admin on storage.objects
  for select to authenticated
  using (
    bucket_id = 'donation-payment-evidence'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_janwatch_admin())
  );

create or replace function public.janwatch_submit_manual_donation_claim(
  p_order_id text, p_screenshot_path text, p_claimed_utr text default null,
  p_claimed_amount_paise bigint default null, p_payment_timestamp timestamptz default null,
  p_user_note text default null
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, auth, storage, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_donation public.donation_intents%rowtype;
  v_claim public.donation_manual_review_claims%rowtype;
  v_utr text := nullif(btrim(p_claimed_utr), '');
begin
  if v_user is null then raise exception 'Sign in to submit a payment review'; end if;
  if p_order_id is null or length(p_order_id) < 8 or length(p_order_id) > 80 then raise exception 'Invalid donation reference'; end if;
  if p_screenshot_path is null or length(p_screenshot_path) > 500
    or split_part(p_screenshot_path, '/', 1) <> v_user::text or p_screenshot_path like '%..%' then
    raise exception 'Upload the screenshot to your own secure evidence folder';
  end if;
  if v_utr is not null and (length(v_utr) < 6 or length(v_utr) > 80 or v_utr !~ '^[A-Za-z0-9_-]+$') then
    raise exception 'Enter a valid UPI/bank reference or leave it blank';
  end if;
  if p_claimed_amount_paise is null or p_claimed_amount_paise < 100 or p_claimed_amount_paise > 10000000 then
    raise exception 'Enter the amount shown on the receipt';
  end if;
  if p_user_note is not null and length(p_user_note) > 2000 then raise exception 'Review note is too long'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id='donation-payment-evidence' and o.name=p_screenshot_path) then
    raise exception 'Payment screenshot was not found in secure storage';
  end if;

  select * into v_donation from public.donation_intents where order_id=btrim(p_order_id) for update;
  if not found then raise exception 'Donation reference not found'; end if;
  if v_donation.status='succeeded' then raise exception 'This donation is already verified; contact support if needed'; end if;
  if v_donation.donor_user_id is not null and v_donation.donor_user_id<>v_user then raise exception 'This donation reference belongs to another account'; end if;
  if v_donation.status not in ('pending','failed','suspicious','expired','cancelled') then
    raise exception 'This donation state cannot be submitted for manual review';
  end if;

  insert into public.donation_manual_review_claims(
    donation_intent_id,user_id,screenshot_path,claimed_utr,claimed_amount_paise,
    payment_timestamp,user_note,status,admin_review_note,reviewed_by,reviewed_at,created_at,updated_at
  ) values (
    v_donation.id,v_user,p_screenshot_path,v_utr,p_claimed_amount_paise,p_payment_timestamp,
    left(nullif(btrim(p_user_note),''),2000),'pending_review',null,null,null,now(),now()
  )
  on conflict (donation_intent_id) do update set
    screenshot_path=excluded.screenshot_path, claimed_utr=excluded.claimed_utr,
    claimed_amount_paise=excluded.claimed_amount_paise, payment_timestamp=excluded.payment_timestamp,
    user_note=excluded.user_note, status='pending_review', admin_review_note=null,
    reviewed_by=null, reviewed_at=null, updated_at=now()
  where public.donation_manual_review_claims.user_id=v_user
  returning * into v_claim;
  if not found then raise exception 'A review claim already exists for this donation and another account'; end if;

  insert into public.donation_admin_review_audit(donation_intent_id,claim_id,actor_id,action,details)
  values(v_donation.id,v_claim.id,v_user,'user_submitted_manual_review',
         jsonb_build_object('order_id',p_order_id,'claimed_amount_paise',p_claimed_amount_paise));
  return jsonb_build_object('submitted',true,'claim_id',v_claim.id,'status',v_claim.status,
    'message','Evidence sent for manual bank-statement review. This does not itself verify payment.');
end;
$$;
revoke all on function public.janwatch_submit_manual_donation_claim(text,text,text,bigint,timestamptz,text) from public, anon;
grant execute on function public.janwatch_submit_manual_donation_claim(text,text,text,bigint,timestamptz,text) to authenticated;

create or replace function public.janwatch_get_my_donation_claim_status(p_order_id text)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_claim public.donation_manual_review_claims%rowtype;
begin
  if v_user is null then raise exception 'Sign in to check a payment review'; end if;
  select c.* into v_claim
  from public.donation_manual_review_claims c
  join public.donation_intents d on d.id=c.donation_intent_id
  where d.order_id=p_order_id and c.user_id=v_user limit 1;
  if not found then return jsonb_build_object('found',false); end if;
  return jsonb_build_object('found',true,'status',v_claim.status,
    'admin_review_note',v_claim.admin_review_note,'created_at',v_claim.created_at,'reviewed_at',v_claim.reviewed_at);
end;
$$;
revoke all on function public.janwatch_get_my_donation_claim_status(text) from public, anon;
grant execute on function public.janwatch_get_my_donation_claim_status(text) to authenticated;

create or replace function public.janwatch_admin_manual_verify_donation(p_donation_id uuid,p_utr text,p_note text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_role text;
  v_donation public.donation_intents%rowtype;
  v_gateway public.upi_gateway_payments%rowtype;
  v_utr text := nullif(btrim(p_utr),'');
  v_note text := nullif(btrim(p_note),'');
  v_previous_status text;
begin
  select role into v_role from public.user_roles where user_id=auth.uid() limit 1;
  if auth.uid() is null or coalesce(v_role,'') not in ('admin','super_admin') then raise exception 'Administrator permission required'; end if;
  if v_utr is null or v_utr !~ '^[A-Za-z0-9_-]{6,80}$' then raise exception 'A real UTR/bank reference (6-80 characters) is required'; end if;
  if v_note is null or char_length(v_note) not between 5 and 500 then raise exception 'Add a review note (5-500 characters)'; end if;
  select * into v_donation from public.donation_intents where id=p_donation_id for update;
  if not found then raise exception 'Donation record not found'; end if;
  if v_donation.status='succeeded' then
    if v_donation.utr=v_utr then return jsonb_build_object('status','succeeded','alreadyVerified',true,'message','This donation was already verified with the same UTR.'); end if;
    raise exception 'Donation is already verified with a different UTR';
  end if;
  if v_donation.status not in ('pending','failed','suspicious','expired','cancelled') then raise exception 'Donation state is not eligible for manual verification'; end if;
  if exists(select 1 from public.donation_intents d where d.utr=v_utr and d.id<>p_donation_id) then raise exception 'This UTR is already linked to another donation'; end if;
  if exists(select 1 from public.upi_gateway_payments p where p.bank_reference_number=v_utr and p.order_id<>v_donation.order_id) then
    raise exception 'This bank reference is linked to another payment order';
  end if;
  select * into v_gateway from public.upi_gateway_payments where order_id=v_donation.order_id for update;
  if found and v_gateway.status='SUCCESS' and v_gateway.bank_reference_number is distinct from v_utr then
    raise exception 'Gateway already records a different successful bank reference for this order';
  end if;
  v_previous_status := v_donation.status;
  update public.donation_intents set status='succeeded',utr=v_utr,verified_at=now(),updated_at=now(),
    gateway_payment_id=coalesce(gateway_payment_id,v_gateway.id::text) where id=p_donation_id;
  insert into public.donation_manual_reviews(donation_id,reviewed_by,order_id,amount_paise,utr,review_note,prior_status)
    values(p_donation_id,auth.uid(),v_donation.order_id,v_donation.amount_paise,v_utr,v_note,v_previous_status);
  update public.upi_gateway_payments set status='SUCCESS',queue_position=0,bank_reference_number=v_utr,
    completed_at=coalesce(completed_at,now()),observed_at=coalesce(observed_at,now()),updated_at=now()
    where order_id=v_donation.order_id and status in ('ACTIVE','PROCESSING','FAILED','EXPIRED','CANCELLED','SUSPICIOUS');
  update public.upi_gateway_observations set status='SUCCESS',matched_payment_id=v_gateway.id
    where bank_reference_number=v_utr and v_gateway.id is not null and status in ('UNMATCHED','PROCESSING');
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
    values(auth.uid(),'donation_manually_verified','donation',p_donation_id::text,
      jsonb_build_object('order_id',v_donation.order_id,'amount_paise',v_donation.amount_paise,'utr',v_utr,'prior_status',v_previous_status,'review_note',v_note));
  return jsonb_build_object('status','succeeded','alreadyVerified',false,'message','Donation manually verified. UTR and review note were saved to the private audit trail.');
end;
$$;
revoke all on function public.janwatch_admin_manual_verify_donation(uuid,text,text) from public, anon;
grant execute on function public.janwatch_admin_manual_verify_donation(uuid,text,text) to authenticated;

create or replace function public.janwatch_admin_review_manual_donation(
  p_claim_id uuid,p_action text,p_note text default null,p_verified_utr text default null
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_role text;
  v_claim public.donation_manual_review_claims%rowtype;
  v_donation public.donation_intents%rowtype;
  v_utr text := nullif(btrim(p_verified_utr),'');
  v_note text := nullif(btrim(p_note),'');
  v_result jsonb;
begin
  select role into v_role from public.user_roles where user_id=auth.uid() limit 1;
  if auth.uid() is null or coalesce(v_role,'') not in ('admin','super_admin') then raise exception 'Administrator permission required'; end if;
  if p_action not in ('confirm','reject') then raise exception 'Action must be confirm or reject'; end if;
  if v_note is null or char_length(v_note)<5 or char_length(v_note)>1000 then raise exception 'Add a review note between 5 and 1000 characters'; end if;
  select * into v_claim from public.donation_manual_review_claims where id=p_claim_id for update;
  if not found then raise exception 'Manual review claim not found'; end if;
  if v_claim.status<>'pending_review' then raise exception 'This claim has already been reviewed'; end if;
  select * into v_donation from public.donation_intents where id=v_claim.donation_intent_id for update;
  if not found then raise exception 'Donation record not found'; end if;

  if p_action='confirm' then
    if v_utr is null or v_utr !~ '^[A-Za-z0-9_-]{6,80}$' then raise exception 'Enter the actual bank UTR after checking the receiving-bank statement'; end if;
    v_result := public.janwatch_admin_manual_verify_donation(v_donation.id,v_utr,left(v_note,500));
    update public.donation_manual_review_claims set status='confirmed',claimed_utr=v_utr,
      admin_review_note=left(v_note,1000),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
      where id=p_claim_id;
    insert into public.donation_admin_review_audit(donation_intent_id,claim_id,actor_id,action,details)
      values(v_donation.id,p_claim_id,auth.uid(),'manual_donation_confirmed',jsonb_build_object('utr',v_utr,'note',v_note));
    return jsonb_build_object('status','confirmed','message','Donation verified after the UTR was checked against the receiving-bank record.','verification',v_result);
  end if;

  update public.donation_manual_review_claims set status='rejected',admin_review_note=left(v_note,1000),
    reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=p_claim_id;
  insert into public.donation_admin_review_audit(donation_intent_id,claim_id,actor_id,action,details)
    values(v_donation.id,p_claim_id,auth.uid(),'manual_donation_claim_rejected',jsonb_build_object('note',v_note));
  return jsonb_build_object('status','rejected','message','Payment claim rejected. The donation remains unverified.');
end;
$$;
revoke all on function public.janwatch_admin_review_manual_donation(uuid,text,text,text) from public, anon;
grant execute on function public.janwatch_admin_review_manual_donation(uuid,text,text,text) to authenticated;

create or replace function public.janwatch_admin_get_donation_data()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_role text; v_settings jsonb; v_donations jsonb; v_requests jsonb; v_claims jsonb;
begin
  select role into v_role from public.user_roles where user_id=auth.uid() limit 1;
  if auth.uid() is null or coalesce(v_role,'') not in ('admin','super_admin') then raise exception 'Administrator permission required'; end if;
  select to_jsonb(s)-'id' into v_settings from public.donation_settings s where id=true;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'order_id',d.order_id,'amount_paise',d.amount_paise,'currency',d.currency,
    'donor_user_id',d.donor_user_id,'donor_name',d.donor_name,'donor_email',d.donor_email,
    'is_anonymous',d.is_anonymous,'show_on_leaderboard',d.show_on_leaderboard,
    'show_message_publicly',d.show_message_publicly,'admin_hidden',d.admin_hidden,
    'admin_removed',d.admin_removed,'message',d.message,'status',d.status,'utr',d.utr,
    'gateway_payment_id',d.gateway_payment_id,'created_at',d.created_at,'verified_at',d.verified_at
  ) order by d.created_at desc),'[]'::jsonb) into v_donations
  from (select * from public.donation_intents order by created_at desc limit 150) d;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'requested_by',r.requested_by,'changes',r.changes,'status',r.status,
    'review_note',r.review_note,'reviewed_by',r.reviewed_by,'reviewed_at',r.reviewed_at,'created_at',r.created_at
  ) order by r.created_at desc),'[]'::jsonb) into v_requests
  from (select * from public.donation_settings_change_requests order by created_at desc limit 100) r;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'donation_intent_id',c.donation_intent_id,'order_id',d.order_id,
    'donation_amount_paise',d.amount_paise,'donation_status',d.status,
    'donor_name',case when d.is_anonymous then 'Anonymous' else d.donor_name end,
    'donor_email',case when d.is_anonymous then null else d.donor_email end,
    'user_id',c.user_id,'claimed_utr',c.claimed_utr,'claimed_amount_paise',c.claimed_amount_paise,
    'payment_timestamp',c.payment_timestamp,'user_note',c.user_note,'screenshot_path',c.screenshot_path,
    'status',c.status,'admin_review_note',c.admin_review_note,'reviewed_by',c.reviewed_by,
    'reviewed_at',c.reviewed_at,'created_at',c.created_at
  ) order by c.created_at desc),'[]'::jsonb) into v_claims
  from (select * from public.donation_manual_review_claims order by created_at desc limit 150)c
  join public.donation_intents d on d.id=c.donation_intent_id;
  return jsonb_build_object('role',v_role,'settings',coalesce(v_settings,'{}'::jsonb),
    'donations',v_donations,'change_requests',v_requests,'manual_reviews',v_claims);
end;
$$;
revoke all on function public.janwatch_admin_get_donation_data() from public, anon;
grant execute on function public.janwatch_admin_get_donation_data() to authenticated;

commit;
