-- Additive contact classification and private, versioned contact documents.
-- No business payload, current grants, sharing rows or existing files are changed.
begin;
update app_private.module_collections set fields=jsonb_set(fields,'{kind,enum}',
 '["Client","Propriétaire","Prestataire","Membre de l’organisation"]'::jsonb)
 || '{"organizationFunction":{"type":"string","label":"Fonction"}}'::jsonb where collection='contacts';

alter table public.crm_document_scopes
 add column personal_contact boolean not null default false,
 add column document_type text,
 add column file_name text,
 add column mime_type text,
 add column size_bytes bigint,
 add column expires_on date,
 add column created_by uuid references auth.users(id),
 add column created_at timestamptz,
 add column operation_id uuid unique,
 add column lifecycle text,
 add column revision bigint not null default 1,
 add column withdrawn_at timestamptz,
 add constraint crm_contact_document_metadata check(not personal_contact or (
  provider='storage' and module='contacts' and collection='contacts' and not bank
  and resource_id ~ '^contact-private/[0-9a-f-]{36}$'
  and operation_id is not null and created_by is not null and created_at is not null
  and length(file_name) between 1 and 240 and length(title) between 1 and 200
  and document_type in ('Carte d’identité','Passeport','Permis de conduire','Permis bateau','Contrat','Autre')
  and mime_type in ('application/pdf','image/jpeg','image/png') and size_bytes between 1 and 25000000
  and lifecycle in ('pending','active','superseded','withdrawn')
  and (lifecycle<>'withdrawn' or withdrawn_at is not null)));
create index crm_contact_documents_by_record on public.crm_document_scopes(record_id) where personal_contact;

