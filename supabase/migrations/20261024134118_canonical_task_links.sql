-- Typed references belong to the canonical private Tasks transaction only.
-- No business rows, identities, grants, histories or workspace payload are migrated.
begin;
create table if not exists app_private.task_links (
 id uuid primary key default gen_random_uuid(),
 task_id text not null references app_private.task_records(id),
 target jsonb not null check(jsonb_typeof(target)='object'),
 is_primary boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),
 unique(task_id,target)
);
create unique index if not exists task_links_one_primary on app_private.task_links(task_id) where is_primary;
create index if not exists task_links_target on app_private.task_links using gin(target jsonb_path_ops);
alter table app_private.task_links enable row level security;
revoke all on app_private.task_links from public,anon,authenticated;
-- Publisher is stored in Neon. Only the authenticated server bridge can attest
-- its real IDs. No title, caption, account or image is copied into Supabase.
create table if not exists app_private.task_publisher_proofs (
 user_id uuid not null, target_id text not null, present boolean not null,
 checked_at timestamptz not null default clock_timestamp(), primary key(user_id,target_id)
);
alter table app_private.task_publisher_proofs enable row level security;
revoke all on app_private.task_publisher_proofs from public,anon,authenticated;

create or replace function app_private.task_target_module(p_type text) returns text
language sql immutable set search_path=pg_catalog as $$
 select case p_type when 'contact' then 'contacts' when 'lead' then 'leads' when 'quote' then 'quotes'
 when 'booking' then 'bookings' when 'vendor_quote' then 'vendorQuotes' when 'vendor_invoice' then 'vendorInvoices'
 when 'bank_account' then 'contacts' when 'worker' then 'houseTracking' when 'worker_period' then 'houseTracking'
 when 'time_entry' then 'houseTracking' when 'staff_payment' then 'houseTracking' when 'house' then 'houseTracking'
 when 'property' then 'properties' when 'vehicle' then 'vehicles' when 'boat' then 'boats' when 'planning_entry' then 'planning'
 when 'fonciere_project' then 'izord' when 'presentation' then 'izord' when 'document' then 'documents'
 when 'folder' then 'documents' when 'monthly_charges' then 'monthlyCharges' when 'publisher_creation' then 'publisher' end;
$$;
create or replace function app_private.task_civil_date(p_text text) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
begin
 if p_text is null or p_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false;end if;
 return to_char(p_text::date,'YYYY-MM-DD')=p_text;
exception when others then return false;
end $$;
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
  or coalesce(ctx->>'source','') not in ('invoice','hours') or (ctx?'houseId' and ctx->>'source'<>'hours') then raise exception 'invalid_task_month' using errcode='22023';end if;
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
declare ref jsonb:=app_private.task_target_ref(p_ref);kind text:=ref->>'type';identity text:=ref->>'id';ctx jsonb:=coalesce(ref->'context','{}');
 module_name text:=app_private.task_target_module(kind);collection_name text;w jsonb;r jsonb;raw_row jsonb; related jsonb;
 search_related jsonb;search_company jsonb;label_value text;detail_value text:='';status_value text:='';state_value text:='available'; result jsonb;d public.crm_document_scopes%rowtype;
 project_row record; proof app_private.task_publisher_proofs%rowtype;found_row boolean:=false;
