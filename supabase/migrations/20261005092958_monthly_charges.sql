-- Charges is an additive shared configuration. No sources, real grants or historical data are changed.
-- Local review only: remote application requires separate publication approval.
begin;
alter table public.crm_module_grants drop constraint crm_module_grants_module_check;
alter table public.crm_module_grants add constraint crm_module_grants_module_check
 check(module in ('dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','monthlyCharges','documents','planning','properties','vehicles','boats','izord','publisher'));
create or replace function app_private.module_allowed(p_module text,p_write boolean default false,p_sensitive text default null) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select auth.uid() is not null and p_write is not null
 and p_module=any(array['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','izord','publisher','monthlyCharges'])
 and (p_sensitive is null or case when p_module='monthlyCharges' then p_sensitive='export' when p_module='publisher' then p_sensitive=any(array['export','generate','mark_published']) else p_sensitive=any(array['delete','export','bank_read','bank_write','payment']) end)
 and exists(select 1 from public.crm_access_profiles p join public.crm_module_grants g using(user_id)
 where p.user_id=auth.uid() and p.active and g.module=p_module
 and g.level=any(case when p_write or p_sensitive in ('delete','bank_write','payment','generate','mark_published') then array['contribute'] else array['read','contribute'] end)
 and (p_module='publisher' or exists(select 1 from public.app_memberships m where m.user_id=p.user_id
 and m.workspace_id=case when p_module='izord' then 'izord' else 'oar' end and m.status='active'))
 and (p_sensitive is null or g.sensitive->p_sensitive='true'::jsonb));
$$;

create or replace function app_private.full_access() returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.general_admin() and not exists(select 1 from unnest(array['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats']) m where not app_private.module_allowed(m,true))
 and app_private.module_allowed('documents',true,'export') and app_private.module_allowed('contacts',true,'bank_read')
 and app_private.module_allowed('contacts',true,'bank_write') and app_private.module_allowed('vendorInvoices',true,'payment')
 and not exists(select 1 from public.crm_module_grants where user_id=auth.uid() and module not in ('izord','publisher','monthlyCharges') and (sensitive->'delete' is distinct from 'true'::jsonb or sensitive->'export' is distinct from 'true'::jsonb));
$$;

create or replace function app_private.validate_grants(p_grants jsonb) returns void language plpgsql set search_path=pg_catalog as $$
declare g record; s record;
begin
 if p_grants is null or jsonb_typeof(p_grants)<>'object' then raise exception 'invalid_grants'; end if;
 for g in select * from jsonb_each(p_grants) loop
 if g.key<>all(array['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','izord','publisher','monthlyCharges'])
 or jsonb_typeof(g.value)<>'object' or g.value-array['level','sensitive']<>'{}' or jsonb_typeof(g.value->'level') is distinct from 'string' or g.value->>'level' not in ('none','read','contribute') or not(g.value?'level') or jsonb_typeof(coalesce(g.value->'sensitive','{}'))<>'object' then raise exception 'invalid_grants'; end if;
 for s in select * from jsonb_each(coalesce(g.value->'sensitive','{}')) loop
 if s.key<>all(array['delete','export','bank_read','bank_write','payment','generate','mark_published']) or jsonb_typeof(s.value)<>'boolean' then raise exception 'invalid_sensitive'; end if;
 if (g.key='monthlyCharges' and s.key<>'export') or (g.key='publisher' and s.key not in ('export','generate','mark_published')) or (g.key<>'publisher' and s.key in ('generate','mark_published')) then raise exception 'invalid_module_sensitive'; end if;
 if s.value='true' then
 if g.value->>'level'='none' or (s.key in ('delete','bank_write','payment','generate','mark_published') and g.value->>'level'<>'contribute') or (s.key in ('bank_read','bank_write') and g.key<>'contacts') or (s.key='payment' and g.key<>'vendorInvoices') then raise exception 'sensitive_prerequisite'; end if;
 if s.key='bank_write' and g.value->'sensitive'->'bank_read' is distinct from 'true'::jsonb then raise exception 'bank_read_required'; end if;
 if s.key='payment' and (p_grants->'contacts'->'sensitive'->'bank_read' is distinct from 'true'::jsonb or p_grants->'contacts'->>'level' not in ('read','contribute')) then raise exception 'bank_read_required'; end if;
 end if;
 end loop;
 end loop;
end $$;

