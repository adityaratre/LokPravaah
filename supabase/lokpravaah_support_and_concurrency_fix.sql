-- LokPravaah: concurrent UPI sessions + user/admin ticket support
-- Run in Supabase SQL Editor after taking a database backup.

-- Remove the legacy global single-active-payment restriction. The old partial unique
-- index prevented independent sessions even after the create-payment RPC was updated.
drop index if exists public.upi_gateway_single_active_slot_uq;
drop index if exists public.upi_gateway_one_active_per_merchant;
drop index if exists public.upi_gateway_payments_one_active_per_merchant;

-- Payment sessions must be independent. A donor must not occupy a global merchant slot.
create or replace function public.upi_gateway_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  -- Expire each ACTIVE session independently; there is no global active-payment slot.
  update public.upi_gateway_payments
    set status = 'EXPIRED', updated_at = now(), queue_position = 0
    where status = 'ACTIVE' and expires_at is not null and expires_at <= now();

  -- Activate all sessions left in QUEUED status by the legacy migration, not just one.
  update public.upi_gateway_payments p
    set status = 'ACTIVE', queue_position = 0,
        expires_at = now() + make_interval(mins => greatest(5, least(30, p.session_minutes))),
        updated_at = now()
    where p.status = 'QUEUED';
  return jsonb_build_object('ok', true, 'concurrentSessions', true);
end;
$$;

