-- Prepaid lesson hours are authoritative, global per canonical worker, and separate
-- from hourly payment allocation. No business records are migrated by this DDL.
begin;

create table app_private.house_prepaid_settings (
 worker_id text primary key,
 billing_mode text not null check(billing_mode in ('hourly','prepaid')),
 default_minutes integer not null check(default_minutes between 1 and 10000000),
 default_price_cents bigint not null check(default_price_cents between 1 and 10000000000000),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default clock_timestamp()
);
create table app_private.house_prepaid_packages (
 id uuid primary key,
 worker_id text not null references app_private.house_prepaid_settings(worker_id),
 payment_id text not null unique,
 capacity_minutes integer not null check(capacity_minutes between 1 and 10000000),
 price_cents bigint not null check(price_cents between 1 and 10000000000000),
 paid_date date not null,
 invoice_id text unique,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp()
);
create index house_prepaid_packages_worker_order on app_private.house_prepaid_packages(worker_id,paid_date,created_at,id);
create table app_private.house_prepaid_requests (
 actor_id uuid not null references auth.users(id), request_id uuid not null,
 request_hash text not null, action text not null,
 before_state jsonb not null, after_state jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_id)
);
create table app_private.house_prepaid_entry_audit (
 id bigint generated always as identity primary key,
 actor_id uuid references auth.users(id), entry_id text not null,
 before_entry jsonb, after_entry jsonb,
 created_at timestamptz not null default clock_timestamp()
);
alter table app_private.house_prepaid_settings enable row level security;
alter table app_private.house_prepaid_packages enable row level security;
alter table app_private.house_prepaid_requests enable row level security;
alter table app_private.house_prepaid_entry_audit enable row level security;
revoke all on app_private.house_prepaid_settings,app_private.house_prepaid_packages,
 app_private.house_prepaid_requests,app_private.house_prepaid_entry_audit from public,anon,authenticated;