begin
 -- Permissions are resolved for this reader on every call, never from a task's author.
 if kind='document' and ctx->>'catalog' in ('fonciere','presentation') then module_name:='izord';end if;
 if not app_private.module_allowed(module_name) then return '{"state":"inaccessible"}'::jsonb;end if;
 if kind='bank_account' and not app_private.module_allowed('contacts',false,'bank_read') then return '{"state":"inaccessible"}'::jsonb;end if;
 select payload into w from public.crm_workspace_state where workspace_id='oneaddress-riviera';
 collection_name:=case kind when 'contact' then 'contacts' when 'lead' then 'leads' when 'quote' then 'quotes' when 'booking' then 'quotes'
 when 'vendor_quote' then 'vendorQuotes' when 'vendor_invoice' then 'vendorInvoices' when 'worker' then 'houseTrackingWorkers'
 when 'worker_period' then 'houseTrackingWorkers' when 'time_entry' then 'houseTimeEntries' when 'staff_payment' then 'housePayments'
 when 'house' then 'houseTrackingHouses' when 'property' then 'properties' when 'vehicle' then 'vehicles' when 'boat' then 'boats' when 'planning_entry' then 'planningEntries' end;
 if collection_name is not null then
  select v into raw_row from jsonb_array_elements(coalesce(w->collection_name,'[]')) v where v->>'id'=identity;
  if raw_row is not null then
   r:=app_private.project_record(collection_name,raw_row);found_row:=true;
   label_value:=coalesce(nullif(r->>'title',''),nullif(concat_ws(' ',r->>'firstName',r->>'name'),''),nullif(r->>'companyName',''),nullif(r->>'contactName',''),nullif(r->>'workerName',''),nullif(r->>'model',''),identity);
   status_value:=coalesce(r->>'status','');
   detail_value:=concat_ws(' · ',nullif(r->>'city',''),nullif(r->>'quoteReference',''),nullif(r->>'invoiceReference',''),nullif(r->>'reference',''),nullif(r->>'date',''),nullif(r->>'role',''));
   if kind='contact' then
    if raw_row->>'entityType'='company' then label_value:=coalesce(nullif(raw_row->>'companyName',''),label_value);end if;
    if coalesce(raw_row->>'companyId','')<>'' then
     select c into related from jsonb_array_elements(coalesce(w->'contacts','[]')) c where c->>'id'=raw_row->>'companyId';
    end if;
    detail_value:=concat_ws(' · ',nullif(coalesce(related->>'companyName',raw_row->>'companyName'),''),nullif(r->>'city',''),nullif(r->>'kind',''));
    if coalesce(raw_row->>'mergedIntoCompanyId','')<>'' then state_value:='archived';status_value:='Entreprise consolidée';end if;
   elsif kind='booking' then
    if raw_row->>'status' is distinct from 'Accepted' then state_value:='archived';if p_for_add then found_row:=false;end if;end if;
    status_value:=coalesce(r->>'bookingStatus',r->>'status','');
   elsif kind='worker' or kind='worker_period' then
    if not app_private.module_allowed('contacts') then label_value:='Intervenant · '||identity;end if;
    if raw_row->>'status'='Inactif' then state_value:='archived';end if;
    if kind='worker_period' then
     if ctx?'houseId' and not exists(select 1 from jsonb_array_elements(coalesce(w->'houseTrackingHouses','[]')) h where h->>'id'=ctx->>'houseId') then found_row:=false;end if;
     detail_value:=concat_ws(' · ',ctx->>'startDate',ctx->>'endDate',case when ctx?'houseId' then (select h->>'name' from jsonb_array_elements(coalesce(w->'houseTrackingHouses','[]')) h where h->>'id'=ctx->>'houseId') end);
    end if;
   elsif kind in ('time_entry','staff_payment') then
    label_value:=concat_ws(' · ',case when app_private.module_allowed('contacts') then r->>'workerName' else 'Intervenant' end,nullif(r->>'date',''));
    detail_value:=coalesce(r->>'houseName','');
   end if;
  end if;
 elsif kind='bank_account' then
  select c into raw_row from jsonb_array_elements(coalesce(w->'contacts','[]')) c where c->>'id'=ctx->>'contactId';
  select a into r from jsonb_array_elements(coalesce(raw_row->'supplierBankAccounts','[]')) a where a->>'id'=identity;
  found_row:=r is not null;
  label_value:=concat_ws(' · ',case when raw_row->>'entityType'='company' then coalesce(nullif(raw_row->>'companyName',''),'Entreprise') else coalesce(nullif(concat_ws(' ',raw_row->>'firstName',raw_row->>'name'),''),nullif(raw_row->>'companyName',''),'Contact') end,coalesce(nullif(r->>'label',''),'Compte bancaire'));
  detail_value:=coalesce(r->>'bankName','');status_value:=coalesce(r->>'status','');
  if status_value='Archivé' then state_value:='archived';end if;
 elsif kind='fonciere_project' then
  if not app_private.can_fonciere_project(identity::uuid) then return '{"state":"inaccessible"}'::jsonb;end if;
  select * into project_row from public.fonciere_projects where id=identity::uuid;
  found_row:=found;label_value:=project_row.title;status_value:=project_row.status;
  if status_value='archived' then state_value:='archived';end if;
 elsif kind='presentation' then
  if not app_private.can_project(identity::uuid) then return '{"state":"inaccessible"}'::jsonb;end if;
  if ctx?'revision' then
   select title,status,revision into project_row from public.izord_project_versions where project_id=identity::uuid and revision=(ctx->>'revision')::integer;
  else select title,status,revision into project_row from public.izord_projects where id=identity::uuid;end if;
  found_row:=found;
  if found_row then label_value:=project_row.title;status_value:=project_row.status;detail_value:='Révision '||project_row.revision;end if;
 elsif kind='document' then
  if ctx->>'catalog'='fonciere' then
   select * into project_row from public.fonciere_assets where id::text=identity and project_id::text=ctx->>'projectId';
   if not found or not app_private.can_fonciere_asset(project_row.object_path) then return '{"state":"inaccessible"}'::jsonb;end if;
   found_row:=not p_for_add or project_row.lifecycle='finalized';label_value:=project_row.original_name;status_value:=project_row.lifecycle;
  elsif ctx->>'catalog'='presentation' then
   select * into project_row from public.izord_assets where id::text=identity and project_id::text=ctx->>'projectId';
   if not found or not app_private.can_asset(project_row.object_path) then return '{"state":"inaccessible"}'::jsonb;end if;
   found_row:=not p_for_add or project_row.lifecycle='finalized';label_value:=coalesce(to_jsonb(project_row)->>'original_name',project_row.kind);status_value:=coalesce(to_jsonb(project_row)->>'lifecycle','');
  else
   select * into d from public.crm_document_scopes where provider=ctx->>'provider' and resource_id=identity;
   if not found or not app_private.document_allowed(d.provider,d.resource_id) then return '{"state":"inaccessible"}'::jsonb;end if;
   found_row:=true;label_value:=d.title;detail_value:=d.folder;status_value:=coalesce(d.lifecycle,'');
   if d.superseded_by is not null or d.lifecycle='superseded' then state_value:='archived';status_value:='Remplacé';end if;
  end if;
 elsif kind='folder' then
  -- Existing folder write/catalogue access is owner-only; never infer it from a task.
  if not app_private.full_access() then return '{"state":"inaccessible"}'::jsonb;end if;
  if ctx->>'catalog'='drive_registry' then
   select to_jsonb(f) into r from public.crm_drive_folder_registry f where workspace_id='oneaddress-riviera' and drive_folder_id=identity and status='ready';
   found_row:=r is not null;label_value:='Dossier prestataire';detail_value:=coalesce(r->>'logical_key','');
  else
   select f into r from jsonb_array_elements(coalesce(w->'documents','[]')) f where f->>'id'=identity and f->>'isFolder'='true';
   found_row:=r is not null;label_value:=coalesce(r->>'title','Dossier');
  end if;
 elsif kind='monthly_charges' then
  if not app_private.module_allowed(case ctx->>'source' when 'invoice' then 'vendorInvoices' else 'houseTracking' end) then return '{"state":"inaccessible"}'::jsonb;end if;
  found_row:=true;
  if ctx?'personId' then
   if ctx->>'source'='hours' then
    found_row:=exists(select 1 from jsonb_array_elements(coalesce(w->'houseTrackingWorkers','[]')) x where x->>'id'=ctx->>'personId') or exists(select 1 from jsonb_array_elements(coalesce(w->'houseTimeEntries','[]')) x where x->>'workerId'=ctx->>'personId');
   else
    found_row:=(app_private.module_allowed('contacts') and exists(select 1 from jsonb_array_elements(coalesce(w->'contacts','[]')) x where x->>'id'=ctx->>'personId' and x->>'kind'='Prestataire')) or exists(select 1 from jsonb_array_elements(coalesce(w->'vendorInvoices','[]')) x where x->>'contactId'=ctx->>'personId');
   end if;
  end if;
  if ctx?'houseId' then found_row:=found_row and exists(select 1 from jsonb_array_elements(coalesce(w->'houseTrackingHouses','[]')) h where h->>'id'=ctx->>'houseId');end if;
  label_value:='Charges mensuelles · '||identity;detail_value:=case ctx->>'source' when 'invoice' then 'Factures prestataires' else 'Personnel et interventions' end;
  if ctx?'personId' then
   if ctx->>'source'='hours' then
    select x into related from jsonb_array_elements(coalesce(w->'houseTrackingWorkers','[]')) x where x->>'id'=ctx->>'personId';
    if related is null then select x into related from jsonb_array_elements(coalesce(w->'houseTimeEntries','[]')) x where x->>'workerId'=ctx->>'personId' limit 1;end if;
    label_value:=label_value||' · '||case when app_private.module_allowed('contacts') then coalesce(nullif(related->>'contactName',''),nullif(related->>'workerName',''),'Intervenant') else 'Intervenant' end;
   else
    if app_private.module_allowed('contacts') then select x into related from jsonb_array_elements(coalesce(w->'contacts','[]')) x where x->>'id'=ctx->>'personId';end if;
    label_value:=label_value||' · '||case when app_private.module_allowed('contacts') then coalesce(nullif(related->>'companyName',''),nullif(concat_ws(' ',related->>'firstName',related->>'name'),''),'Fournisseur') else 'Fournisseur' end;
   end if;
   detail_value:=detail_value||' · '||(ctx->>'personId');
  end if;
  if ctx?'houseId' then detail_value:=concat_ws(' · ',detail_value,(select h->>'name' from jsonb_array_elements(coalesce(w->'houseTrackingHouses','[]')) h where h->>'id'=ctx->>'houseId'));end if;
 elsif kind='publisher_creation' then
  if p_for_add then select * into proof from app_private.task_publisher_proofs where user_id=auth.uid() and target_id=identity;
  else select * into proof from app_private.task_publisher_proofs where target_id=identity order by checked_at desc limit 1;end if;
  if not found then return '{"state":"inaccessible"}'::jsonb;end if;
  found_row:=proof.present and (not p_for_add or proof.checked_at>clock_timestamp()-interval '60 seconds');
  label_value:='Création Publisher';
 end if;
 if not found_row then return jsonb_build_object('ref',ref,'state','deleted','label','Élément supprimé ou indisponible');end if;
 if app_private.module_allowed('contacts') then
  if kind in ('contact','bank_account') then search_related:=raw_row;
  elsif coalesce(r->>'contactId','')<>'' then select c into search_related from jsonb_array_elements(coalesce(w->'contacts','[]')) c where c->>'id'=r->>'contactId';end if;
  if coalesce(search_related->>'companyId','')<>'' then select c into search_company from jsonb_array_elements(coalesce(w->'contacts','[]')) c where c->>'id'=search_related->>'companyId';end if;
 end if;
 if kind='bank_account' then detail_value:=concat_ws(' · ',nullif(detail_value,''),nullif(search_related->>'city',''),nullif(coalesce(search_company->>'companyName',search_related->>'companyName'),''));end if;
 result:=jsonb_build_object('ref',ref,'state',state_value,'label',coalesce(nullif(label_value,''),identity),'detail',detail_value,'status',status_value);
 if r is not null then
  result:=result||jsonb_build_object('searchFields',(select jsonb_agg(value) from jsonb_array_elements(jsonb_build_array(label_value,detail_value,identity,r->>'companyName',r->>'city',r->>'reference',r->>'quoteReference',r->>'invoiceReference',r->>'clientName',r->>'contactName',r->>'brand',r->>'model',r->>'port',search_related->>'firstName',search_related->>'name',search_related->>'companyName',search_related->>'city',search_company->>'companyName')) x(value) where jsonb_typeof(value)='string'));
 end if;
 if kind='vendor_invoice' then result:=result||jsonb_build_object('financial',jsonb_build_object('amount',r->'amount','paidAmount',r->'paidAmount','dueDate',r->>'dueDate','status',r->>'status'));end if;
 if kind in ('vendor_invoice','vendor_quote','quote','booking') and app_private.task_civil_date(coalesce(r->>'dueDate',r->>'paymentDueDate',r->>'validUntil')) then result:=result||jsonb_build_object('dueDate',coalesce(r->>'dueDate',r->>'paymentDueDate',r->>'validUntil'));end if;
 return result;
