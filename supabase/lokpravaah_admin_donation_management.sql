-- Auditable offline donations and reversible moderation for LokPravaah.
-- Offline entries represent money the admin has already received; this does not create or fake a gateway event.
begin;

alter table public.donation_intents
  add column if not exists record_source text not null default 'gateway',
  add column if not exists recorded_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.donation_intents'::regclass
      and conname = 'donation_intents_record_source_check'
  ) then
    alter table public.donation_intents
      add constraint donation_intents_record_source_check
      check (record_source in ('gateway','manual_cash','manual_bank','manual_upi','manual_other'));
  end if;
end $$;

create index if not exists donation_intents_admin_recent_idx
  on public.donation_intents(created_at desc);
create index if not exists donation_intents_public_verified_idx
  on public.donation_intents(status, admin_removed, admin_hidden, verified_at desc);

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
    'payment_timestamp',c.payment_timestamp,'user_note',c.user_note,'screenshot_path',c.screenshot_path,
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

create or replace function public.janwatch_admin_create_manual_donation(
  p_amount_paise bigint,
  p_donor_name text default null,
  p_donor_email text default null,
  p_message text default null,
  p_received_at timestamptz default now(),
  p_record_source text default 'manual_cash',
  p_is_anonymous boolean default false,
  p_show_on_leaderboard boolean default true,
  p_show_message_publicly boolean default false,
  p_admin_note text default null
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_role text;
  v_id uuid;
  v_order_id text;
  v_name text := nullif(btrim(coalesce(p_donor_name,'')), '');
  v_email text := nullif(btrim(coalesce(p_donor_email,'')), '');
  v_message text := nullif(btrim(coalesce(p_message,'')), '');
  v_note text := nullif(btrim(coalesce(p_admin_note,'')), '');
  v_source text := lower(btrim(coalesce(p_record_source,'')));
  v_received_at timestamptz := coalesce(p_received_at, now());
begin
  select role into v_role from public.user_roles where user_id = auth.uid() limit 1;
  if auth.uid() is null or coalesce(v_role,'') not in ('admin','super_admin') then
    raise exception 'Administrator permission required';
  end if;
  if p_amount_paise is null or p_amount_paise < 100 or p_amount_paise > 10000000 then
    raise exception 'Donation amount must be between ₹1 and ₹100,000';
  end if;
  if v_source not in ('manual_cash','manual_bank','manual_upi','manual_other') then
    raise exception 'Choose a supported offline donation source';
  end if;
  if v_name is not null and char_length(v_name) > 80 then raise exception 'Donor name must be 80 characters or fewer'; end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Enter a valid donor email address';
  end if;
  if v_message is not null and char_length(v_message) > 300 then raise exception 'Donor message must be 300 characters or fewer'; end if;
  if v_note is null or char_length(v_note) not between 3 and 500 then
    raise exception 'Add an audit note (3–500 characters), such as cash received at a community event';
  end if;
  if v_received_at > now() + interval '5 minutes' then raise exception 'Received date cannot be in the future'; end if;
  if coalesce(p_is_anonymous,false) then v_name := null; v_email := null; end if;

  v_order_id := 'OFFLINE-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,20));

  insert into public.donation_intents(
    order_id,donor_user_id,amount_paise,currency,donor_name,donor_email,is_anonymous,message,
    status,utr,verified_at,created_at,updated_at,show_on_leaderboard,show_message_publicly,
    admin_hidden,admin_removed,record_source,recorded_by
  ) values (
    v_order_id,null,p_amount_paise,'INR',v_name,v_email,coalesce(p_is_anonymous,false),v_message,
    'succeeded',null,v_received_at,v_received_at,now(),
    (coalesce(p_show_on_leaderboard,true) and not coalesce(p_is_anonymous,false)),
    (coalesce(p_show_message_publicly,false) and not coalesce(p_is_anonymous,false) and v_message is not null),
    false,false,v_source,auth.uid()
  ) returning id into v_id;

  insert into public.donation_admin_audit(admin_user_id,donation_id,order_id,action,note)
  values(auth.uid(),v_id,v_order_id,'manual_offline_donation_added',v_note);
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(auth.uid(),'donation_manual_added','donation',v_id::text,
    jsonb_build_object('order_id',v_order_id,'amount_paise',p_amount_paise,'record_source',v_source,
      'received_at',v_received_at,'is_anonymous',coalesce(p_is_anonymous,false),'note',v_note));

  return jsonb_build_object('status','succeeded','donation_id',v_id,'order_id',v_order_id,
    'amount_paise',p_amount_paise,'record_source',v_source,
    'message','Offline donation recorded. Public total and leaderboard will include it according to visibility settings.');
end;
$function$;
revoke all on function public.janwatch_admin_create_manual_donation(bigint,text,text,text,timestamptz,text,boolean,boolean,boolean,text) from public, anon;
grant execute on function public.janwatch_admin_create_manual_donation(bigint,text,text,text,timestamptz,text,boolean,boolean,boolean,text) to authenticated;

create or replace function public.janwatch_admin_set_donation_removed(
  p_donation_id uuid, p_removed boolean, p_note text default null
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_role text;
  v_row public.donation_intents%rowtype;
  v_note text := nullif(btrim(coalesce(p_note,'')), '');
begin
  select role into v_role from public.user_roles where user_id = auth.uid() limit 1;
  if auth.uid() is null or coalesce(v_role,'') not in ('admin','super_admin') then raise exception 'Administrator permission required'; end if;
  if p_donation_id is null or p_removed is null then raise exception 'Donation and remove/restore action are required'; end if;
  if p_removed and (v_note is null or char_length(v_note) not between 3 and 500) then
    raise exception 'Add a reason (3–500 characters) before removing a donation from public totals';
  end if;

  select * into v_row from public.donation_intents where id = p_donation_id for update;
  if not found then raise exception 'Donation record not found'; end if;
  if v_row.status <> 'succeeded' then raise exception 'Only received/verified donation records can be removed from public totals'; end if;
  if v_row.admin_removed = p_removed then
    return jsonb_build_object('status','unchanged','admin_removed',p_removed,'message','This donation already has the requested state.');
  end if;

  update public.donation_intents
  set admin_removed = p_removed,
      admin_removed_at = case when p_removed then now() else null end,
      admin_removed_by = case when p_removed then auth.uid() else null end,
      admin_removal_note = case when p_removed then v_note else admin_removal_note end,
      updated_at = now()
  where id = p_donation_id;

  insert into public.donation_admin_audit(admin_user_id,donation_id,order_id,action,note)
  values(auth.uid(),v_row.id,v_row.order_id,
    case when p_removed then 'donation_removed_from_public_totals' else 'donation_restored_to_public_totals' end,
    coalesce(v_note,case when p_removed then 'Removed from public totals' else 'Restored to public totals' end));
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(auth.uid(),case when p_removed then 'donation_removed' else 'donation_restored' end,
    'donation',v_row.id::text,jsonb_build_object('order_id',v_row.order_id,'previous_status',v_row.status,
      'record_source',v_row.record_source,'note',v_note));

  return jsonb_build_object('status','saved','admin_removed',p_removed,
    'message',case when p_removed
      then 'Donation excluded from public total, recent activity and leaderboard; the record was retained for audit.'
      else 'Donation restored to public totals and leaderboard where the donor visibility settings allow it.'
    end);
end;
$function$;
revoke all on function public.janwatch_admin_set_donation_removed(uuid,boolean,text) from public, anon;
grant execute on function public.janwatch_admin_set_donation_removed(uuid,boolean,text) to authenticated;

commit;