-- Private configuration only. Neither the table nor its author/request history is an API.
create table app_private.monthly_charges_config (
 workspace_id text primary key check(workspace_id='oneaddress-riviera'),
 revision uuid not null default gen_random_uuid(),
 config jsonb not null default '{"personRules":[],"exceptions":[],"attachments":[]}',
 updated_by uuid references auth.users(id), updated_at timestamptz not null default clock_timestamp(),
 check(jsonb_typeof(config)='object')
);
create table app_private.monthly_charges_requests (
 actor_id uuid not null references auth.users(id), request_id uuid not null,
 patch_hash text not null, result_revision uuid not null,
 created_at timestamptz not null default clock_timestamp(), primary key(actor_id,request_id)
);
alter table app_private.monthly_charges_config enable row level security;
alter table app_private.monthly_charges_requests enable row level security;
revoke all on app_private.monthly_charges_config,app_private.monthly_charges_requests from public,anon,authenticated;
insert into app_private.monthly_charges_config(workspace_id) values('oneaddress-riviera');

create function app_private.monthly_charges_actor() returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select auth.uid() is not null and app_private.module_allowed('monthlyCharges')
 and exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id');
$$;

create function public.crm_read_monthly_charges(p_export boolean default false,p_sources text[] default array['invoice','hours']) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare w jsonb; c app_private.monthly_charges_config%rowtype; contacts boolean;
 readable text[]:='{}'; exportable text[]:='{}'; source text; source_module text;
 invoices jsonb:='[]'; entries jsonb:='[]'; suppliers jsonb:='[]'; workers jsonb:='[]'; houses jsonb:='[]'; config jsonb:='{}'; rows jsonb; field text;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.monthly_charges_actor() then raise exception 'module_forbidden' using errcode='42501'; end if;
 if p_export is null or p_sources is null or cardinality(p_sources)>2 or exists(select 1 from unnest(p_sources) s where s is null or s not in ('invoice','hours')) then raise exception 'invalid_monthly_scope' using errcode='22023'; end if;
 if p_export and not app_private.module_allowed('monthlyCharges',false,'export') then raise exception 'export_forbidden' using errcode='42501'; end if;
 foreach source in array array['invoice','hours'] loop
  source_module:=case source when 'invoice' then 'vendorInvoices' else 'houseTracking' end;
  if source=any(p_sources) and app_private.module_allowed(source_module) then
   readable:=array_append(readable,source);
   if app_private.module_allowed(source_module,false,'export') then exportable:=array_append(exportable,source);
   elsif p_export then raise exception 'export_forbidden' using errcode='42501'; end if;
  end if;
 end loop;
 contacts:=app_private.module_allowed('contacts');
 select payload into w from public.crm_workspace_state where workspace_id='oneaddress-riviera';
 select * into strict c from app_private.monthly_charges_config where workspace_id='oneaddress-riviera';
 if 'invoice'=any(readable) then
  select coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','personId',coalesce(r->>'contactId',''),'personLabel',case when contacts then coalesce(nullif(r->>'contactName',''),'Fournisseur') else 'Fournisseur · '||coalesce(r->>'contactId','sans référence') end,'title',r->'title')
   ||(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(r) where key=any(array['invoiceReference','invoiceDate','amount','status']))),'[]') into invoices
   from jsonb_array_elements(coalesce(w->'vendorInvoices','[]')) r;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label) order by id),'[]') into suppliers from (
   select distinct on(id) id,label from (
    select r->>'contactId' id,case when contacts then coalesce(nullif(r->>'contactName',''),'Fournisseur') else 'Fournisseur · '||(r->>'contactId') end label,1 priority from jsonb_array_elements(coalesce(w->'vendorInvoices','[]')) r where coalesce(r->>'contactId','')<>''
    union all
    select r->>'id',coalesce(nullif(r->>'name',''),nullif(r->>'companyName',''),'Fournisseur'),0 from jsonb_array_elements(coalesce(w->'contacts','[]')) r where contacts and r->>'kind'='Prestataire'
   ) options order by id,priority
  ) deduplicated;
 end if;
 if 'hours'=any(readable) then
  select coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','personId',coalesce(r->>'workerId',''),'personLabel',case when contacts then coalesce(nullif(r->>'workerName',''),'Intervenant') else 'Intervenant · '||coalesce(r->>'workerId','sans référence') end)
   ||(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(r) where key=any(array['houseId','houseName','date','startTime','endTime','breakMinutes','hourlyRate']))),'[]') into entries
   from jsonb_array_elements(coalesce(w->'houseTimeEntries','[]')) r;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'status',status) order by id),'[]') into workers from (
   select distinct on(id) id,label,status from (
    select r->>'id' id,case when contacts then coalesce(nullif(r->>'contactName',''),'Intervenant') else 'Intervenant · '||(r->>'id') end label,r->'status' status,0 priority from jsonb_array_elements(coalesce(w->'houseTrackingWorkers','[]')) r
    union all
    select r->>'workerId',case when contacts then coalesce(nullif(r->>'workerName',''),'Intervenant') else 'Intervenant · '||(r->>'workerId') end,null::jsonb,1 from jsonb_array_elements(coalesce(w->'houseTimeEntries','[]')) r where coalesce(r->>'workerId','')<>''
   ) options order by id,priority
  ) deduplicated;
  select coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','name',r->'name')),'[]') into houses
   from jsonb_array_elements(coalesce(w->'houseTrackingHouses','[]')) r;
 end if;
 foreach field in array array['personRules','exceptions','attachments'] loop
  select coalesce(jsonb_agg(r),'[]') into rows from jsonb_array_elements(c.config->field) r where r->>'source'=any(readable);
  config:=config||jsonb_build_object(field,rows);
 end loop;
 return jsonb_build_object('revision',c.revision::text,'sourceRevision',md5(jsonb_build_array(invoices,entries,suppliers,workers,houses)::text),'config',config,
  'sources',jsonb_build_object('invoices',invoices,'timeEntries',entries,'suppliers',suppliers,'workers',workers,'houses',houses),
  'permissions',jsonb_build_object('canContribute',app_private.module_allowed('monthlyCharges',true),'readableSources',to_jsonb(readable),'exportableSources',to_jsonb(exportable),'contactsVisible',contacts));