create function app_private.contact_document_session() returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.document_actor_active(auth.uid()) and exists(select 1 from auth.sessions s
 where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id');
$$;
create function app_private.contact_document_contact_exists(p_contact text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select count(*)=1 from public.crm_workspace_state w
 cross join lateral jsonb_array_elements(coalesce(w.payload->'contacts','[]')) r
 where w.workspace_id='oneaddress-riviera' and r->>'id'=p_contact;
$$;
create function app_private.contact_document_allowed(p_resource text,p_write boolean default false,p_download boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select p_write is not null and p_download is not null and app_private.contact_document_session()
 and app_private.module_allowed('contacts',p_write,case when p_download then 'export' end)
 and app_private.module_allowed('documents',p_write,case when p_download then 'export' end)
 and exists(select 1 from public.crm_document_scopes d where d.provider='storage' and d.resource_id=p_resource
  and d.personal_contact and app_private.contact_document_contact_exists(d.record_id)
  and (case when p_write then d.lifecycle in ('pending','active') and d.superseded_by is null
    and (app_private.full_access() or d.created_by=auth.uid())
   else d.lifecycle in ('active','superseded') and (app_private.full_access() or d.created_by=auth.uid()
    or exists(select 1 from public.crm_document_shares s where s.provider=d.provider
     and s.resource_id=d.resource_id and s.user_id=auth.uid() and s.revoked_at is null)) end));
$$;
create function app_private.contact_document_json(d public.crm_document_scopes) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('provider',d.provider,'resource_id',d.resource_id,'record_id',d.record_id,
  'module',d.module,'collection',d.collection,'folder',d.folder,'title',d.title,'bank',d.bank,
  'personal_contact',d.personal_contact,'document_type',d.document_type,'file_name',d.file_name,
  'mime_type',d.mime_type,'size_bytes',d.size_bytes,'expires_on',d.expires_on,
  'created_by',d.created_by,'created_by_label',(select u.email from auth.users u where u.id=d.created_by),'created_at',d.created_at,'operation_id',d.operation_id,'lifecycle',d.lifecycle,
  'revision',d.revision,'superseded_by',d.superseded_by,'withdrawn_at',d.withdrawn_at,
  'readonly',not app_private.contact_document_allowed(d.resource_id,true),
  'replaceable',app_private.contact_document_allowed(d.resource_id,true) and d.lifecycle='active',
  'deletable',app_private.contact_document_allowed(d.resource_id) and d.lifecycle in ('active','superseded')
   and (app_private.full_access() or d.created_by=auth.uid())
   and app_private.module_allowed('contacts',true,'delete') and app_private.module_allowed('documents',true,'delete'),
  'can_share',app_private.full_access(),
  'shared_with',case when app_private.full_access() then coalesce((select jsonb_agg(jsonb_build_object('user_id',s.user_id,'email',u.email))
   from public.crm_document_shares s join auth.users u on u.id=s.user_id where s.provider=d.provider
   and s.resource_id=d.resource_id and s.revoked_at is null),'[]'::jsonb) else '[]'::jsonb end);
$$;
create function app_private.contact_documents_revision(p_contact text) returns text
language sql stable security definer set search_path=pg_catalog as $$
 select md5(coalesce((select jsonb_agg(app_private.contact_document_json(d) order by d.resource_id)
  from public.crm_document_scopes d where d.personal_contact and d.record_id=p_contact
  and app_private.contact_document_allowed(d.resource_id)),'[]'::jsonb)::text);
$$;
create or replace function public.crm_mutate_record(p_module text,p_collection text,p_id text,p_patch jsonb,p_revision text,p_delete boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare w public.crm_workspace_state%rowtype; c app_private.module_collections%rowtype; oldrow jsonb; newrow jsonb; rows jsonb; kv record; target text; fk text;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.module_allowed(p_module,true,case when p_delete then 'delete' end) then raise exception 'module_forbidden' using errcode='42501'; end if;
 select * into c from app_private.module_collections where collection=p_collection and (module=p_module or (p_module='bookings' and collection='quotes'));
 if not found or p_delete is null or p_patch is null or p_id is null or p_id !~ '^[A-Za-z0-9_-]{1,100}$' or jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>32000 then raise exception 'invalid_mutation' using errcode='22023'; end if;
 if p_module='bookings' then
  if p_delete then raise exception 'booking_delete_forbidden_use_cancellation' using errcode='42501'; end if;
  if not app_private.module_allowed('quotes',true) then raise exception 'quotes_contribution_required' using errcode='42501'; end if;
  c.fields:=(select jsonb_object_agg(key,value) from jsonb_each(c.fields) where key=any(array['bookingStatus','supplierCost','depositReceived','balanceReceived','paymentStatus','expectedDeposit','paymentDueDate','clientConfirmed','depositConfirmed','supplierConfirmed','balanceConfirmed','detailsSent','serviceCompleted','assignedContactId']));
 end if;
 select * into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
 if p_revision is distinct from app_private.module_revision(p_module,w.payload) then raise exception 'revision_conflict' using errcode='40001'; end if;
 select r into oldrow from jsonb_array_elements(coalesce(w.payload->p_collection,'[]')) r where r->>'id'=p_id;
 if p_module='bookings' and (oldrow is null or oldrow->>'status' is distinct from 'Accepted') then raise exception 'accepted_quote_required'; end if;
 if p_delete then
  if oldrow is null then raise exception 'record_missing'; end if;
  perform app_private.guard_record_delete(p_collection,oldrow,w.payload);
  -- Conservative reference guard across all collections, without disclosing the referencing row.
  if exists(select 1 from jsonb_each(w.payload) col cross join lateral jsonb_array_elements(case when jsonb_typeof(col.value)='array' then col.value else '[]' end) r cross join lateral jsonb_each_text(case when jsonb_typeof(r)='object' then r else '{}' end) field
   where not(col.key=p_collection and r->>'id'=p_id) and field.key<>'id' and field.value=p_id) then raise exception 'record_referenced' using errcode='23503'; end if;
 else
  for kv in select * from jsonb_each(p_patch) loop
   if not(c.fields ? kv.key) or jsonb_typeof(kv.value) is distinct from c.fields->kv.key->>'type' then raise exception 'field_forbidden_or_invalid:%',kv.key using errcode='22023'; end if;
   if jsonb_typeof(kv.value)='string' and length(kv.value#>>'{}')>4000 then raise exception 'field_too_long'; end if;
   if jsonb_typeof(kv.value)='number' and ((kv.value#>>'{}')::numeric<0 or (kv.value#>>'{}')::numeric>100000000000) then raise exception 'number_out_of_range'; end if;
  end loop;
  if p_patch ? 'bookingStatus' and p_patch->>'bookingStatus' not in ('À préparer','Prestataire à confirmer','Confirmé','En cours','Terminé','Annulé') then raise exception 'invalid_booking_status'; end if;
  if p_collection='houseTimeEntries' and ((p_patch ? 'startTime' and p_patch->>'startTime' !~ '^([01][0-9]|2[0-3]):(00|15|30|45)$') or (p_patch ? 'endTime' and p_patch->>'endTime' !~ '^([01][0-9]|2[0-3]):(00|15|30|45)$')) then raise exception 'quarter_hour_required'; end if;
  perform app_private.validate_business_patch(p_collection,p_patch,oldrow,w.payload,c.fields);
  newrow:=coalesce(oldrow,jsonb_build_object('id',p_id,'createdAt',clock_timestamp(),'createdBy',auth.uid()))||p_patch||jsonb_build_object('updatedAt',clock_timestamp(),'updatedBy',auth.uid());
  if p_collection='contacts' and p_patch?'kind' and p_patch->>'kind'<>'Membre de l’organisation' then newrow:=newrow||jsonb_build_object('relationshipStatus',case when p_patch->>'kind'='Prestataire' then 'Prestataire' when oldrow->>'relationshipStatus'='Prestataire' then 'Prospect' else coalesce(newrow->>'relationshipStatus','Prospect') end); if p_patch->>'kind'<>'Prestataire' then newrow:=newrow||'{"supplierCategory":""}'; end if; end if;
  if p_collection='tasks' and p_patch?'status' then newrow:=newrow||jsonb_build_object('completedAt',case when p_patch->>'status'='Terminé' then clock_timestamp()::text else '' end); end if;
  if p_collection='vendorInvoices' and (p_patch?'paidAmount' or p_patch?'amount' or p_patch?'dueDate') then newrow:=newrow||jsonb_build_object('status',case when (newrow->>'paidAmount')::numeric>0 and (newrow->>'paidAmount')::numeric >= (newrow->>'amount')::numeric then 'Payé' when (newrow->>'paidAmount')::numeric>0 then 'Partiellement payé' when nullif(newrow->>'dueDate','')::date<current_date then 'En retard' else 'À payer' end); end if;
  foreach fk in array array['houseId','workerId'] loop
   if newrow ? fk then
    target:=case fk when 'houseId' then 'houseTrackingHouses' else 'houseTrackingWorkers' end;
    if not exists(select 1 from jsonb_array_elements(coalesce(w.payload->target,'[]')) r where r->>'id'=newrow->>fk) then raise exception 'invalid_reference' using errcode='23503'; end if;
   end if;
  end loop;
  if oldrow is null then
   newrow:=case p_collection
    when 'contacts' then '{"name":"","kind":"Client","email":"","phone":"","city":"","postalAddress":"","budget":0,"source":"","notes":""}'::jsonb
    when 'tasks' then '{"title":"","owner":"","status":"À faire","dueDate":"","linkedTo":""}'::jsonb
    when 'leads' then '{"category":"Conciergerie","contactName":"","status":"Nouveau","value":0,"priority":"Moyenne","nextAction":"","notes":"","dueDate":"","rentalStartDate":"","rentalEndDate":""}'::jsonb
    when 'properties' then '{"name":"","city":"","type":"","price":0,"status":"Disponible","owner":"","bedrooms":0,"surface":0}'::jsonb
    when 'vehicles' then '{"name":"","brand":"","model":"","city":"","price":0,"status":"Disponible","owner":"","year":0,"mileage":0}'::jsonb
    when 'boats' then '{"name":"","port":"","type":"","price":0,"status":"Disponible","owner":"","year":0,"length":0}'::jsonb
    when 'quotes' then '{"title":"","clientName":"","status":"Draft","categories":[],"items":[],"unitPrice":0,"startDate":"","endDate":"","notes":""}'::jsonb
    when 'planningEntries' then '{"title":"","type":"Autre","contactName":"","startDate":"","endDate":"","blocksAvailability":false}'::jsonb
    when 'houseTrackingHouses' then '{"name":"","address":""}'::jsonb
    when 'houseTrackingWorkers' then '{"contactName":"","contactId":"","role":"","hourlyRate":0,"status":"Actif"}'::jsonb
    when 'houseTimeEntries' then '{"houseId":"","houseName":"","workerId":"","workerName":"","date":"","startTime":"","endTime":"","breakMinutes":0,"hourlyRate":0}'::jsonb
    when 'housePayments' then '{"houseId":"","houseName":"","workerId":"","workerName":"","date":"","amount":0,"method":"Autre"}'::jsonb
    else '{}'::jsonb end || newrow;
   if p_collection in ('contacts','properties','vehicles','boats','houseTrackingHouses') and length(btrim(newrow->>'name'))=0 then raise exception 'name_required'; end if;
   if p_collection in ('tasks','quotes','vendorQuotes','vendorInvoices','planningEntries') and length(btrim(coalesce(newrow->>'title','')))=0 then raise exception 'title_required'; end if;
   if p_collection in ('houseTimeEntries','housePayments') and (coalesce(newrow->>'houseId','')='' or coalesce(newrow->>'workerId','')='' or coalesce(newrow->>'date','')='') then raise exception 'house_worker_date_required'; end if;
   if p_module='bookings'  then raise exception 'existing_quote_required'; end if;
   if p_collection='vendorQuotes' then newrow:='{"status":"À valider","contactId":"","contactName":""}'::jsonb||newrow; end if;
   if p_collection='vendorInvoices' then newrow:='{"status":"À payer","paidAmount":0,"contactId":"","contactName":""}'::jsonb||newrow; end if;
  end if;
 end if;
 select coalesce(jsonb_agg(case when r->>'id'=p_id then newrow else r end),'[]') into rows from jsonb_array_elements(coalesce(w.payload->p_collection,'[]')) r where not(p_delete and r->>'id'=p_id);
 if oldrow is null and not p_delete then rows:=rows||jsonb_build_array(newrow); end if;
 update public.crm_workspace_state set payload=jsonb_set(w.payload,array[p_collection],rows),updated_by=auth.uid() where workspace_id=w.workspace_id;
 return public.crm_read_module(p_module);
end $$;

create or replace function app_private.document_allowed(p_provider text,p_resource text,p_write boolean default false,p_download boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select p_write is not null and p_download is not null
 and not exists(select 1 from app_private.document_drive_trash t where t.provider=p_provider and t.resource_id=p_resource)
 and case when exists(select 1 from public.crm_document_scopes d where d.resource_id=p_resource and d.personal_contact) then
  p_provider='storage' and app_private.contact_document_allowed(p_resource,p_write,p_download)
 else (app_private.full_access() and (not exists(select 1 from public.crm_document_scopes d
  where d.provider=p_provider and d.resource_id=p_resource and d.collection='documents')
  or app_private.document_actor_active(auth.uid()))
 or exists(select 1 from public.crm_document_scopes d
  join public.crm_workspace_state w on w.workspace_id='oneaddress-riviera'
  where d.provider=p_provider and d.resource_id=p_resource
  and app_private.module_allowed('documents',p_write,case when p_download then 'export' end)
  and case when d.module='documents' or d.collection='documents' then
   d.module='documents' and d.collection='documents' and not d.bank and not p_write
   and app_private.document_actor_active(auth.uid())
   and app_private.general_document_entry(d.provider,d.resource_id,d.record_id) is not null
   and not app_private.document_has_business_reference(d.resource_id)
   and exists(select 1 from public.crm_document_shares s
    where s.provider=d.provider and s.resource_id=d.resource_id and s.user_id=auth.uid() and s.revoked_at is null)
  else
   app_private.module_allowed(d.module,p_write,case when p_download then 'export' end)
   and (not d.bank or app_private.module_allowed('contacts',p_write,case when p_write then 'bank_write' else 'bank_read' end))
   and exists(select 1 from jsonb_array_elements(coalesce(w.payload->d.collection,'[]')) r where r->>'id'=d.record_id)
  end)) end;
$$;

create or replace function public.crm_read_module(p_module text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare w jsonb; result jsonb:='{}'; c record; rows jsonb;
begin
 if not app_private.module_allowed(p_module) then raise exception 'module_forbidden' using errcode='42501'; end if;
 select payload into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera';
 if p_module='dashboard' then
  for c in select * from app_private.module_collections where app_private.module_allowed(module) loop
   if c.collection='documents' then
    result:=result||jsonb_build_object('documents',(select count(*) from public.crm_document_scopes d where app_private.document_allowed(d.provider,d.resource_id)));
   else
    result:=result||jsonb_build_object(c.collection,jsonb_array_length(coalesce(w->c.collection,'[]')));
   end if;
  end loop;
 elsif p_module='documents' then
  if not app_private.document_actor_active(auth.uid()) then raise exception 'document_actor_inactive' using errcode='42501'; end if;
  select coalesce(jsonb_agg(case when personal_contact then app_private.contact_document_json(crm_document_scopes) else jsonb_build_object('provider',provider,'resource_id',resource_id,'title',title,'module',module,'bank',bank,'folder',folder,'collection',collection,'record_id',record_id,'superseded_by',superseded_by,'readonly',module='documents' and collection='documents' and not app_private.full_access(),'replaceable',provider='storage' and app_private.document_replaceable(resource_id),'deletable',provider='storage' and app_private.document_deletable(resource_id)) end),'[]') into rows from public.crm_document_scopes where app_private.document_allowed(provider,resource_id);
  result:=jsonb_build_object('documents',rows);
 elsif p_module='bookings' then
  select coalesce(jsonb_agg(app_private.project_record('quotes',r)||jsonb_build_object('bookingStatus',r->'bookingStatus')),'[]') into rows from jsonb_array_elements(coalesce(w->'quotes','[]')) r where r->>'status'='Accepted';
  result:=jsonb_build_object('bookings',rows);
 else
  for c in select * from app_private.module_collections where module=p_module loop
   select coalesce(jsonb_agg(app_private.project_record(c.collection,r)),'[]') into rows from jsonb_array_elements(coalesce(w->c.collection,'[]')) r;
   result:=result||jsonb_build_object(c.collection,rows);
  end loop;
 end if;
 -- Revision fingerprint contains no payload and is scoped to the module, including hidden fields for conflict detection.
 return jsonb_build_object('collections',result,'revision',app_private.module_revision(p_module,w));
end $$;

create or replace function app_private.guard_document_shares() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.uid() is not null and not app_private.full_access() then
  raise exception 'document_sharing_forbidden' using errcode='42501';
 end if;
 if tg_op<>'DELETE' and not exists(select 1 from public.crm_document_scopes d
  where d.provider=new.provider and d.resource_id=new.resource_id
  and ((d.module='documents' and d.collection='documents' and not d.bank)
   or (d.personal_contact and d.lifecycle in ('active','superseded') and not d.bank))) then
  raise exception 'protected_document_scope' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;

-- Legacy classification/update/replacement APIs cannot convert or edit a private
-- contact document. Only the confirmed, revision-checked operations below do so.
create function app_private.guard_contact_document_scope() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if (tg_op<>'INSERT' and old.personal_contact) or (tg_op<>'DELETE' and new.personal_contact) then
  if current_setting('app.contact_document_mutation',true) is distinct from 'confirmed' then
   raise exception 'contact_document_explicit_operation_required' using errcode='42501';
  end if;
  if tg_op='DELETE' then raise exception 'contact_document_retention_required' using errcode='42501'; end if;
  if tg_op='UPDATE' and (old.provider,old.resource_id,old.collection,old.module,old.record_id,old.personal_contact,
    old.document_type,old.file_name,old.mime_type,old.size_bytes,old.expires_on,old.created_by,old.created_at,old.operation_id,old.bank)
   is distinct from (new.provider,new.resource_id,new.collection,new.module,new.record_id,new.personal_contact,
    new.document_type,new.file_name,new.mime_type,new.size_bytes,new.expires_on,new.created_by,new.created_at,new.operation_id,new.bank) then
   raise exception 'contact_document_identity_immutable' using errcode='42501';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger crm_guard_contact_document_scope before insert or update or delete on public.crm_document_scopes
 for each row execute function app_private.guard_contact_document_scope();

create function app_private.is_contact_document(p_resource text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.crm_document_scopes d where d.provider='storage' and d.resource_id=p_resource and d.personal_contact);
$$;
revoke all on function app_private.is_contact_document(text) from public,anon,authenticated;
grant execute on function app_private.is_contact_document(text) to authenticated;

-- Personal files always use the current-rights byte proxy. Storage SELECT also
-- authorizes signed URLs, so denying it avoids capabilities surviving revocation.
create policy contact_documents_no_direct_read on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'crm-documents' or not app_private.is_contact_document(name));
create policy contact_documents_no_overwrite on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'crm-documents' or not app_private.is_contact_document(name))
 with check(bucket_id<>'crm-documents' or not app_private.is_contact_document(name));
create policy contact_documents_keep_retained_bytes on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'crm-documents' or not app_private.is_contact_document(name));

create function public.crm_contact_documents(p_contact text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare rows jsonb;
begin
 if not app_private.contact_document_session() or not app_private.module_allowed('contacts')
  or not app_private.module_allowed('documents') then raise exception 'contact_documents_forbidden' using errcode='42501'; end if;
 if not app_private.contact_document_contact_exists(p_contact) then raise exception 'invalid_document_owner' using errcode='42501'; end if;
 select coalesce(jsonb_agg(case when d.personal_contact then app_private.contact_document_json(d) else
  jsonb_build_object('provider',d.provider,'resource_id',d.resource_id,'record_id',d.record_id,'module',d.module,
   'collection',d.collection,'folder',d.folder,'title',d.title,'bank',d.bank,'personal_contact',false,
   'superseded_by',d.superseded_by,'readonly',true,'replaceable',false,'deletable',false,'can_share',false) end
  order by d.created_at desc nulls last,d.resource_id),'[]') into rows
 from public.crm_document_scopes d where d.collection='contacts' and d.record_id=p_contact
 and app_private.document_allowed(d.provider,d.resource_id);
 return jsonb_build_object('documents',rows,'revision',app_private.contact_documents_revision(p_contact));
end $$;

create function public.crm_contact_document_begin(
 p_operation uuid,p_contact text,p_title text,p_type text,p_filename text,p_mime text,p_size bigint,
 p_expiry text default null,p_revision text default null
) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.crm_document_scopes%rowtype; expiry date;
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.contact_document_session() or not app_private.module_allowed('contacts',true)
 or not app_private.module_allowed('documents',true) then raise exception 'contact_documents_forbidden' using errcode='42501'; end if;
 if not app_private.contact_document_contact_exists(p_contact) then raise exception 'invalid_document_owner' using errcode='42501'; end if;
 if p_operation is null or p_title is null or length(btrim(p_title)) not between 1 and 200
 or p_filename is null or length(btrim(p_filename)) not between 1 and 240 or p_filename ~ '[[:cntrl:]/\\]'
 or p_type is null or p_type not in ('Carte d’identité','Passeport','Permis de conduire','Permis bateau','Contrat','Autre')
 or p_mime is null or p_mime not in ('application/pdf','image/jpeg','image/png')
 or p_size is null or p_size not between 1 and 25000000 then raise exception 'invalid_contact_document_metadata' using errcode='22023'; end if;
 if nullif(p_expiry,'') is not null then
  if p_expiry !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid_expiration_date' using errcode='22023'; end if;
  expiry:=p_expiry::date;
 end if;
 select * into d from public.crm_document_scopes where operation_id=p_operation for update;
 if found then
  if not d.personal_contact or d.created_by is distinct from auth.uid() or d.record_id<>p_contact
   or d.title<>btrim(p_title) or d.document_type<>p_type or d.file_name<>btrim(p_filename)
   or d.mime_type<>p_mime or d.size_bytes<>p_size or d.expires_on is distinct from expiry then
   raise exception 'contact_document_operation_conflict' using errcode='40001'; end if;
  return app_private.contact_document_json(d);
 end if;
 if p_revision is not null and p_revision is distinct from app_private.contact_documents_revision(p_contact) then
  raise exception 'revision_conflict' using errcode='40001'; end if;
 perform set_config('app.contact_document_mutation','confirmed',true);
 insert into public.crm_document_scopes(provider,resource_id,module,collection,record_id,title,folder,bank,
  personal_contact,document_type,file_name,mime_type,size_bytes,expires_on,created_by,created_at,operation_id,lifecycle)
 values('storage','contact-private/'||p_operation::text,'contacts','contacts',p_contact,btrim(p_title),'Documents du contact',false,
  true,p_type,btrim(p_filename),p_mime,p_size,expiry,auth.uid(),clock_timestamp(),p_operation,'pending') returning * into d;
 insert into public.crm_permission_events(actor_id,action,detail) values(auth.uid(),'contact_document_reserved',
  jsonb_build_object('operation_id',p_operation,'contact_id',p_contact));
 return app_private.contact_document_json(d);
end $$;

create function public.crm_contact_document_complete(p_operation uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.crm_document_scopes%rowtype; object record;
begin
 perform pg_advisory_xact_lock(734991);
 select * into d from public.crm_document_scopes where operation_id=p_operation for update;
 if not found or not d.personal_contact or not app_private.contact_document_allowed(d.resource_id,true) then
  raise exception 'contact_document_write_forbidden' using errcode='42501'; end if;
 if d.lifecycle='active' then return app_private.contact_document_json(d); end if;
 select metadata into object from storage.objects where bucket_id='crm-documents' and name=d.resource_id;
 if not found or (object.metadata->>'size')::bigint is distinct from d.size_bytes
 or object.metadata->>'mimetype' is distinct from d.mime_type then
  raise exception 'contact_document_upload_unconfirmed' using errcode='23514'; end if;
 perform set_config('app.contact_document_mutation','confirmed',true);
 update public.crm_document_scopes set lifecycle='active',revision=revision+1 where provider=d.provider and resource_id=d.resource_id returning * into d;
 insert into public.crm_permission_events(actor_id,action,detail) values(auth.uid(),'contact_document_confirmed',
  jsonb_build_object('operation_id',p_operation,'contact_id',d.record_id));
 return app_private.contact_document_json(d);
end $$;

create function public.crm_contact_document_cancel(p_operation uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.crm_document_scopes%rowtype;
begin
 perform pg_advisory_xact_lock(734991);
 select * into d from public.crm_document_scopes where operation_id=p_operation for update;
 if not found or not d.personal_contact or not app_private.contact_document_session()
 or not app_private.module_allowed('contacts',true) or not app_private.module_allowed('documents',true)
 or (not app_private.full_access() and d.created_by is distinct from auth.uid()) then
  raise exception 'contact_document_write_forbidden' using errcode='42501'; end if;
 if d.lifecycle='withdrawn' then return app_private.contact_document_json(d); end if;
 if d.lifecycle<>'pending' then raise exception 'contact_document_already_confirmed' using errcode='40001'; end if;
 perform set_config('app.contact_document_mutation','confirmed',true);
 update public.crm_document_scopes set lifecycle='withdrawn',withdrawn_at=clock_timestamp(),revision=revision+1
  where provider=d.provider and resource_id=d.resource_id returning * into d;
 return app_private.contact_document_json(d);
end $$;

create function public.crm_contact_document_withdraw(p_resource text,p_revision bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.crm_document_scopes%rowtype;
begin
 perform pg_advisory_xact_lock(734991);
 select * into d from public.crm_document_scopes where provider='storage' and resource_id=p_resource for update;
 if not found or not d.personal_contact or not app_private.contact_document_session()
 or not app_private.module_allowed('contacts',true,'delete') or not app_private.module_allowed('documents',true,'delete')
 or (not app_private.full_access() and d.created_by is distinct from auth.uid())
 or not app_private.contact_document_contact_exists(d.record_id) then raise exception 'contact_document_delete_forbidden' using errcode='42501'; end if;
 if d.lifecycle='withdrawn' then return app_private.contact_document_json(d); end if;
 if d.lifecycle not in ('active','superseded') then raise exception 'contact_document_upload_unconfirmed' using errcode='40001'; end if;
 if p_revision is distinct from d.revision then raise exception 'revision_conflict' using errcode='40001'; end if;
 perform set_config('app.contact_document_mutation','confirmed',true);
 update public.crm_document_scopes set lifecycle='withdrawn',withdrawn_at=clock_timestamp(),revision=revision+1
  where provider=d.provider and resource_id=d.resource_id returning * into d;
 insert into public.crm_permission_events(actor_id,action,detail) values(auth.uid(),'contact_document_withdrawn',
  jsonb_build_object('operation_id',d.operation_id,'contact_id',d.record_id,'retained',true));
 return app_private.contact_document_json(d);
end $$;

create function public.crm_contact_document_replace(p_previous text,p_next text,p_revision bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare old_doc public.crm_document_scopes%rowtype; next_doc public.crm_document_scopes%rowtype;
begin
 perform pg_advisory_xact_lock(734991);
 select * into old_doc from public.crm_document_scopes where provider='storage' and resource_id=p_previous for update;
 select * into next_doc from public.crm_document_scopes where provider='storage' and resource_id=p_next for update;
 if old_doc.personal_contact and old_doc.superseded_by=p_next and next_doc.personal_contact
  and app_private.contact_document_allowed(p_next,true) then return app_private.contact_document_json(next_doc); end if;
 if old_doc.resource_id is null or next_doc.resource_id is null or p_previous=p_next or not old_doc.personal_contact
 or not next_doc.personal_contact or old_doc.record_id<>next_doc.record_id or old_doc.lifecycle<>'active'
 or next_doc.lifecycle<>'active' or old_doc.superseded_by is not null or next_doc.superseded_by is not null
 or not app_private.contact_document_allowed(p_previous,true) or not app_private.contact_document_allowed(p_next,true) then
  raise exception 'replacement_forbidden' using errcode='42501'; end if;
 if p_revision is distinct from old_doc.revision then raise exception 'revision_conflict' using errcode='40001'; end if;
 perform set_config('app.contact_document_mutation','confirmed',true);
 update public.crm_document_scopes set lifecycle='superseded',superseded_by=p_next,revision=revision+1
  where provider='storage' and resource_id=p_previous;
 insert into public.crm_permission_events(actor_id,action,detail) values(auth.uid(),'contact_document_replaced',
  jsonb_build_object('previous',p_previous,'next',p_next,'contact_id',old_doc.record_id,'retained',true));
 -- Each new version is private by default; existing shares are never copied.
 return app_private.contact_document_json(next_doc);
end $$;

create function public.crm_share_contact_document(p_resource text,p_user uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.crm_document_scopes%rowtype;
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.full_access() or not app_private.contact_document_session() then
  raise exception 'document_sharing_forbidden' using errcode='42501'; end if;
 select * into d from public.crm_document_scopes where provider='storage' and resource_id=p_resource and personal_contact;
 if not found or not app_private.contact_document_allowed(p_resource) then raise exception 'protected_document_scope' using errcode='42501'; end if;
 if not app_private.document_actor_active(p_user) or not exists(select 1 from public.crm_access_profiles p
  join public.app_memberships m using(user_id) where p.user_id=p_user and p.active and m.workspace_id='oar' and m.status='active'
  and (select count(*) from public.crm_module_grants g where g.user_id=p_user and g.module in ('contacts','documents')
   and g.level in ('read','contribute'))=2) then raise exception 'inactive_document_recipient' using errcode='42501'; end if;
 insert into public.crm_document_shares(provider,resource_id,user_id,created_by) values('storage',p_resource,p_user,auth.uid())
 on conflict(provider,resource_id,user_id) do update set revoked_at=null,created_by=excluded.created_by,created_at=clock_timestamp();
 insert into public.crm_permission_events(actor_id,subject_id,action,detail) values(auth.uid(),p_user,'contact_document_shared',
  jsonb_build_object('provider','storage','resource_id',p_resource,'contact_id',d.record_id));
end $$;

-- The byte proxy gets only the currently allowed file metadata, never a signed
-- URL. Export remains a separate permission on both Contacts and Documents.
create function public.crm_contact_document_file(p_resource text,p_download boolean default false) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare d public.crm_document_scopes%rowtype;
begin
 if not app_private.contact_document_allowed(p_resource,false,p_download) then
  raise exception 'contact_document_read_forbidden' using errcode='42501'; end if;
 select * into d from public.crm_document_scopes where provider='storage' and resource_id=p_resource and personal_contact;
 return jsonb_build_object('resource_id',d.resource_id,'file_name',d.file_name,'mime_type',d.mime_type,'size_bytes',d.size_bytes);
end $$;

create or replace function public.crm_export_module(p_module text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb; rows jsonb;
begin
 if not app_private.module_allowed(p_module,false,'export') then raise exception 'export_forbidden' using errcode='42501'; end if;
 result:=public.crm_read_module(p_module);
 if p_module='documents' then
  select coalesce(jsonb_agg(d),'[]') into rows from jsonb_array_elements(result->'collections'->'documents') d
  where coalesce((d->>'personal_contact')::boolean,false)=false
   or app_private.contact_document_allowed(d->>'resource_id',false,true);
  result:=jsonb_set(result,'{collections,documents}',rows);
  result:=jsonb_set(result,'{revision}',to_jsonb(md5(rows::text)));
 end if;
 return result;
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='app_private' and p.proname like 'contact_document%')
 or (n.nspname='app_private' and p.proname='guard_contact_document_scope')
 or (n.nspname='public' and (p.proname like 'crm_contact_document%' or p.proname='crm_share_contact_document')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.nspname='public' then execute format('grant execute on function %s to authenticated',f.signature); end if;
 end loop;
end $$;
create or replace function public.crm_reference_options(p_module text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare data jsonb; result jsonb:='{}'; c record;
begin
 data:=public.crm_read_module(p_module)->'collections';
 for c in select * from jsonb_each(data) loop
 if jsonb_typeof(c.value)='array' then
 result:=result||jsonb_build_object(c.key,coalesce((select jsonb_agg((select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(r) where key=any(array['id','clientName','supplierCost','paymentStatus','expectedDeposit','name','firstName','companyName','kind','organizationFunction','supplierCategory','supplierContactName','supplierStatus','title','contactName','category','assetType','assetId','rentalStartDate','rentalEndDate','status','city','port','brand','model','price','startDate','endDate','startTime','endTime','blocksAvailability','dueDate','nextAction','value','owner','amount','paidAmount','invoiceDate','invoiceReference','sourceQuoteId','sourceQuoteReference','linkedInvoiceId','quoteReference','contactId','contactPersonName','unitPrice','items','categories','depositReceived','balanceReceived','paymentDueDate','bookingStatus','startDate','endDate','createdAt','updatedAt','hourlyRate','breakMinutes','date','houseId','workerId']))) from jsonb_array_elements(c.value) r),'[]'));
 end if;
 end loop;
 return result;
end $$;
create or replace function public.crm_new_document(p_collection text,p_record text,p_title text,p_bank boolean default false) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare m text; path text:='classified/'||gen_random_uuid()::text;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if p_collection='contacts' and not coalesce(p_bank,false) then raise exception 'contact_document_explicit_operation_required' using errcode='42501'; end if;
 select module into m from app_private.module_collections where collection=p_collection;
 if m is null or not app_private.module_allowed('documents',true) or not app_private.module_allowed(m,true) then raise exception 'document_write_forbidden' using errcode='42501'; end if;
 if p_bank and (p_collection<>'contacts' or not app_private.module_allowed('contacts',true,'bank_write')) then raise exception 'bank_write_forbidden' using errcode='42501'; end if;
 if length(p_title) not between 1 and 200 or not exists(select 1 from public.crm_workspace_state w cross join lateral jsonb_array_elements(coalesce(w.payload->p_collection,'[]'))r where w.workspace_id='oneaddress-riviera' and r->>'id'=p_record) then raise exception 'invalid_document_owner'; end if;
 insert into public.crm_document_scopes(provider,resource_id,module,collection,record_id,title,bank) values('storage',path,m,p_collection,p_record,p_title,p_bank);
 return path;
end $$;
-- A contact with retained personal files cannot disappear in a stale/full save.
create function app_private.guard_contact_document_references() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if new.workspace_id='oneaddress-riviera' and exists(select 1 from public.crm_document_scopes d
 where d.personal_contact and (select count(*) from jsonb_array_elements(coalesce(new.payload->'contacts','[]')) r
  where r->>'id'=d.record_id)<>1) then
  raise exception 'contact_has_retained_documents' using errcode='23503';
 end if;
 return new;
end $$;
create trigger crm_guard_contact_document_references before insert or update of payload on public.crm_workspace_state
 for each row execute function app_private.guard_contact_document_references();
revoke all on function app_private.guard_contact_document_references() from public,anon,authenticated;
-- Apply the same changed-field validation to the full-access save path. Legacy
-- untouched contacts retain their historical values and omitted fields survive
-- a supplier-to-member transition.
create function app_private.guard_contact_classification() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare r jsonb; prior jsonb; rows jsonb:='[]';
begin
 if new.workspace_id<>'oneaddress-riviera' or (tg_op='UPDATE' and old.payload->'contacts' is not distinct from new.payload->'contacts') then return new; end if;
 for r in select value from jsonb_array_elements(coalesce(new.payload->'contacts','[]')) loop
  prior:=null;
  if tg_op='UPDATE' then select value into prior from jsonb_array_elements(coalesce(old.payload->'contacts','[]')) where value->>'id'=r->>'id'; end if;
  if prior is null or r->'kind' is distinct from prior->'kind' then
   if r->>'kind' is null or r->>'kind' not in ('Client','Propriétaire','Prestataire','Membre de l’organisation') then
    raise exception 'invalid_contact_kind' using errcode='22023'; end if;
  end if;
  if r?'organizationFunction' and (prior is null or r->'organizationFunction' is distinct from prior->'organizationFunction')
   and (jsonb_typeof(r->'organizationFunction')<>'string' or length(r->>'organizationFunction')>4000) then
    raise exception 'invalid_organization_function' using errcode='22023';
  end if;
  if prior->>'kind'='Prestataire' and r->>'kind'='Membre de l’organisation' then r:=prior||r; end if;
  rows:=rows||jsonb_build_array(r);
 end loop;
 new.payload:=jsonb_set(new.payload,'{contacts}',rows);
 return new;
end $$;
create trigger crm_guard_contact_classification before insert or update of payload on public.crm_workspace_state
 for each row execute function app_private.guard_contact_classification();
revoke all on function app_private.guard_contact_classification() from public,anon,authenticated;
create or replace function public.crm_classify_document(p_provider text,p_resource text,p_collection text,p_record text,p_title text,p_bank boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare m text;
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.general_admin() then raise exception 'general_admin_required' using errcode='42501'; end if;
 -- New personal contact associations require the private, confirmed upload path.
 -- An unchanged established business association remains editable as before.
 if p_collection='contacts' and not coalesce(p_bank,false) and not exists(
  select 1 from public.crm_document_scopes d where d.provider=p_provider and d.resource_id=p_resource
  and d.collection='contacts' and d.module='contacts' and d.record_id=p_record and not d.bank and not d.personal_contact
 ) then raise exception 'contact_document_explicit_operation_required' using errcode='42501'; end if;
 select module into m from app_private.module_collections where collection=p_collection;
 if m is null or p_resource is null or length(p_resource) not between 1 and 500 or length(p_title) not between 1 and 200 or not exists(select 1 from public.crm_workspace_state w cross join lateral jsonb_array_elements(coalesce(w.payload->p_collection,'[]')) r where w.workspace_id='oneaddress-riviera' and r->>'id'=p_record) then raise exception 'invalid_document_owner'; end if;
 if p_bank and p_collection<>'contacts' then raise exception 'bank_contact_required'; end if;
 insert into public.crm_document_scopes(provider,resource_id,module,collection,record_id,title,bank) values(p_provider,p_resource,m,p_collection,p_record,p_title,p_bank)
 on conflict(provider,resource_id) do update set module=excluded.module,collection=excluded.collection,record_id=excluded.record_id,title=excluded.title,bank=excluded.bank;
 insert into public.crm_permission_events(actor_id,action,detail) values(auth.uid(),'document_classified',jsonb_build_object('module',m,'bank',p_bank));
end $$;
notify pgrst,'reload schema';
commit;