end $$;

create or replace function app_private.task_target_candidates() returns setof jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare w jsonb;r jsonb;c record;ref jsonb;p record;month_value text:=to_char(timezone('Europe/Paris',clock_timestamp()),'YYYY-MM');start_value text;end_value text;
begin
 start_value:=month_value||'-01';end_value:=to_char((start_value::date+interval '1 month'-interval '1 day')::date,'YYYY-MM-DD');
 select payload into w from public.crm_workspace_state where workspace_id='oneaddress-riviera';
 for c in select * from (values
 ('contacts','contact','contacts'),('leads','lead','leads'),('quotes','quote','quotes'),('quotes','booking','bookings'),
 ('vendorQuotes','vendor_quote','vendorQuotes'),('vendorInvoices','vendor_invoice','vendorInvoices'),('houseTrackingWorkers','worker','houseTracking'),
 ('houseTimeEntries','time_entry','houseTracking'),('housePayments','staff_payment','houseTracking'),('houseTrackingHouses','house','houseTracking'),
 ('properties','property','properties'),('vehicles','vehicle','vehicles'),('boats','boat','boats'),('planningEntries','planning_entry','planning')) x(collection_name,kind,module_name)
 loop
  if not app_private.module_allowed(c.module_name) then continue;end if;
  for r in select * from jsonb_array_elements(coalesce(w->c.collection_name,'[]')) loop
   if coalesce(r->>'id','')='' or (c.kind='booking' and r->>'status' is distinct from 'Accepted') then continue;end if;
   return next jsonb_build_object('type',c.kind,'id',r->>'id');
   if c.kind='worker' then
    return next jsonb_build_object('type','worker_period','id',r->>'id','context',jsonb_build_object('startDate',start_value,'endDate',end_value));
    if app_private.module_allowed('monthlyCharges') then return next jsonb_build_object('type','monthly_charges','id',month_value,'context',jsonb_build_object('source','hours','personId',r->>'id'));end if;
   end if;
   if c.kind='contact' and app_private.module_allowed('contacts',false,'bank_read') then
    for ref in select * from jsonb_array_elements(coalesce(r->'supplierBankAccounts','[]')) loop
     if coalesce(ref->>'id','')<>'' then return next jsonb_build_object('type','bank_account','id',ref->>'id','context',jsonb_build_object('contactId',r->>'id'));end if;
    end loop;
   end if;
  end loop;
 end loop;
 if app_private.module_allowed('izord') then
  for p in select * from public.fonciere_projects where app_private.can_fonciere_project(id) loop
   return next jsonb_build_object('type','fonciere_project','id',p.id::text);
  end loop;
  for p in select * from public.izord_projects where app_private.can_project(id) loop
   return next jsonb_build_object('type','presentation','id',p.id::text);
  end loop;
  for p in select a.* from public.fonciere_assets a where a.lifecycle='finalized' and app_private.can_fonciere_asset(a.object_path) loop
   return next jsonb_build_object('type','document','id',p.id::text,'context',jsonb_build_object('catalog','fonciere','projectId',p.project_id::text));
  end loop;
  for p in select a.* from public.izord_assets a where a.lifecycle='finalized' and app_private.can_asset(a.object_path) loop
   return next jsonb_build_object('type','document','id',p.id::text,'context',jsonb_build_object('catalog','presentation','projectId',p.project_id::text));
  end loop;
 end if;
 if app_private.module_allowed('documents') then
  for p in select * from public.crm_document_scopes d where app_private.document_allowed(d.provider,d.resource_id) loop
   return next jsonb_build_object('type','document','id',p.resource_id,'context',jsonb_build_object('provider',p.provider));
  end loop;
  if app_private.full_access() then
   for r in select f from jsonb_array_elements(coalesce(w->'documents','[]')) f where f->>'isFolder'='true' loop
    return next jsonb_build_object('type','folder','id',r->>'id');
   end loop;
   for p in select * from public.crm_drive_folder_registry where workspace_id='oneaddress-riviera' and status='ready' loop
    return next jsonb_build_object('type','folder','id',p.drive_folder_id,'context',jsonb_build_object('catalog','drive_registry'));
   end loop;
  end if;
 end if;
 if app_private.module_allowed('monthlyCharges') then
  if app_private.module_allowed('vendorInvoices') then
   return next jsonb_build_object('type','monthly_charges','id',month_value,'context',jsonb_build_object('source','invoice'));
   for r in select distinct jsonb_build_object('personId',v->>'contactId') from jsonb_array_elements(coalesce(w->'vendorInvoices','[]')) v where coalesce(v->>'contactId','')<>'' loop
    return next jsonb_build_object('type','monthly_charges','id',month_value,'context',jsonb_build_object('source','invoice')||r);
   end loop;
  end if;
  if app_private.module_allowed('houseTracking') then
   return next jsonb_build_object('type','monthly_charges','id',month_value,'context',jsonb_build_object('source','hours'));
  end if;
 end if;