end $$;

create function public.crm_patch_monthly_charges(p_revision text,p_patch jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare c app_private.monthly_charges_config%rowtype; w jsonb; request_hash text; prior_hash text;
 field text; op jsonb; source text; target text; next_config jsonb; rows jsonb; key_field text; target_exists boolean; removing boolean; span integer;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.monthly_charges_actor() or not app_private.module_allowed('monthlyCharges',true) then raise exception 'module_forbidden' using errcode='42501'; end if;
 if p_revision is null or p_request_id is null or p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch-array['personRules','exceptions','attachments']<>'{}' or octet_length(p_patch::text)>128000 then raise exception 'invalid_monthly_patch' using errcode='22023'; end if;
 select * into strict c from app_private.monthly_charges_config where workspace_id='oneaddress-riviera' for update;
 select payload into w from public.crm_workspace_state where workspace_id='oneaddress-riviera';
 next_config:=c.config;
 -- Validate every touched source and reference before idempotency, including after revocation.
 foreach field in array array['personRules','exceptions','attachments'] loop
  if not(p_patch?field) then continue; end if;
  if jsonb_typeof(p_patch->field)<>'array' or jsonb_array_length(p_patch->field)>1000 then raise exception 'invalid_monthly_patch' using errcode='22023'; end if;
  key_field:=case field when 'personRules' then 'personId' else 'sourceId' end;
  if exists(select 1 from jsonb_array_elements(p_patch->field) r group by r->>'source',r->>key_field having count(*)>1) then raise exception 'invalid_monthly_patch' using errcode='22023'; end if;
  for op in select * from jsonb_array_elements(p_patch->field) loop
   source:=op->>'source'; target:=op->>key_field;
   if jsonb_typeof(op)<>'object' or jsonb_typeof(op->'source') is distinct from 'string' or jsonb_typeof(op->key_field) is distinct from 'string' or source is null or source not in ('invoice','hours') or target is null or target !~ '^[A-Za-z0-9_-]{1,100}$' then raise exception 'invalid_monthly_patch' using errcode='22023'; end if;
   if not app_private.module_allowed(case source when 'invoice' then 'vendorInvoices' else 'houseTracking' end) then raise exception 'source_forbidden' using errcode='42501'; end if;
   if field='personRules' then
    if op-array['source','personId','included']<>'{}' or jsonb_typeof(op->'included') is distinct from 'boolean' then raise exception 'invalid_monthly_patch' using errcode='22023'; end if;
    removing:=op->'included'='false';
    target_exists:=case source when 'invoice' then exists(select 1 from jsonb_array_elements(coalesce(w->'vendorInvoices','[]')) r where r->>'contactId'=target) or (app_private.module_allowed('contacts') and exists(select 1 from jsonb_array_elements(coalesce(w->'contacts','[]')) r where r->>'id'=target and r->>'kind'='Prestataire'))
     else exists(select 1 from jsonb_array_elements(coalesce(w->'houseTrackingWorkers','[]')) r where r->>'id'=target) or exists(select 1 from jsonb_array_elements(coalesce(w->'houseTimeEntries','[]')) r where r->>'workerId'=target) end;
   elsif field='exceptions' then
    if op-array['source','sourceId','included','reason']<>'{}' or jsonb_typeof(op->'included') is null or jsonb_typeof(op->'included') not in ('boolean','null') or (op?'reason' and (jsonb_typeof(op->'reason')<>'string' or length(op->>'reason')>500)) then raise exception 'invalid_monthly_patch' using errcode='22023'; end if;
    removing:=op->'included'='null';
    target_exists:=exists(select 1 from jsonb_array_elements(coalesce(w->case source when 'invoice' then 'vendorInvoices' else 'houseTimeEntries' end,'[]')) r where r->>'id'=target);
   else
    if jsonb_typeof(op->'mode') is distinct from 'string' or source<>'invoice' or op-array['source','sourceId','mode','month','startMonth','endMonth']<>'{}' or op->>'mode' is null or op->>'mode' not in ('default','month','spread') then raise exception 'invalid_monthly_patch' using errcode='22023'; end if;
    removing:=op->>'mode'='default';
    if (removing and op-array['source','sourceId','mode']<>'{}') or (op->>'mode'='month' and (op-array['source','sourceId','mode','month']<>'{}' or jsonb_typeof(op->'month') is distinct from 'string' or coalesce(op->>'month','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or left(op->>'month',4)='0000')) or (op->>'mode'='spread' and (op-array['source','sourceId','mode','startMonth','endMonth']<>'{}' or jsonb_typeof(op->'startMonth') is distinct from 'string' or jsonb_typeof(op->'endMonth') is distinct from 'string' or coalesce(op->>'startMonth','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or coalesce(op->>'endMonth','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or left(op->>'startMonth',4)='0000' or left(op->>'endMonth',4)='0000')) then raise exception 'invalid_monthly_patch' using errcode='22023'; end if;
    if op->>'mode'='spread' then
     span:=((left(op->>'endMonth',4)::integer-left(op->>'startMonth',4)::integer)*12+right(op->>'endMonth',2)::integer-right(op->>'startMonth',2)::integer+1);
     if span<1 or span>12 then raise exception 'invalid_monthly_patch' using errcode='22023'; end if;
    end if;
    target_exists:=exists(select 1 from jsonb_array_elements(coalesce(w->'vendorInvoices','[]')) r where r->>'id'=target);
   end if;
   if not target_exists and not removing then raise exception 'invalid_monthly_reference' using errcode='22023'; end if;
   select coalesce(jsonb_agg(r),'[]') into rows from jsonb_array_elements(next_config->field) r where not(r->>'source'=source and r->>key_field=target);
   if not removing then rows:=rows||jsonb_build_array(op); end if;
   next_config:=jsonb_set(next_config,array[field],rows);
  end loop;
 end loop;
 request_hash:=md5(jsonb_build_array(p_revision,p_patch)::text);
 select patch_hash into prior_hash from app_private.monthly_charges_requests where actor_id=auth.uid() and request_id=p_request_id;
 if prior_hash is not null then
  if prior_hash<>request_hash then raise exception 'request_id_conflict' using errcode='40001'; end if;
  return public.crm_read_monthly_charges();
 end if;
 if p_revision is distinct from c.revision::text then raise exception 'revision_conflict' using errcode='40001'; end if;
 update app_private.monthly_charges_config set config=next_config,revision=gen_random_uuid(),updated_by=auth.uid(),updated_at=clock_timestamp() where workspace_id=c.workspace_id returning revision into c.revision;
 insert into app_private.monthly_charges_requests(actor_id,request_id,patch_hash,result_revision) values(auth.uid(),p_request_id,request_hash,c.revision);
 return public.crm_read_monthly_charges();
end $$;

revoke all on function app_private.monthly_charges_actor(),public.crm_read_monthly_charges(boolean,text[]),public.crm_patch_monthly_charges(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.crm_read_monthly_charges(boolean,text[]),public.crm_patch_monthly_charges(text,jsonb,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
