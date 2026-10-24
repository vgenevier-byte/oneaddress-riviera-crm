-- Add independent invoice-house assignments to the existing private Charges
-- configuration. No invoice, payment, hour or historical selection is rewritten.
begin;

create or replace function public.crm_read_monthly_charges(p_export boolean default false,p_sources text[] default array['invoice','hours']) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare w jsonb; c app_private.monthly_charges_config%rowtype; contacts boolean; houses_visible boolean;
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
 houses_visible:=app_private.module_allowed('houseTracking') and (not p_export or app_private.module_allowed('houseTracking',false,'export'));
 select payload into w from public.crm_workspace_state where workspace_id='oneaddress-riviera';
 select * into strict c from app_private.monthly_charges_config where workspace_id='oneaddress-riviera';
 if 'invoice'=any(readable) then
  select coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','personId',coalesce(r->>'contactId',''),'personLabel',case when contacts then coalesce(nullif(r->>'contactName',''),'Fournisseur') else 'Fournisseur · '||coalesce(r->>'contactId','sans référence') end,'title',r->'title')
   ||case when exists(select 1 from jsonb_array_elements(coalesce(c.config->'houseAssignments','[]')) a where a->>'source'='invoice' and a->>'sourceId'=r->>'id') then jsonb_build_object('houseAssigned',true) else '{}'::jsonb end
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
   ||(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(r) where key=any(array['houseId','houseName','date','startTime','endTime','breakMinutes','hourlyRate','expenseAmount']))),'[]') into entries
   from jsonb_array_elements(coalesce(w->'houseTimeEntries','[]')) r;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'status',status) order by id),'[]') into workers from (
   select distinct on(id) id,label,status from (
    select r->>'id' id,case when contacts then coalesce(nullif(r->>'contactName',''),'Intervenant') else 'Intervenant · '||(r->>'id') end label,r->'status' status,0 priority from jsonb_array_elements(coalesce(w->'houseTrackingWorkers','[]')) r
    union all
    select r->>'workerId',case when contacts then coalesce(nullif(r->>'workerName',''),'Intervenant') else 'Intervenant · '||(r->>'workerId') end,null::jsonb,1 from jsonb_array_elements(coalesce(w->'houseTimeEntries','[]')) r where coalesce(r->>'workerId','')<>''
   ) options order by id,priority
  ) deduplicated;
 end if;
 -- House lookup is independent of the selected charge source. Only the existing
 -- house read/export grant permits names and addresses into this projection.
 if cardinality(readable)>0 and houses_visible then
  select coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','name',r->'name','address',coalesce(r->>'address',''),'city',coalesce(r->'addressDetails'->>'city',r->>'city',''))),'[]') into houses
   from jsonb_array_elements(coalesce(w->'houseTrackingHouses','[]')) r;
 end if;
 foreach field in array array['personRules','exceptions','attachments','houseAssignments'] loop
  select coalesce(jsonb_agg(r),'[]') into rows from jsonb_array_elements(coalesce(c.config->field,'[]')) r where r->>'source'=any(readable)
   and (field<>'houseAssignments' or (houses_visible and exists(select 1 from jsonb_array_elements(houses) h where h->>'id'=r->>'houseId')));
  config:=config||jsonb_build_object(field,rows);
 end loop;
 return jsonb_build_object('revision',c.revision::text,'sourceRevision',md5(jsonb_build_array(invoices,entries,suppliers,workers,houses)::text),'config',config,
  'sources',jsonb_build_object('invoices',invoices,'timeEntries',entries,'suppliers',suppliers,'workers',workers,'houses',houses),
  'permissions',jsonb_build_object('canContribute',app_private.module_allowed('monthlyCharges',true),'readableSources',to_jsonb(readable),'exportableSources',to_jsonb(exportable),'contactsVisible',contacts,'canReadHouses',app_private.module_allowed('houseTracking'),'canExportHouses',app_private.module_allowed('houseTracking',false,'export')));
end $$;

