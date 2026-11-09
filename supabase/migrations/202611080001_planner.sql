-- Apply once using `supabase db push` or the Supabase SQL editor.
create table public.planner_records (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  id text not null check(length(id) between 1 and 500),
  type text not null check(type in ('event','action','occurrence','settings')),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<65536),
  deleted boolean not null default false,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key(user_id,id)
);
alter table public.planner_records enable row level security;
create policy own_records on public.planner_records for select to authenticated using(user_id=auth.uid());
revoke all on public.planner_records from anon, authenticated;
grant select on public.planner_records to authenticated;

create table public.mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  record_id text not null,
  result jsonb not null,
  primary key(user_id,mutation_id)
);
alter table public.mutation_receipts enable row level security;
revoke all on public.mutation_receipts from anon, authenticated;

create function public.apply_change(p_id text,p_type text,p_payload jsonb,p_deleted boolean,p_expected bigint,p_mutation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); current_row public.planner_records; receipt jsonb; response jsonb;
begin
  if uid is null then raise exception 'Authentication required';end if;
  if p_expected<0 or p_mutation is null then raise exception 'Invalid revision or mutation';end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text||':'||p_id,0));
  select result into receipt from public.mutation_receipts where user_id=uid and mutation_id=p_mutation;
  if receipt is not null then return receipt;end if;
  select * into current_row from public.planner_records where user_id=uid and id=p_id for update;
  if (current_row.id is null and p_expected<>0) or (current_row.id is not null and current_row.revision<>p_expected) then
    return jsonb_build_object('ok',false,'row',to_jsonb(current_row)-'user_id'-'updated_at');
  end if;
  insert into public.planner_records(user_id,id,type,payload,deleted,revision)
  values(uid,p_id,p_type,p_payload,p_deleted,p_expected+1)
  on conflict(user_id,id) do update set type=excluded.type,payload=excluded.payload,deleted=excluded.deleted,revision=excluded.revision,updated_at=now()
  returning * into current_row;
  response:=jsonb_build_object('ok',true,'row',to_jsonb(current_row)-'user_id'-'updated_at');
  insert into public.mutation_receipts values(uid,p_mutation,p_id,response);
  return response;
end $$;
revoke all on function public.apply_change(text,text,jsonb,boolean,bigint,uuid) from public,anon;
grant execute on function public.apply_change(text,text,jsonb,boolean,bigint,uuid) to authenticated;

create table public.push_subscriptions (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  endpoint text not null check(length(endpoint)<2048 and endpoint like 'https://%'),
  subscription jsonb not null check(octet_length(subscription::text)<8192),
  primary key(user_id,endpoint)
);
alter table public.push_subscriptions enable row level security;
create policy own_subscriptions on public.push_subscriptions for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
revoke all on public.push_subscriptions from anon;
grant select,insert,update,delete on public.push_subscriptions to authenticated;

create table public.push_delivery (
  user_id uuid not null references auth.users(id) on delete cascade,
  action_id text not null,
  endpoint text not null,
  next_send_at timestamptz not null,
  primary key(user_id,action_id,endpoint)
);
alter table public.push_delivery enable row level security;
revoke all on public.push_delivery from anon,authenticated;
create function public.claim_push(p_user uuid,p_action text,p_endpoint text,p_minutes integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  insert into public.push_delivery values(p_user,p_action,p_endpoint,now()+make_interval(mins=>greatest(15,p_minutes)))
  on conflict(user_id,action_id,endpoint) do update set next_send_at=excluded.next_send_at
  where public.push_delivery.next_send_at<=now();
  get diagnostics changed=row_count;
  return changed=1;
end $$;
revoke all on function public.claim_push(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.claim_push(uuid,text,text,integer) to service_role;

-- Cron installation is an explicit deployment step. Do not embed service keys here.