end $$;

create or replace function public.crm_task_targets_search(p_query text default '',p_type text default null,p_offset integer default 0,p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb; page_size integer:=least(200,greatest(1,p_limit));
begin
 if not app_private.task_session_active() then raise exception 'tasks_forbidden' using errcode='42501';end if;
 if p_query is null or length(p_query)>500 or p_offset is null or p_offset<0 or p_offset>1000000 or p_limit is null
 or (p_type is not null and app_private.task_target_module(p_type) is null) then raise exception 'invalid_task_search' using errcode='22023';end if;
 -- The client also retrieves empty-query pages and uses the shared exact/fuzzy
 -- matcher across ALL candidates before its display limit, including accents.
 with candidates as materialized(select distinct ref from app_private.task_target_candidates() ref where p_type is null or ref->>'type'=p_type),
 resolved as materialized(select app_private.task_target_resolve(ref) target from candidates),
 matched as (select target from resolved where target->>'state' in ('available','archived') and (p_query='' or target::text ilike '%'||p_query||'%')),
 page as (select target from matched order by target->'ref'->>'type',lower(target->>'label'),(target->'ref')::text offset p_offset limit page_size+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(target order by ord) from (select target,row_number() over() ord from page) x where ord<=page_size),'[]'::jsonb),'hasMore',(select count(*)>page_size from page)) into result;
 return result;