create or replace function public.upi_gateway_create_payment(
  p_payment_id uuid, p_order_id text, p_amount_paise bigint, p_merchant_id text,
  p_idempotency_key text default null, p_session_minutes integer default 15
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_donation public.donation_intents%rowtype;
  v_existing public.upi_gateway_payments%rowtype;
  v_created public.upi_gateway_payments%rowtype;
  v_minutes integer := greatest(5, least(30, coalesce(p_session_minutes,15)));
begin
  -- Lock only the specific donation intent, not the entire merchant.
  select * into v_donation from public.donation_intents where order_id = p_order_id for update;
  if not found then raise exception 'DONATION_INTENT_NOT_FOUND'; end if;
  if v_donation.amount_paise <> p_amount_paise or v_donation.currency <> 'INR' then raise exception 'DONATION_AMOUNT_MISMATCH'; end if;
  -- Share the observation matcher lock only for the database write, not for the
  -- lifetime of a payment. Every new donor session is still ACTIVE immediately.
  perform pg_advisory_xact_lock(hashtext('lokpravaah-cloudflare-upi-slot-v1'));
  select * into v_existing from public.upi_gateway_payments where order_id = p_order_id limit 1;
  if found then return jsonb_build_object(
    'paymentId',v_existing.id,'orderId',v_existing.order_id,
    'amount',to_char(v_existing.amount_paise / 100.0,'FM999999990.00'),
    'amountPaise',v_existing.amount_paise::text,'currency',v_existing.currency,
    'status',v_existing.status,'queuePosition',v_existing.queue_position,
    'expiresAt',v_existing.expires_at,'completedAt',v_existing.completed_at); end if;
  if v_donation.status <> 'pending' then raise exception 'DONATION_INTENT_NOT_PENDING'; end if;
  if p_amount_paise < 100 or p_amount_paise > 10000000 then raise exception 'INVALID_AMOUNT'; end if;
  if p_merchant_id <> '00000000-0000-0000-0000-000000000001' then raise exception 'MERCHANT_NOT_SUPPORTED'; end if;
  perform public.upi_gateway_tick();
  insert into public.upi_gateway_payments(
    id,merchant_id,order_id,amount_paise,currency,status,queue_position,session_minutes,
    idempotency_key,expires_at,created_at,updated_at
  ) values (p_payment_id,p_merchant_id,p_order_id,p_amount_paise,'INR','ACTIVE',0,v_minutes,
    nullif(p_idempotency_key,''),now()+make_interval(mins=>v_minutes),now(),now()) returning * into v_created;
  return jsonb_build_object('paymentId',v_created.id,'orderId',v_created.order_id,
    'amount',to_char(v_created.amount_paise / 100.0,'FM999999990.00'),
    'amountPaise',v_created.amount_paise::text,'currency',v_created.currency,
    'status',v_created.status,'queuePosition',0,'expiresAt',v_created.expires_at,'completedAt',v_created.completed_at);
end; $$;

create or replace function public.upi_gateway_prepare_observation(
  p_observation_id uuid,
  p_device_id text,
  p_amount_paise bigint,
  p_bank_reference_number text,
  p_sender_vpa text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.upi_gateway_devices%rowtype;
  v_existing public.upi_gateway_observations%rowtype;
  v_payment public.upi_gateway_payments%rowtype;
  v_candidate_count integer := 0;
  v_observed timestamptz := coalesce(p_observed_at,now());
begin
  perform pg_advisory_xact_lock(hashtext('lokpravaah-cloudflare-upi-slot-v1'));
  select * into v_device from public.upi_gateway_devices where id = p_device_id and is_active = true;
  if not found then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;
  if p_amount_paise < 100 or p_amount_paise > 10000000 or p_bank_reference_number is null or char_length(p_bank_reference_number) not between 6 and 80 then
    raise exception 'INVALID_OBSERVATION';
  end if;
  if abs(extract(epoch from (now() - v_observed))) > 600 then
    raise exception 'OBSERVATION_TIME_OUT_OF_RANGE';
  end if;

  select * into v_existing from public.upi_gateway_observations where bank_reference_number = p_bank_reference_number;
  if found then
    if v_existing.matched_payment_id is null then
      return jsonb_build_object('matched',false,'duplicate',true,'status','DUPLICATE');
    end if;
    select * into v_payment from public.upi_gateway_payments where id = v_existing.matched_payment_id;
    return jsonb_build_object(
      'matched',true,'duplicate',true,'status',v_payment.status,
      'paymentId',v_payment.id,'orderId',v_payment.order_id,
      'amountPaise',v_payment.amount_paise::text
    );
  end if;

  insert into public.upi_gateway_observations(id,device_id,amount_paise,bank_reference_number,sender_vpa,observed_at,status,created_at)
    values(coalesce(p_observation_id,gen_random_uuid()),p_device_id,p_amount_paise,p_bank_reference_number,nullif(p_sender_vpa,''),v_observed,'UNMATCHED',now());

  select count(*)::integer into v_candidate_count
    from public.upi_gateway_payments p
    where p.merchant_id = v_device.merchant_id
      and p.status = 'ACTIVE'
      and p.amount_paise = p_amount_paise
      and p.created_at <= v_observed
      and p.expires_at >= v_observed;

  -- Bank-credit alerts prove amount/time/reference, not the donation order. If more
  -- than one live session has the same amount, never auto-assign to the oldest one.
  if v_candidate_count <> 1 then
    return jsonb_build_object(
      'matched',false,'duplicate',false,'status','UNMATCHED',
      'reason',case when v_candidate_count = 0 then 'NO_MATCHING_SESSION' else 'AMBIGUOUS_AMOUNT_MATCH' end,
      'candidateCount',v_candidate_count
    );
  end if;

  select * into v_payment from public.upi_gateway_payments p
    where p.merchant_id = v_device.merchant_id
      and p.status = 'ACTIVE'
      and p.amount_paise = p_amount_paise
      and p.created_at <= v_observed
      and p.expires_at >= v_observed
    order by p.created_at asc
    limit 1
    for update;
  if not found then return jsonb_build_object('matched',false,'duplicate',false,'status','UNMATCHED','reason','SESSION_CHANGED_DURING_MATCH'); end if;

  update public.upi_gateway_payments set status='PROCESSING', queue_position=0, bank_reference_number=p_bank_reference_number,
    sender_vpa=nullif(p_sender_vpa,''), observed_at=v_observed, processing_started_at=now(), updated_at=now()
    where id=v_payment.id;
  update public.upi_gateway_observations set status='PROCESSING', matched_payment_id=v_payment.id
    where bank_reference_number=p_bank_reference_number;
  return jsonb_build_object('matched',true,'duplicate',false,'status','PROCESSING',
    'paymentId',v_payment.id,'orderId',v_payment.order_id,'amountPaise',v_payment.amount_paise::text);
end;
$$;


-- Ticket categories/subcategories are data-driven and editable by admins.
create table if not exists public.support_ticket_categories (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  subcategory text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(category, subcategory)
);
insert into public.support_ticket_categories(category,subcategory,sort_order) values
 ('Donations & UPI','Paid but website not confirmed',1),
 ('Donations & UPI','Payment pending / processing',2),
 ('Donations & UPI','Payment failed but money debited',3),
 ('Donations & UPI','Refund / duplicate payment',4),
 ('Donations & UPI','QR / checkout not working',5),
 ('Account & Login','Login / OTP issue',10),
 ('Account & Login','Google sign-in issue',11),
 ('Reports & Complaints','Submit or update a report',20),
 ('Rewards & Withdrawals','Reward or withdrawal issue',30),
 ('Website & Technical','Bug / broken page',40),
 ('Website & Technical','Other technical issue',41),
 ('Other','General question',50)
on conflict(category,subcategory) do nothing;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number bigint generated always as identity unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  subcategory text not null,
  subject text not null check (char_length(subject) between 4 and 160),
  description text not null check (char_length(description) between 10 and 8000),
  status text not null default 'open' check (status in ('open','in_progress','waiting_for_user','pending_review','resolved','closed','rejected')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  payment_order_id text,
  payment_reference text,
  claimed_amount_paise bigint check (claimed_amount_paise is null or claimed_amount_paise >= 0),
  payment_timestamp timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_tickets_user_created_idx on public.support_tickets(user_id,created_at desc);
create index if not exists support_tickets_status_created_idx on public.support_tickets(status,priority,created_at);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 8000),
  is_internal_note boolean not null default false,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_messages_ticket_idx on public.support_ticket_messages(ticket_id,created_at);

create table if not exists public.support_ticket_audit (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.support_touch_updated_at()
returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists support_tickets_touch_updated_at on public.support_tickets;
create trigger support_tickets_touch_updated_at before update on public.support_tickets for each row execute function public.support_touch_updated_at();

alter table public.support_ticket_categories enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.support_ticket_audit enable row level security;

drop policy if exists support_categories_read_active on public.support_ticket_categories;
create policy support_categories_read_active on public.support_ticket_categories for select to authenticated using (active or public.is_janwatch_admin());
drop policy if exists support_categories_admin_manage on public.support_ticket_categories;
create policy support_categories_admin_manage on public.support_ticket_categories for all to authenticated using (public.is_janwatch_admin()) with check (public.is_janwatch_admin());
drop policy if exists support_tickets_read_own_or_admin on public.support_tickets;
create policy support_tickets_read_own_or_admin on public.support_tickets for select to authenticated using (user_id=auth.uid() or public.is_janwatch_admin());
drop policy if exists support_tickets_create_own on public.support_tickets;
create policy support_tickets_create_own on public.support_tickets for insert to authenticated with check (user_id=auth.uid());
drop policy if exists support_tickets_update_admin_or_owner on public.support_tickets;
create policy support_tickets_update_admin_or_owner on public.support_tickets for update to authenticated using (public.is_janwatch_admin()) with check (public.is_janwatch_admin());
drop policy if exists support_messages_read_ticket on public.support_ticket_messages;
create policy support_messages_read_ticket on public.support_ticket_messages for select to authenticated using (
  exists(select 1 from public.support_tickets t where t.id=ticket_id and (t.user_id=auth.uid() or public.is_janwatch_admin()))
  and (not is_internal_note or public.is_janwatch_admin())
);
drop policy if exists support_messages_insert_ticket on public.support_ticket_messages;
create policy support_messages_insert_ticket on public.support_ticket_messages for insert to authenticated with check (
  sender_id=auth.uid() and exists(select 1 from public.support_tickets t where t.id=ticket_id and (t.user_id=auth.uid() or public.is_janwatch_admin()))
  and (not is_internal_note or public.is_janwatch_admin())
);
drop policy if exists support_audit_read_admin on public.support_ticket_audit;
create policy support_audit_read_admin on public.support_ticket_audit for select to authenticated using (public.is_janwatch_admin());
drop policy if exists support_audit_insert_admin_or_actor on public.support_ticket_audit;
create policy support_audit_insert_admin_or_actor on public.support_ticket_audit for insert to authenticated with check (actor_id=auth.uid() and (public.is_janwatch_admin() or exists(select 1 from public.support_tickets t where t.id=ticket_id and t.user_id=auth.uid())));

-- Private evidence bucket: attachments are never public. Storage access is mediated by authenticated ticket ownership/admin policies.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('support-ticket-evidence','support-ticket-evidence',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf'];
drop policy if exists support_evidence_upload_authenticated on storage.objects;
create policy support_evidence_upload_authenticated on storage.objects for insert to authenticated with check (
 bucket_id='support-ticket-evidence' and (storage.foldername(name))[1]=auth.uid()::text
);
drop policy if exists support_evidence_read_owner_admin on storage.objects;
create policy support_evidence_read_owner_admin on storage.objects for select to authenticated using (
 bucket_id='support-ticket-evidence' and ((storage.foldername(name))[1]=auth.uid()::text or public.is_janwatch_admin())
);

revoke all on function public.upi_gateway_tick() from public, anon, authenticated;
revoke all on function public.upi_gateway_create_payment(uuid,text,bigint,text,text,integer) from public, anon, authenticated;
revoke all on function public.upi_gateway_prepare_observation(uuid,text,bigint,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.upi_gateway_tick() to service_role;
grant execute on function public.upi_gateway_create_payment(uuid,text,bigint,text,text,integer) to service_role;
grant execute on function public.upi_gateway_prepare_observation(uuid,text,bigint,text,text,timestamptz) to service_role;

notify pgrst, 'reload schema';