create or replace function public.crm_patch_monthly_charges(p_revision text,p_patch jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare c app_private.monthly_charges_config%rowtype; w jsonb; request_hash text; prior_hash text;
 field text; op jsonb; source text; target text; next_config jsonb; rows jsonb; key_field text; target_exists boolean; removing boolean; span integer;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.monthly_charges_actor() or not app_private.module_allowed('monthlyCharges',true) then raise exception 'module_forbidden' using errcode='42501'; end if;
 if p_revision is null or p_request_id is null or p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch-array['personRules','exceptions','attachments','houseAssignments']<>'{}' or octet_length(p_patch::text)>128000 then raise exception 'invalid_monthly_patch' using errcode='22023'; end if;
 select * into strict c from app_private.monthly_charges_config where workspace_id='oneaddress-riviera' for update;
 select payload into w from public.crm_workspace_state where workspace_id='oneaddress-riviera';
 next_config:=c.config;
 -- Validate every touched source and reference before idempotency, including after revocation.
 foreach field in array array['personRules','exceptions','attachments','houseAssignments'] loop
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
   elsif field='houseAssignments' then
    if source<>'invoice' or op-array['source','sourceId','houseId']<>'{}' or not(op?'houseId') or jsonb_typeof(op->'houseId') not in ('string','null') then raise exception 'invalid_monthly_patch' using errcode='22023'; end if;
    -- Even clearing a relation requires house read permission. Unrelated edits
    -- never reconstruct this field from the caller's filtered read projection.
    if not app_private.module_allowed('houseTracking') then raise exception 'house_forbidden' using errcode='42501'; end if;
    removing:=op->'houseId'='null';
    if not removing and (coalesce(op->>'houseId','') !~ '^[A-Za-z0-9_-]{1,100}$' or not exists(select 1 from jsonb_array_elements(coalesce(w->'houseTrackingHouses','[]')) h where h->>'id'=op->>'houseId')) then raise exception 'invalid_monthly_reference' using errcode='22023'; end if;
    target_exists:=exists(select 1 from jsonb_array_elements(coalesce(w->'vendorInvoices','[]')) r where r->>'id'=target);
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
   select coalesce(jsonb_agg(r),'[]') into rows from jsonb_array_elements(coalesce(next_config->field,'[]')) r where not(r->>'source'=source and r->>key_field=target);
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

-- Monthly targets retain their YYYY-MM and canonical invoice/hours source identities.
create or replace function app_private.task_target_ref(p_ref jsonb) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
declare kind text:=p_ref->>'type'; identity text:=p_ref->>'id'; ctx jsonb:=coalesce(p_ref->'context','{}'::jsonb); allowed text[]:='{}';
begin
 if p_ref is null or jsonb_typeof(p_ref)<>'object' or p_ref-array['type','id','context']<>'{}'::jsonb
 or jsonb_typeof(p_ref->'type') is distinct from 'string' or jsonb_typeof(p_ref->'id') is distinct from 'string'
 or app_private.task_target_module(kind) is null or identity is null or length(identity) not between 1 and 500
 or jsonb_typeof(ctx)<>'object' or exists(select 1 from jsonb_each(ctx) e where jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}')>500)
 then raise exception 'invalid_task_target' using errcode='22023';end if;
 case kind
 when 'bank_account' then allowed:=array['contactId'];if coalesce(ctx->>'contactId','')='' then raise exception 'invalid_task_target_context' using errcode='22023';end if;
 when 'worker_period' then
  allowed:=array['startDate','endDate','houseId'];
  if not app_private.task_civil_date(ctx->>'startDate') or not app_private.task_civil_date(ctx->>'endDate')
  or (ctx->>'startDate')::date>(ctx->>'endDate')::date then raise exception 'invalid_task_period' using errcode='22023';end if;
 when 'monthly_charges' then
  allowed:=array['source','personId','houseId'];
  if identity !~ '^[0-9]{4}-[0-9]{2}$' or not app_private.task_civil_date(identity||'-01')
  or coalesce(ctx->>'source','') not in ('invoice','hours') then raise exception 'invalid_task_month' using errcode='22023';end if;
 when 'presentation' then
  allowed:=array['revision'];if ctx?'revision' and (ctx->>'revision' !~ '^[1-9][0-9]{0,8}$') then raise exception 'invalid_task_revision' using errcode='22023';end if;
 when 'document' then
  if ctx->>'catalog' in ('fonciere','presentation') then
   allowed:=array['catalog','projectId'];if coalesce(ctx->>'projectId','')='' then raise exception 'invalid_task_target_context' using errcode='22023';end if;
  else
   allowed:=array['provider'];if coalesce(ctx->>'provider','') not in ('storage','google-drive') then raise exception 'invalid_task_target_context' using errcode='22023';end if;
  end if;
 when 'folder' then allowed:=array['catalog'];if ctx?'catalog' and ctx->>'catalog'<>'drive_registry' then raise exception 'invalid_task_target_context' using errcode='22023';end if;
 else null;
 end case;
 if ctx-allowed<>'{}'::jsonb or exists(select 1 from jsonb_each_text(ctx) e where e.value='') then raise exception 'invalid_task_target_context' using errcode='22023';end if;
 if kind in ('fonciere_project','presentation') and identity !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 then raise exception 'invalid_task_target' using errcode='22023';end if;
 if kind in ('fonciere_project','presentation') then identity:=identity::uuid::text;end if;
 return jsonb_build_object('type',kind,'id',identity)||case when ctx='{}'::jsonb then '{}'::jsonb else jsonb_build_object('context',ctx) end;
end $$;

create or replace function app_private.task_target_resolve(p_ref jsonb,p_for_add boolean default false) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ref jsonb:=app_private.task_target_ref(p_ref); result jsonb; house jsonb; address_value text; city_value text;
begin
 -- A contextual house is readable only through the reader's house module.
 if ref->>'type'='monthly_charges' and (ref->'context')?'houseId' and not app_private.module_allowed('houseTracking') then
  return '{"state":"inaccessible"}'::jsonb;
 end if;
 -- Keep validation, per-reader permissions, archival states and all other targets.
 result:=app_private.task_target_resolve_before_house_address(p_ref,p_for_add);
 if p_ref->>'type'='house' and result->>'state' in ('available','archived') then
  select app_private.project_record('houseTrackingHouses',h) into house
  from public.crm_workspace_state w cross join lateral jsonb_array_elements(coalesce(w.payload->'houseTrackingHouses','[]')) h
  where w.workspace_id='oneaddress-riviera' and h->>'id'=result->'ref'->>'id';
  address_value:=nullif(house->>'address','');city_value:=nullif(house->'addressDetails'->>'city','');
  result:=result||jsonb_build_object('detail',concat_ws(' · ',address_value,city_value,nullif(result->>'detail','')),
   'searchFields',coalesce(result->'searchFields','[]'::jsonb)||
    coalesce((select jsonb_agg(value) from jsonb_array_elements(jsonb_build_array(address_value,city_value)) x(value) where jsonb_typeof(value)='string'),'[]'::jsonb));
 end if;
 return result;
end $$;

create or replace function app_private.task_target_export_allowed(p_ref jsonb) returns boolean
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ref jsonb:=app_private.task_target_ref(p_ref);kind text:=ref->>'type';ctx jsonb:=coalesce(ref->'context','{}');module_name text:=app_private.task_target_module(kind);d public.crm_document_scopes%rowtype;
begin
 if kind='document' and ctx->>'catalog' in ('fonciere','presentation') then module_name:='izord';end if;
 if not app_private.module_allowed(module_name,false,'export') then return false;end if;
 if kind='document' and not(ctx?'catalog') then return app_private.document_allowed(ctx->>'provider',ref->>'id',false,true);end if;
 if kind='bank_account' then return app_private.module_allowed('contacts',false,'bank_read');end if;
 if kind in ('vendor_quote','vendor_invoice','worker','worker_period','time_entry','staff_payment','quote','booking','monthly_charges') and app_private.module_allowed('contacts') and not app_private.module_allowed('contacts',false,'export') then return false;end if;
 if kind='monthly_charges' and ctx?'houseId' and not app_private.module_allowed('houseTracking',false,'export') then return false;end if;
 if kind='monthly_charges' and not app_private.module_allowed(case ctx->>'source' when 'invoice' then 'vendorInvoices' else 'houseTracking' end,false,'export') then return false;end if;
 return true;
end $$;
revoke all on function app_private.task_target_ref(jsonb),app_private.task_target_resolve(jsonb,boolean),app_private.task_target_export_allowed(jsonb) from public,anon,authenticated;


notify pgrst, 'reload schema';
commit;