end $$;
create or replace function public.crm_task_targets_resolve(p_refs jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not app_private.task_session_active() then raise exception 'tasks_forbidden' using errcode='42501';end if;
 if p_refs is null or jsonb_typeof(p_refs)<>'array' or jsonb_array_length(p_refs)>200 then raise exception 'invalid_task_targets' using errcode='22023';end if;
 return coalesce((select jsonb_agg(app_private.task_target_resolve(ref) order by ord) from jsonb_array_elements(p_refs) with ordinality r(ref,ord)),'[]'::jsonb);
end $$;
create or replace function public.crm_tasks_for_target(p_ref jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ref jsonb:=app_private.task_target_ref(p_ref);target jsonb;
begin
 if not app_private.task_session_active() then raise exception 'tasks_forbidden' using errcode='42501';end if;
 target:=app_private.task_target_resolve(ref);
 if target->>'state' not in ('available','archived') then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(app_private.task_project(t) order by t.created_at,t.id) from app_private.task_records t
 where app_private.task_visible(t.id) and (exists(select 1 from app_private.task_links l where l.task_id=t.id and l.target=ref)
 or (ref->>'type'='contact' and t.contact_id=ref->>'id') or (ref->>'type'='lead' and t.lead_id=ref->>'id'))),'[]'::jsonb);