create function app_private.house_prepaid_actor(p_write boolean default false,p_export boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select auth.uid() is not null and app_private.module_allowed('houseTracking',p_write)
 and (not p_export or app_private.module_allowed('houseTracking',false,'export'))
 and exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id');
$$;

-- One integer minute of teaching consumes one minute. Historical minute-level
-- times remain valid; new entry quarter-hour validation stays in the existing RPC.
create function app_private.house_prepaid_minutes(e jsonb) returns integer
language plpgsql immutable set search_path=pg_catalog as $$
declare a integer; b integer; pause numeric;
begin
 if coalesce(e->>'startTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
 or coalesce(e->>'endTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
 or coalesce(e->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
 or jsonb_typeof(coalesce(e->'breakMinutes','0'::jsonb)) <> 'number' then
  raise exception 'prepaid_invalid_intervention' using errcode='22023';
 end if;
 perform (e->>'date')::date;
 a:=split_part(e->>'startTime',':',1)::integer*60+split_part(e->>'startTime',':',2)::integer;
 b:=split_part(e->>'endTime',':',1)::integer*60+split_part(e->>'endTime',':',2)::integer;
 pause:=coalesce((e->>'breakMinutes')::numeric,0);
 if pause<0 or pause<>trunc(pause) or pause>1440 then raise exception 'prepaid_invalid_break' using errcode='22023'; end if;
 if b<a then b:=b+1440; end if;
 if pause>b-a then raise exception 'prepaid_invalid_break' using errcode='22023'; end if;
 return b-a-pause::integer;
end $$;

-- Half-open cumulative intervals make a course crossing packages unambiguous.
-- Round cumulative cent values, never an individual minute or quarter-hour rate.
create function app_private.house_prepaid_allocations(p_payload jsonb) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 with base as (
  select e, s.worker_id, s.default_minutes, s.default_price_cents,
   app_private.house_prepaid_minutes(e) minutes
  from jsonb_array_elements(coalesce(p_payload->'houseTimeEntries','[]')) e
  join app_private.house_prepaid_settings s on s.worker_id=e->>'workerId' and s.billing_mode='prepaid'
 ), entries as (
  select *, coalesce(sum(minutes) over(partition by worker_id order by e->>'date',e->>'startTime',coalesce(e->>'createdAt',''),e->>'id' rows between unbounded preceding and 1 preceding),0)::bigint range_start,
   sum(minutes) over(partition by worker_id order by e->>'date',e->>'startTime',coalesce(e->>'createdAt',''),e->>'id')::bigint range_end
  from base
 ), packages as (
  select p.*,coalesce(sum(capacity_minutes) over(partition by worker_id order by paid_date,created_at,id rows between unbounded preceding and 1 preceding),0)::bigint range_start,
   sum(capacity_minutes) over(partition by worker_id order by paid_date,created_at,id)::bigint range_end
  from app_private.house_prepaid_packages p
 ), portions as (
  select e.e->>'id' entry_id,p.id package_id,p.range_start package_start,p.price_cents,p.capacity_minutes,
   greatest(e.range_start,p.range_start) portion_start,least(e.range_end,p.range_end) portion_end
  from entries e join packages p on p.worker_id=e.worker_id and e.range_end>p.range_start and p.range_end>e.range_start
 ), portions_cost as (
  select *,portion_end-portion_start minutes,
   round((portion_end-package_start)::numeric*price_cents/capacity_minutes)::bigint
   -round((portion_start-package_start)::numeric*price_cents/capacity_minutes)::bigint cents
  from portions
 ), results as (
  select e.*,coalesce((select sum(capacity_minutes) from app_private.house_prepaid_packages p where p.worker_id=e.worker_id),0)::bigint bought,
   coalesce((select sum(p.minutes) from portions_cost p where p.entry_id=e.e->>'id'),0)::bigint covered,
   coalesce((select sum(p.cents) from portions_cost p where p.entry_id=e.e->>'id'),0)::bigint covered_cents,
   coalesce((select jsonb_agg(jsonb_build_object('packageId',p.package_id,'minutes',p.minutes,'amountCents',p.cents) order by p.package_start,p.package_id) from portions_cost p where p.entry_id=e.e->>'id'),'[]') parts
  from entries e
 ), valued as (
  select *,round(greatest(range_end-bought,0)::numeric*default_price_cents/default_minutes)::bigint
   -round(greatest(range_start-bought,0)::numeric*default_price_cents/default_minutes)::bigint uncovered_cents
  from results
 )
 select coalesce(jsonb_agg(jsonb_build_object('entryId',e->>'id','workerId',worker_id,'minutes',minutes,
  'coveredMinutes',covered,'uncoveredMinutes',minutes-covered,'coveredCents',covered_cents,
  'uncoveredCents',uncovered_cents,'amountCents',covered_cents+uncovered_cents,'allocations',parts)
  order by e->>'date',e->>'startTime',coalesce(e->>'createdAt',''),e->>'id'),'[]') from valued;
$$;

create function app_private.house_prepaid_snapshot(p_payload jsonb) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 with settings as (
  select coalesce(jsonb_agg(jsonb_build_object('workerId',worker_id,'billingMode',billing_mode,
   'defaultMinutes',default_minutes,'defaultPriceCents',default_price_cents) order by worker_id),'[]') rows from app_private.house_prepaid_settings
 ), packages as (
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'workerId',worker_id,'paymentId',payment_id,
   'capacityMinutes',capacity_minutes,'priceCents',price_cents,'paidDate',paid_date,'invoiceId',invoice_id,
   'createdAt',created_at) order by paid_date,created_at,id),'[]') rows from app_private.house_prepaid_packages
 ), allocations as (select app_private.house_prepaid_allocations(p_payload) rows), summaries as (
  select coalesce(jsonb_agg(jsonb_build_object('workerId',s.worker_id,'purchasedMinutes',p.minutes,
   'performedMinutes',e.minutes,'coveredMinutes',least(p.minutes,e.minutes),'availableMinutes',greatest(p.minutes-e.minutes,0),
   'uncoveredMinutes',greatest(e.minutes-p.minutes,0),'paidCents',p.cents) order by s.worker_id),'[]') rows
  from app_private.house_prepaid_settings s
  cross join lateral(select coalesce(sum(capacity_minutes),0) minutes,coalesce(sum(price_cents),0) cents from app_private.house_prepaid_packages where worker_id=s.worker_id) p
  cross join lateral(select coalesce(sum((a->>'minutes')::bigint),0) minutes from allocations,jsonb_array_elements(allocations.rows) a where a->>'workerId'=s.worker_id) e
  where s.billing_mode='prepaid'
 ) select jsonb_build_object('settings',settings.rows,'packages',packages.rows,'allocations',allocations.rows,'summaries',summaries.rows,
  'revision',md5(jsonb_build_array(settings.rows,packages.rows,p_payload->'houseTrackingWorkers',p_payload->'houseTimeEntries',p_payload->'housePayments',p_payload->'vendorInvoices')::text))
 from settings,packages,allocations,summaries;
$$;

-- The settings/packages tables own all derived financial fields. Whole-workspace
-- saves and restricted partial patches cannot forge them or erase hidden links.
create function app_private.guard_house_prepaid() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
#variable_conflict use_column
declare p app_private.house_prepaid_packages%rowtype; r jsonb; oldr jsonb; payment jsonb;
 s app_private.house_prepaid_settings%rowtype; allocation jsonb; allocations jsonb; rows jsonb:='[]';
begin
 if new.workspace_id<>'oneaddress-riviera' then return new; end if;
 for p in select * from app_private.house_prepaid_packages loop
  if (select count(*) from jsonb_array_elements(coalesce(new.payload->'housePayments','[]')) x where x->>'id'=p.payment_id)<>1 then
   raise exception 'prepaid_reserved_payment_required' using errcode='23503';
  end if;
  select x into payment from jsonb_array_elements(new.payload->'housePayments') x where x->>'id'=p.payment_id;
  if payment->>'workerId' is distinct from p.worker_id or jsonb_typeof(payment->'amount') is distinct from 'number'
   or (payment->>'amount')::numeric*100<>p.price_cents or (payment->>'date')::date is distinct from p.paid_date then
   raise exception 'prepaid_reserved_payment_mismatch' using errcode='23514';
  end if;
  if p.invoice_id is not null then
   select x into r from jsonb_array_elements(coalesce(new.payload->'vendorInvoices','[]')) x where x->>'id'=p.invoice_id;
   select x into oldr from jsonb_array_elements(coalesce(new.payload->'houseTrackingWorkers','[]')) x where x->>'id'=p.worker_id;
   if r is null or jsonb_typeof(r->'amount') is distinct from 'number' or (r->>'amount')::numeric*100<>p.price_cents or coalesce(oldr->>'contactId','')='' or r->>'contactId' is distinct from oldr->>'contactId'
    or coalesce(r->>'status','') not in ('À payer','Partiellement payé','Payé','En retard') then raise exception 'prepaid_linked_invoice_mismatch' using errcode='23514'; end if;
  end if;
 end loop;
 for s in select * from app_private.house_prepaid_settings loop
  if (select count(*) from jsonb_array_elements(coalesce(new.payload->'houseTrackingWorkers','[]')) x where x->>'id'=s.worker_id)<>1 then
   -- Explicitly choosing hourly mode must not disable the existing permanent
   -- removal of a worker with no history. Journals remain durable independently.
   if not exists(select 1 from jsonb_array_elements(coalesce(new.payload->'houseTrackingWorkers','[]')) x where x->>'id'=s.worker_id)
    and not exists(select 1 from app_private.house_prepaid_packages p where p.worker_id=s.worker_id)
    and not exists(select 1 from jsonb_array_elements(coalesce(new.payload->'houseTimeEntries','[]')||coalesce(new.payload->'housePayments','[]')) x where x->>'workerId'=s.worker_id)
    and (TG_OP<>'UPDATE' or not exists(select 1 from jsonb_array_elements(coalesce(old.payload->'houseTimeEntries','[]')||coalesce(old.payload->'housePayments','[]')) x where x->>'workerId'=s.worker_id)) then
    delete from app_private.house_prepaid_settings target where target.worker_id=s.worker_id;
   else
    raise exception 'prepaid_worker_required' using errcode='23503';
   end if;
  end if;
 end loop;
 select coalesce(jsonb_agg((x-'billingMode'-'prepaidDefaultMinutes'-'prepaidDefaultPriceCents')||
  case when s.worker_id is null then '{}'::jsonb else jsonb_build_object('billingMode',s.billing_mode,'prepaidDefaultMinutes',s.default_minutes,'prepaidDefaultPriceCents',s.default_price_cents) end order by n.ord),'[]') into rows
 from jsonb_array_elements(coalesce(new.payload->'houseTrackingWorkers','[]')) with ordinality n(x,ord) left join app_private.house_prepaid_settings s on s.worker_id=x->>'id';
 new.payload:=jsonb_set(new.payload,'{houseTrackingWorkers}',rows);
 if exists(select 1 from jsonb_array_elements(coalesce(new.payload->'houseTimeEntries','[]')) x
  where exists(select 1 from jsonb_array_elements(coalesce(new.payload->'houseTimeEntries','[]')) q join app_private.house_prepaid_settings s on s.worker_id=q->>'workerId' and s.billing_mode='prepaid' where q->>'id'=x->>'id')
  group by x->>'id' having count(*)<>1)
 then raise exception 'prepaid_duplicate_intervention' using errcode='23514'; end if;
 allocations:=app_private.house_prepaid_allocations(new.payload);
 rows:='[]';
 for r in select * from jsonb_array_elements(coalesce(new.payload->'houseTimeEntries','[]')) loop
  select x into allocation from jsonb_array_elements(allocations) x where x->>'entryId'=r->>'id';
  oldr:=null;
  if TG_OP='UPDATE' then select x into oldr from jsonb_array_elements(coalesce(old.payload->'houseTimeEntries','[]')) x where x->>'id'=r->>'id'; end if;
  if oldr->>'billingMode'='prepaid' and oldr->>'workerId' is distinct from r->>'workerId' then raise exception 'prepaid_intervention_worker_locked' using errcode='23514'; end if;
  r:=r-'billingMode'-'prepaid';
  if allocation is not null then r:=r||jsonb_build_object('billingMode','prepaid','prepaid',allocation-'entryId'-'workerId'-'allocations'); end if;
  rows:=rows||jsonb_build_array(r);
  if TG_OP='UPDATE' and (allocation is not null or oldr->>'billingMode'='prepaid') and r is distinct from oldr then
   insert into app_private.house_prepaid_entry_audit(actor_id,entry_id,before_entry,after_entry) values(auth.uid(),r->>'id',oldr,r);
  end if;
 end loop;
 if TG_OP='UPDATE' then
  insert into app_private.house_prepaid_entry_audit(actor_id,entry_id,before_entry,after_entry)
  select auth.uid(),o->>'id',o,null from jsonb_array_elements(coalesce(old.payload->'houseTimeEntries','[]')) o
  where o->>'billingMode'='prepaid' and not exists(select 1 from jsonb_array_elements(rows) n where n->>'id'=o->>'id');
 end if;
 new.payload:=jsonb_set(new.payload,'{houseTimeEntries}',rows);
 select coalesce(jsonb_agg((x-'prepaidPackageId')||case when p.id is null then '{}'::jsonb else jsonb_build_object('prepaidPackageId',p.id) end order by n.ord),'[]') into rows
 from jsonb_array_elements(coalesce(new.payload->'housePayments','[]')) with ordinality n(x,ord) left join app_private.house_prepaid_packages p on p.payment_id=x->>'id';
 new.payload:=jsonb_set(new.payload,'{housePayments}',rows);
 select coalesce(jsonb_agg((x-'prepaidPackageId')||case when p.id is null then '{}'::jsonb else jsonb_build_object('prepaidPackageId',p.id) end order by n.ord),'[]') into rows
 from jsonb_array_elements(coalesce(new.payload->'vendorInvoices','[]')) with ordinality n(x,ord) left join app_private.house_prepaid_packages p on p.invoice_id=x->>'id';
 new.payload:=jsonb_set(new.payload,'{vendorInvoices}',rows);
 return new;
end $$;
create trigger crm_guard_house_prepaid before insert or update of payload on public.crm_workspace_state
for each row execute function app_private.guard_house_prepaid();

-- Additional projection fields are reset by the authoritative trigger on writes.
update app_private.module_collections set fields=fields||'{"billingMode":{"type":"string","label":"Mode de suivi"},"prepaidDefaultMinutes":{"type":"number","label":"Volume du forfait (minutes)"},"prepaidDefaultPriceCents":{"type":"number","label":"Prix du forfait (centimes)"}}'::jsonb where collection='houseTrackingWorkers';
update app_private.module_collections set fields=fields||'{"billingMode":{"type":"string","label":"Mode de suivi"}}'::jsonb where collection='houseTimeEntries';
update app_private.module_collections set fields=fields||'{"prepaidPackageId":{"type":"string","label":"Forfait prépayé"}}'::jsonb where collection='housePayments';
update app_private.module_collections set fields=fields||'{"prepaidPackageId":{"type":"string","label":"Forfait prépayé","requires":"houseTracking"}}'::jsonb where collection='vendorInvoices';

create function public.crm_house_prepaid_state(p_export boolean default false) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare w public.crm_workspace_state%rowtype; result jsonb;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if p_export is null or not app_private.house_prepaid_actor(false,p_export) then raise exception 'module_forbidden' using errcode='42501'; end if;
 select * into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera';
 result:=app_private.house_prepaid_snapshot(w.payload);
 -- No record/name data from other modules is returned; package invoice links
 -- remain stored even when a caller may not read the supplier-invoice module.
 if not app_private.module_allowed('vendorInvoices',false,case when p_export then 'export' else null end) then
  result:=jsonb_set(result,'{packages}',(select coalesce(jsonb_agg(p-'invoiceId'),'[]') from jsonb_array_elements(result->'packages') p));
 end if;
 return result||jsonb_build_object('complete',true,'canContribute',app_private.house_prepaid_actor(true,false),'workspaceRevision',case when app_private.full_access() then w.updated_at::text else null end);
end $$;

create function public.crm_save_house_prepaid(p_revision text,p_request_id uuid,p_action text,p_patch jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
#variable_conflict use_variable
declare w public.crm_workspace_state%rowtype; before_state jsonb; after_state jsonb; prior_hash text; request_hash text;
 worker jsonb; payment jsonb; invoice jsonb; pkg app_private.house_prepaid_packages%rowtype; settings app_private.house_prepaid_settings%rowtype;
 minutes numeric; cents numeric; worker_id text; payment_id text; v_invoice_id text; mode text; rows jsonb;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.house_prepaid_actor(true,false) then raise exception 'module_forbidden' using errcode='42501'; end if;
 if p_revision is null or p_request_id is null or p_action is null or p_action not in ('settings','package','link_invoice') or p_patch is null or jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>32000 then raise exception 'invalid_prepaid_request' using errcode='22023'; end if;
 select * into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
 before_state:=app_private.house_prepaid_snapshot(w.payload);
 request_hash:=md5(jsonb_build_array(p_action,p_patch)::text);
 select r.request_hash into prior_hash from app_private.house_prepaid_requests r where r.actor_id=auth.uid() and r.request_id=p_request_id;
 if found then
  if prior_hash<>request_hash then raise exception 'prepaid_request_reused' using errcode='22023'; end if;
  return public.crm_house_prepaid_state();
 end if;
 if p_revision is distinct from before_state->>'revision' then raise exception 'revision_conflict' using errcode='40001'; end if;
 worker_id:=p_patch->>'workerId';
 if p_action='link_invoice' then
  select * into pkg from app_private.house_prepaid_packages p where p.id=(p_patch->>'packageId')::uuid;
  if not found then raise exception 'prepaid_package_missing'; end if;
  if p_patch?'workerId' and p_patch->>'workerId' is distinct from pkg.worker_id then raise exception 'prepaid_package_worker_mismatch' using errcode='23514'; end if;
  worker_id:=pkg.worker_id;
 end if;
 select x into worker from jsonb_array_elements(coalesce(w.payload->'houseTrackingWorkers','[]')) x where x->>'id'=worker_id;
 if worker is null or worker->>'status'='Inactif' then raise exception 'prepaid_worker_missing_or_inactive' using errcode='23503'; end if;
 if p_action='settings' then
  if p_patch-array['workerId','billingMode','defaultMinutes','defaultPriceCents']<>'{}'
   or jsonb_typeof(p_patch->'defaultMinutes') is distinct from 'number' or jsonb_typeof(p_patch->'defaultPriceCents') is distinct from 'number'
   or coalesce(p_patch->>'billingMode','') not in ('hourly','prepaid') then raise exception 'invalid_prepaid_settings' using errcode='22023'; end if;
  minutes:=(p_patch->>'defaultMinutes')::numeric; cents:=(p_patch->>'defaultPriceCents')::numeric; mode:=p_patch->>'billingMode';
  if minutes<>trunc(minutes) or minutes not between 1 and 10000000 or cents<>trunc(cents) or cents not between 1 and 10000000000000 then raise exception 'invalid_prepaid_settings' using errcode='22023'; end if;
  if mode='hourly' and exists(select 1 from app_private.house_prepaid_packages where house_prepaid_packages.worker_id=worker_id) then raise exception 'prepaid_history_requires_mode' using errcode='23514'; end if;
  insert into app_private.house_prepaid_settings(worker_id,billing_mode,default_minutes,default_price_cents,updated_by)
   values(worker_id,mode,minutes::integer,cents::bigint,auth.uid())
   on conflict on constraint house_prepaid_settings_pkey do update set billing_mode=excluded.billing_mode,default_minutes=excluded.default_minutes,default_price_cents=excluded.default_price_cents,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 elsif p_action='package' then
  if p_patch-array['workerId','capacityMinutes','priceCents','paymentId','payment','invoiceId']<>'{}'
   or jsonb_typeof(p_patch->'capacityMinutes') is distinct from 'number' or jsonb_typeof(p_patch->'priceCents') is distinct from 'number'
   or (p_patch?'paymentId')=(p_patch?'payment') then raise exception 'invalid_prepaid_package' using errcode='22023'; end if;
  select * into settings from app_private.house_prepaid_settings s where s.worker_id=worker_id;
  if settings.billing_mode is distinct from 'prepaid' then raise exception 'prepaid_mode_required'; end if;
  minutes:=(p_patch->>'capacityMinutes')::numeric; cents:=(p_patch->>'priceCents')::numeric;
  if minutes<>trunc(minutes) or minutes not between 1 and 10000000 or cents<>trunc(cents) or cents not between 1 and 10000000000000 then raise exception 'invalid_prepaid_package' using errcode='22023'; end if;
  if p_patch?'paymentId' then
   payment_id:=p_patch->>'paymentId';
   if (select count(*) from jsonb_array_elements(coalesce(w.payload->'housePayments','[]')) x where x->>'id'=payment_id)<>1 then raise exception 'prepaid_payment_missing' using errcode='23503'; end if;
   select x into payment from jsonb_array_elements(w.payload->'housePayments') x where x->>'id'=payment_id;
   if payment->>'workerId' is distinct from worker_id or jsonb_typeof(payment->'amount') is distinct from 'number' or (payment->>'amount')::numeric*100<>cents then raise exception 'prepaid_payment_mismatch' using errcode='23514'; end if;
  else
   payment:=p_patch->'payment'; payment_id:=payment->>'id';
   if coalesce(payment->>'note','')<>'' and not app_private.full_access() then raise exception 'notes_forbidden' using errcode='42501'; end if;
   if jsonb_typeof(payment) is distinct from 'object' or payment-array['id','houseId','date','method','note']<>'{}'
    or coalesce(payment_id,'') !~ '^[A-Za-z0-9_-]{1,120}$' or coalesce(payment->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(payment->>'method','') not in ('Virement','Espèces','CB','Chèque','Autre') or length(coalesce(payment->>'note',''))>4000
    then raise exception 'invalid_prepaid_payment' using errcode='22023'; end if;
   perform (payment->>'date')::date;
   if not exists(select 1 from jsonb_array_elements(coalesce(w.payload->'houseTrackingHouses','[]')) x where x->>'id'=payment->>'houseId') then raise exception 'prepaid_house_missing' using errcode='23503'; end if;
   if exists(select 1 from jsonb_array_elements(coalesce(w.payload->'housePayments','[]')) x where x->>'id'=payment_id) then raise exception 'prepaid_payment_exists' using errcode='23505'; end if;
   payment:=payment||jsonb_build_object('workerId',worker_id,'workerName',coalesce(worker->>'contactName',''),
    'houseName',(select x->>'name' from jsonb_array_elements(w.payload->'houseTrackingHouses') x where x->>'id'=payment->>'houseId'),
    'amount',cents/100,'createdAt',clock_timestamp(),'createdBy',auth.uid());
   w.payload:=jsonb_set(w.payload,'{housePayments}',coalesce(w.payload->'housePayments','[]')||jsonb_build_array(payment));
  end if;
  insert into app_private.house_prepaid_packages(id,worker_id,payment_id,capacity_minutes,price_cents,paid_date,created_by)
   values(p_request_id,worker_id,payment_id,minutes::integer,cents::bigint,(payment->>'date')::date,auth.uid()) returning * into pkg;
 end if;
 v_invoice_id:=nullif(p_patch->>'invoiceId','');
 if p_action='link_invoice' and (p_patch-array['workerId','packageId','invoiceId']<>'{}' or v_invoice_id is null) then raise exception 'invalid_prepaid_invoice_link' using errcode='22023'; end if;
 if p_action in ('package','link_invoice') and v_invoice_id is not null then
  if not app_private.module_allowed('vendorInvoices',true) then raise exception 'invoice_link_forbidden' using errcode='42501'; end if;
  select x into invoice from jsonb_array_elements(coalesce(w.payload->'vendorInvoices','[]')) x where x->>'id'=v_invoice_id;
  if invoice is null or coalesce(worker->>'contactId','')='' or invoice->>'contactId' is distinct from worker->>'contactId'
   or jsonb_typeof(invoice->'amount') is distinct from 'number' or (invoice->>'amount')::numeric*100<>pkg.price_cents
   or coalesce(invoice->>'status','') not in ('À payer','Partiellement payé','Payé','En retard') then raise exception 'prepaid_invoice_mismatch' using errcode='23514'; end if;
  if pkg.invoice_id is not null and pkg.invoice_id<>v_invoice_id then raise exception 'prepaid_invoice_already_linked'; end if;
  update app_private.house_prepaid_packages set invoice_id=v_invoice_id where id=pkg.id;
 end if;
 -- This one row lock serializes changes with all existing CRM mutations. The
 -- trigger recomputes the entire worker ledger and records changed allocations.
 update public.crm_workspace_state set payload=w.payload,updated_by=auth.uid() where workspace_id=w.workspace_id;
 select * into strict w from public.crm_workspace_state where workspace_id=w.workspace_id;
 after_state:=app_private.house_prepaid_snapshot(w.payload);
 insert into app_private.house_prepaid_requests(actor_id,request_id,request_hash,action,before_state,after_state)
  values(auth.uid(),p_request_id,request_hash,p_action,before_state,after_state);
 return public.crm_house_prepaid_state();
end $$;

-- Keep the current source filtering, periods, assignments and permission checks.
-- Add the authoritative allocation only after the original allowed projection.
alter function public.crm_read_monthly_charges(boolean,text[]) rename to crm_read_monthly_charges_before_prepaid;
create function public.crm_read_monthly_charges(p_export boolean default false,p_sources text[] default array['invoice','hours']) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb; w jsonb; allocations jsonb; rows jsonb;
begin
 result:=public.crm_read_monthly_charges_before_prepaid(p_export,p_sources);
 select payload into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera';
 allocations:=app_private.house_prepaid_allocations(w);
 select coalesce(jsonb_agg(e||case when a is null then '{}'::jsonb else jsonb_build_object('billingMode','prepaid','prepaid',a-'entryId'-'workerId'-'allocations') end order by n.ord),'[]') into rows
 from jsonb_array_elements(result->'sources'->'timeEntries') with ordinality n(e,ord) left join jsonb_array_elements(allocations) a on a->>'entryId'=e->>'id';
 result:=jsonb_set(result,'{sources,timeEntries}',rows);
 select coalesce(jsonb_agg(e||case when p.id is null then '{}'::jsonb else jsonb_build_object('prepaidPackageId',p.id,'economicSource','prepaid_consumption') end order by n.ord),'[]') into rows
 from jsonb_array_elements(result->'sources'->'invoices') with ordinality n(e,ord) left join app_private.house_prepaid_packages p on p.invoice_id=e->>'id';
 result:=jsonb_set(result,'{sources,invoices}',rows);
 return result||jsonb_build_object('sourceRevision',md5((result->'sources')::text));
end $$;

-- The normal restricted module projection must carry its globally valued hours
-- too; it must never fall back to a legacy rate or to a filtered partial balance.
alter function public.crm_read_module(text) rename to crm_read_module_before_prepaid;
create function public.crm_read_module(p_module text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb; w jsonb; allocations jsonb; rows jsonb;
begin
 result:=public.crm_read_module_before_prepaid(p_module);
 if p_module<>'houseTracking' then return result; end if;
 select payload into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera';
 allocations:=app_private.house_prepaid_allocations(w);
 select coalesce(jsonb_agg(e||case when a is null then '{}'::jsonb else jsonb_build_object('billingMode','prepaid','prepaid',a-'entryId'-'workerId'-'allocations') end order by n.ord),'[]') into rows
 from jsonb_array_elements(result->'collections'->'houseTimeEntries') with ordinality n(e,ord)
 left join jsonb_array_elements(allocations) a on a->>'entryId'=e->>'id';
 return jsonb_set(result,'{collections,houseTimeEntries}',rows);
end $$;

-- Generic Personnel export uses the same globally complete ledger and existing
-- export permission. Historical hourly rates are explicitly provenance only.
alter function public.crm_export_module(text) rename to crm_export_module_before_prepaid;
create function public.crm_export_module(p_module text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb; ledger jsonb; rows jsonb;
begin
 result:=public.crm_export_module_before_prepaid(p_module);
 if p_module<>'houseTracking' then return result; end if;
 ledger:=public.crm_house_prepaid_state(true);
 select coalesce(jsonb_agg(case when a is null then e else (e-'hourlyRate')||jsonb_build_object(
  'billingMode','prepaid','legacyHourlyRate',e->'hourlyRate','prepaidMinutes',a->'minutes',
  'prepaidCoveredMinutes',a->'coveredMinutes','prepaidUncoveredMinutes',a->'uncoveredMinutes',
  'prepaidCoveredCents',a->'coveredCents','prepaidUncoveredIndicativeCents',a->'uncoveredCents',
  'prepaidAmountCents',a->'amountCents') end order by n.ord),'[]') into rows
 from jsonb_array_elements(result->'collections'->'houseTimeEntries') with ordinality n(e,ord)
 left join jsonb_array_elements(ledger->'allocations') a on a->>'entryId'=e->>'id';
 result:=jsonb_set(result,'{collections,houseTimeEntries}',rows);
 return result||jsonb_build_object('prepaidLedger',ledger);
end $$;

-- The existing scalar-only projection omits nested values. The dedicated ledger
-- supplies their full globally computed allocation to restricted Personnel UI.
revoke all on function app_private.house_prepaid_actor(boolean,boolean),app_private.house_prepaid_minutes(jsonb),
 app_private.house_prepaid_allocations(jsonb),app_private.house_prepaid_snapshot(jsonb),app_private.guard_house_prepaid()
 from public,anon,authenticated;
revoke all on function public.crm_house_prepaid_state(boolean),public.crm_save_house_prepaid(text,uuid,text,jsonb),
 public.crm_read_monthly_charges_before_prepaid(boolean,text[]),public.crm_read_monthly_charges(boolean,text[]) from public,anon,authenticated;
revoke all on function public.crm_export_module_before_prepaid(text),public.crm_export_module(text) from public,anon,authenticated;
revoke all on function public.crm_read_module_before_prepaid(text),public.crm_read_module(text) from public,anon,authenticated;
grant execute on function public.crm_house_prepaid_state(boolean),public.crm_save_house_prepaid(text,uuid,text,jsonb),public.crm_read_monthly_charges(boolean,text[]),public.crm_export_module(text),public.crm_read_module(text) to authenticated;
notify pgrst,'reload schema';
commit;