end $$;
create or replace function public.crm_task_publisher_confirm(p_user uuid,p_id text,p_exists boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or p_user is null or p_id is null or length(p_id) not between 1 and 100 or p_exists is null then raise exception 'task_publisher_bridge_forbidden' using errcode='42501';end if;
 insert into app_private.task_publisher_proofs(user_id,target_id,present) values(p_user,p_id,p_exists)
 on conflict(user_id,target_id) do update set present=excluded.present,checked_at=clock_timestamp();
end $$;
revoke all on function public.crm_task_publisher_confirm(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.crm_task_publisher_confirm(uuid,text,boolean) to service_role;

-- Attach additive projections to the exact published task contract.
do $$ declare definition text;begin
 if to_regprocedure('app_private.task_links_previous_project(app_private.task_records)') is null then
  select pg_get_functiondef('app_private.task_project(app_private.task_records)'::regprocedure) into definition;
  execute replace(definition,'FUNCTION app_private.task_project(','FUNCTION app_private.task_links_previous_project(');
 end if;
end $$;
create or replace function app_private.task_project(t app_private.task_records) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.task_links_previous_project(t)||jsonb_build_object('links',coalesce((select jsonb_agg(
  jsonb_build_object('id',l.id,'primary',l.is_primary,'state',resolved->>'state')||case when resolved->>'state'='inaccessible' then '{}'::jsonb
   else (resolved-'ref')||jsonb_build_object('target',resolved->'ref') end order by l.is_primary desc,l.created_at,l.id)
 from app_private.task_links l cross join lateral (select app_private.task_target_resolve(l.target) resolved) r where l.task_id=t.id),'[]'::jsonb));
$$;

-- Exporting Tasks does not grant export/download rights to a linked module.
create or replace function app_private.task_target_export_allowed(p_ref jsonb) returns boolean
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ref jsonb:=app_private.task_target_ref(p_ref);kind text:=ref->>'type';ctx jsonb:=coalesce(ref->'context','{}');module_name text:=app_private.task_target_module(kind);d public.crm_document_scopes%rowtype;
begin
 if kind='document' and ctx->>'catalog' in ('fonciere','presentation') then module_name:='izord';end if;
 if not app_private.module_allowed(module_name,false,'export') then return false;end if;
 if kind='document' and not(ctx?'catalog') then return app_private.document_allowed(ctx->>'provider',ref->>'id',false,true);end if;
 if kind='bank_account' then return app_private.module_allowed('contacts',false,'bank_read');end if;
 if kind in ('vendor_quote','vendor_invoice','worker','worker_period','time_entry','staff_payment','quote','booking','monthly_charges') and app_private.module_allowed('contacts') and not app_private.module_allowed('contacts',false,'export') then return false;end if;
 if kind='monthly_charges' and not app_private.module_allowed(case ctx->>'source' when 'invoice' then 'vendorInvoices' else 'houseTracking' end,false,'export') then return false;end if;
 return true;
end $$;
revoke all on function app_private.task_target_export_allowed(jsonb) from public,anon,authenticated;
create or replace function public.crm_tasks_export() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare t app_private.task_records%rowtype;projected jsonb;links jsonb;result jsonb:='[]';
begin
 if not app_private.task_session_active() or not app_private.module_allowed('tasks',false,'export') then raise exception 'tasks_export_forbidden' using errcode='42501';end if;
 for t in select * from app_private.task_records r where app_private.task_visible(r.id) order by r.created_at,r.id loop
  projected:=app_private.task_project(t);
  select coalesce(jsonb_agg(case when app_private.task_target_export_allowed(l.target) then v else jsonb_build_object('id',v->'id','primary',v->'primary','state','inaccessible') end order by ord),'[]'::jsonb) into links
   from jsonb_array_elements(projected->'links') with ordinality x(v,ord) join app_private.task_links l on l.id::text=v->>'id' and l.task_id=t.id;
  projected:=jsonb_set(projected,'{links}',links);
  if not app_private.module_allowed('contacts',false,'export') then projected:=projected||'{"contactId":""}'::jsonb;end if;
  if not app_private.module_allowed('leads',false,'export') then projected:=projected||'{"leadId":"","linkedTo":""}'::jsonb;end if;
  result:=result||jsonb_build_array(projected);
 end loop;
 return result;
end $$;

-- Never erase invisible relations via a projected replacement list. Explicit
-- operations alone may add/remove/change principal; unrelated patches skip this.
create or replace function app_private.task_apply_link_changes(p_task text,p_changes jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare ref jsonb;resolved jsonb;relation_id uuid;entry jsonb;selected_primary uuid;rows_count integer;
begin
 if p_changes is null or jsonb_typeof(p_changes)<>'object' or p_changes-array['add','remove','primary']<>'{}'::jsonb
 or octet_length(p_changes::text)>32000 then raise exception 'invalid_task_link_changes' using errcode='22023';end if;
 if p_changes?'remove' then
  if jsonb_typeof(p_changes->'remove')<>'array' or jsonb_array_length(p_changes->'remove')>100 then raise exception 'invalid_task_link_changes' using errcode='22023';end if;
  for entry in select * from jsonb_array_elements(p_changes->'remove') loop
   if jsonb_typeof(entry)<>'string' or (entry#>>'{}') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'invalid_task_link_id' using errcode='22023';end if;
   relation_id:=(entry#>>'{}')::uuid;
   select target into ref from app_private.task_links where id=relation_id and task_id=p_task;
   if not found then raise exception 'task_link_not_found' using errcode='22023';end if;
   update app_private.task_records set contact_id=case when ref->>'type'='contact' and contact_id=ref->>'id' then '' else contact_id end,
    lead_id=case when ref->>'type'='lead' and lead_id=ref->>'id' then '' else lead_id end where id=p_task;
   delete from app_private.task_links where task_id=p_task and id=relation_id;
  end loop;
 end if;
 if p_changes?'add' then
  if jsonb_typeof(p_changes->'add')<>'array' or jsonb_array_length(p_changes->'add')>100 then raise exception 'invalid_task_link_changes' using errcode='22023';end if;
  for entry in select * from jsonb_array_elements(p_changes->'add') loop
   ref:=app_private.task_target_ref(entry);resolved:=app_private.task_target_resolve(ref,true);
   if resolved->>'state' not in ('available','archived') then raise exception 'task_target_forbidden_or_missing' using errcode='42501';end if;
   insert into app_private.task_links(task_id,target) values(p_task,ref) on conflict(task_id,target) do nothing;
   update app_private.task_records set contact_id=case when ref->>'type'='contact' and contact_id='' then ref->>'id' else contact_id end,
    lead_id=case when ref->>'type'='lead' and lead_id='' then ref->>'id' else lead_id end where id=p_task;
  end loop;
 end if;
 select count(*) into rows_count from app_private.task_links where task_id=p_task;
 if rows_count>100 then raise exception 'task_too_many_links' using errcode='22023';end if;
 if p_changes?'primary' then
  if p_changes->'primary'='null'::jsonb then update app_private.task_links set is_primary=false where task_id=p_task;
  else
   entry:=p_changes->'primary';
   if jsonb_typeof(entry)<>'object' or entry-array['linkId','target']<>'{}'::jsonb or (entry?'linkId')=(entry?'target') then raise exception 'invalid_task_primary' using errcode='22023';end if;
   if entry?'linkId' then
    if jsonb_typeof(entry->'linkId')<>'string' or entry->>'linkId' !~ '^[0-9a-fA-F-]{36}$' then raise exception 'invalid_task_primary' using errcode='22023';end if;
    select id,target into selected_primary,ref from app_private.task_links where task_id=p_task and id=(entry->>'linkId')::uuid;
   else
    ref:=app_private.task_target_ref(entry->'target');select id into selected_primary from app_private.task_links where task_id=p_task and target=ref;
   end if;
   if selected_primary is null then raise exception 'task_primary_not_linked' using errcode='22023';end if;
   -- Selecting an inaccessible link as principal is an explicit relationship
   -- operation, and therefore still requires current target rights.
   resolved:=app_private.task_target_resolve(ref);
   if resolved->>'state' not in ('available','archived') then raise exception 'task_target_forbidden_or_missing' using errcode='42501';end if;
   update app_private.task_links set is_primary=false where task_id=p_task and is_primary;
   update app_private.task_links set is_primary=true where id=selected_primary;
  end if;
 end if;
end $$;

-- Preserve every canonical revision/idempotency/attribution check and journal.
-- Capture once so reapplying this additive migration is deterministic.
do $$ declare definition text;begin
 if to_regprocedure('app_private.task_links_previous_mutate(uuid,text,bigint,jsonb,boolean)') is null then
  select pg_get_functiondef('public.crm_tasks_mutate(uuid,text,bigint,jsonb,boolean)'::regprocedure) into definition;
  execute replace(definition,'FUNCTION public.crm_tasks_mutate(','FUNCTION app_private.task_links_previous_mutate(');
 end if;
 select pg_get_functiondef('app_private.task_links_previous_mutate(uuid,text,bigint,jsonb,boolean)'::regprocedure) into definition;
 definition:=replace(definition,'FUNCTION app_private.task_links_previous_mutate(','FUNCTION public.crm_tasks_mutate(');
 definition:=replace(definition,'''title'',''notes'',''dueDate'',''priority'',''status'',''assigneeIds'',''linkedTo'',''contactId'',''leadId'']','''title'',''notes'',''dueDate'',''priority'',''status'',''assigneeIds'',''linkedTo'',''contactId'',''leadId'',''linkChanges'']');
 definition:=replace(definition,'if kv.key=''assigneeIds'' then','if kv.key=''linkChanges'' then continue; elsif kv.key=''assigneeIds'' then');
 definition:=replace(definition,'changes:=p_patch;', $body$
 -- Legacy contact/lead clients continue to attach their actual identities. Only
 -- explicitly touched compatibility references are removed, never other links.
 if not p_delete then
  if p_patch?'contactId' then
   if prior.contact_id<>'' and prior.contact_id is distinct from t.contact_id then delete from app_private.task_links where task_id=p_id and target=jsonb_build_object('type','contact','id',prior.contact_id);end if;
   if t.contact_id<>'' then insert into app_private.task_links(task_id,target) values(p_id,jsonb_build_object('type','contact','id',t.contact_id)) on conflict(task_id,target) do nothing;end if;
  end if;
  if p_patch?'leadId' or p_patch?'linkedTo' then
   if prior.lead_id<>'' and prior.lead_id is distinct from t.lead_id then delete from app_private.task_links where task_id=p_id and target=jsonb_build_object('type','lead','id',prior.lead_id);end if;
   if t.lead_id<>'' then insert into app_private.task_links(task_id,target) values(p_id,jsonb_build_object('type','lead','id',t.lead_id)) on conflict(task_id,target) do nothing;end if;
  end if;
  if p_patch?'linkChanges' then perform app_private.task_apply_link_changes(p_id,p_patch->'linkChanges');end if;
  select * into strict t from app_private.task_records where id=p_id;
 end if;
 changes:=p_patch;
 $body$);
 if position('task_apply_link_changes' in definition)=0 or position('''leadId'',''linkChanges''' in definition)=0 then raise exception 'task_mutate_contract_changed';end if;
 execute definition;
end $$;
create or replace function app_private.task_legacy_links_insert() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if new.contact_id<>'' then insert into app_private.task_links(task_id,target) values(new.id,jsonb_build_object('type','contact','id',new.contact_id)) on conflict(task_id,target) do nothing;end if;
 if new.lead_id<>'' then insert into app_private.task_links(task_id,target) values(new.id,jsonb_build_object('type','lead','id',new.lead_id)) on conflict(task_id,target) do nothing;end if;
 return new;
end $$;
revoke all on function app_private.task_legacy_links_insert() from public,anon,authenticated;
drop trigger if exists task_legacy_links_insert on app_private.task_records;
create trigger task_legacy_links_insert after insert on app_private.task_records for each row execute function app_private.task_legacy_links_insert();
-- Existing references are copied additively without changing task rows or events.
insert into app_private.task_links(task_id,target)
 select id,jsonb_build_object('type','contact','id',contact_id) from app_private.task_records where contact_id<>'' on conflict(task_id,target) do nothing;
insert into app_private.task_links(task_id,target)
 select id,jsonb_build_object('type','lead','id',lead_id) from app_private.task_records where lead_id<>'' on conflict(task_id,target) do nothing;

-- Link references are journalled privately, never leaked through historical logs.
do $$ declare definition text;begin
 select pg_get_functiondef('public.crm_tasks_history(text)'::regprocedure) into definition;
 definition:=replace(definition,'''linkedTo'',''contactId'',''leadId'']','''linkedTo'',''contactId'',''leadId'',''linkChanges'']');execute definition;
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and (p.proname like 'task_target_%' or p.proname like 'task_links_%' or p.proname in ('task_civil_date','task_apply_link_changes')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
end $$;
revoke all on function public.crm_task_targets_search(text,text,integer,integer),public.crm_task_targets_resolve(jsonb),public.crm_tasks_for_target(jsonb) from public,anon,authenticated;
grant execute on function public.crm_task_targets_search(text,text,integer,integer),public.crm_task_targets_resolve(jsonb),public.crm_tasks_for_target(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
