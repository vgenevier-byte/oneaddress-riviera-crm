-- Explicit person/company Contacts, with compatibility for unqualified records.
-- ONE additive migration. No data backfill, reclassification, identity linkage,
-- role/grant change, public signature change, or weakening of canonical Tasks.
-- The replaced bodies were read from the installed project on 2026-10-08;
-- all non-Contacts branches remain unchanged.
begin;

update app_private.module_collections
 set fields=fields||'{"entityType":{"type":"string","label":"Nature de la fiche","enum":["person","company"]}}'::jsonb
 where collection='contacts' and module='contacts';

-- Contacts identity is explicit and independent from kind/category.
-- Empty-text check mirrors ECMAScript String.trim() exactly; it never rewrites data.
create function app_private.contact_identity_blank(v jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $$
 select jsonb_typeof(v) is distinct from 'string' or btrim(v#>>'{}',
 chr(32)||chr(9)||chr(10)||chr(13)||chr(12)||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279))='';
$$;
create function app_private.validate_contact_identity(final_row jsonb, prior_row jsonb) returns void
language plpgsql set search_path=pg_catalog as $$
declare identity_changed boolean;
begin
 if final_row?'entityType' then
  if jsonb_typeof(final_row->'entityType') is distinct from 'string'
   or final_row->>'entityType' not in ('person','company') then
   raise exception 'contact_entity_type_invalid' using errcode='22023';
  end if;
  if final_row->>'entityType'='company' then
   if app_private.contact_identity_blank(final_row->'companyName') then
    raise exception 'contact_company_name_required' using errcode='22023';
   end if;
  elsif app_private.contact_identity_blank(final_row->'name') then
   raise exception 'contact_name_required' using errcode='22023';
  end if;
 else
  -- Old clients can still create a named person without qualifying the record.
  -- Historical unqualified records are not reclassified or forced through a
  -- new identity choice for an unrelated edit (including old blank names).
  identity_changed:=prior_row is null or exists(select 1
   from unnest(array['name','firstName','companyName','civility']) k
   where final_row->k is distinct from prior_row->k);
  if identity_changed and app_private.contact_identity_blank(final_row->'name') then
   raise exception 'contact_name_required' using errcode='22023';
  end if;
 end if;
end $$;
revoke all on function app_private.contact_identity_blank(jsonb),app_private.validate_contact_identity(jsonb,jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION app_private.validate_business_patch(c text, p jsonb, oldrow jsonb, w jsonb, fields jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare kv record; row jsonb:=coalesce(oldrow,'{}')||p; target text; item jsonb; d date; m text;
begin
 select module into m from app_private.module_collections where collection=c;
 if p?'title' and btrim(p->>'title')='' then raise exception 'title_required'; end if;
 if c='contacts' then perform app_private.validate_contact_identity(row,oldrow);
 elsif p?'name' and btrim(p->>'name')='' then raise exception 'name_required'; end if;
 for kv in select * from jsonb_each(p) loop
  if fields->kv.key?'requires' and not app_private.module_allowed(fields->kv.key->>'requires') then raise exception 'reference_module_forbidden' using errcode='42501'; end if;
  if fields->kv.key?'writeSensitive' and not app_private.module_allowed(m,true,fields->kv.key->>'writeSensitive') then raise exception 'sensitive_field_forbidden' using errcode='42501'; end if;
  if fields->kv.key?'enum' and not(fields->kv.key->'enum' @> jsonb_build_array(kv.value)) then raise exception 'invalid_business_enum:%',kv.key; end if;
  if fields->kv.key?'date' and kv.value#>>'{}'<>'' then
   if kv.value#>>'{}' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_business_date'; end if;
   d:=(kv.value#>>'{}')::date;
  end if;
  if kv.key like '%StoragePath' and kv.value#>>'{}'<>'' and not exists(select 1 from public.crm_document_scopes x where x.provider='storage' and x.resource_id=kv.value#>>'{}' and x.collection=c and x.record_id=row->>'id' and app_private.document_allowed('storage',x.resource_id,true)) then raise exception 'document_reference_forbidden'; end if;
 end loop;
 if (p?'startDate' or p?'endDate') and nullif(row->>'endDate','')::date<nullif(row->>'startDate','')::date then raise exception 'invalid_date_order'; end if;
 if (p?'rentalStartDate' or p?'rentalEndDate') and nullif(row->>'rentalEndDate','')::date<nullif(row->>'rentalStartDate','')::date then raise exception 'invalid_date_order'; end if;
 if p?'assetId' or p?'assetType' then
  target:=case row->>'assetType' when 'Property' then 'properties' when 'Vehicle' then 'vehicles' when 'Boat' then 'boats' end;
  if coalesce(row->>'assetId','')<>'' and (target is null or not app_private.module_allowed(target) or not exists(select 1 from jsonb_array_elements(coalesce(w->target,'[]')) r where r->>'id'=row->>'assetId')) then raise exception 'asset_reference_forbidden'; end if;
 end if;
 if p?'linkedTo' or p?'leadId' then
  if coalesce(p->>'linkedTo',p->>'leadId','')<>'' and not exists(select 1 from jsonb_array_elements(coalesce(w->'leads','[]')) r where r->>'id'=coalesce(p->>'linkedTo',p->>'leadId')) then raise exception 'invalid_lead_reference'; end if;
 end if;
 if p?'contactId' or p?'assignedContactId' then
  if coalesce(p->>'contactId',p->>'assignedContactId','')<>'' and not exists(select 1 from jsonb_array_elements(coalesce(w->'contacts','[]')) r where r->>'id'=coalesce(p->>'contactId',p->>'assignedContactId')) then raise exception 'invalid_contact_reference'; end if;
 end if;
 if c='vendorInvoices' then
  if p?'paidAmount' and (p->>'paidAmount')::numeric>coalesce((oldrow->>'paidAmount')::numeric,0) and not exists(select 1 from jsonb_array_elements(coalesce(w->'contacts','[]')) contact cross join lateral jsonb_array_elements(coalesce(contact->'supplierBankAccounts','[]')) a where contact->>'id'=row->>'contactId' and a->>'id'=row->>'paymentBankAccountId' and a->>'status'='Vérifié') then raise exception 'verified_payment_account_required'; end if;
  if coalesce(oldrow->>'paymentBankAccountId','')<>'' and p?'contactId' and p->>'contactId' is distinct from oldrow->>'contactId' then raise exception 'payment_contact_locked'; end if;
  if p?'paidAmount' and (p->>'paidAmount')::numeric>0 and not exists(select 1 from public.crm_document_scopes x where x.collection=c and x.record_id=row->>'id') and coalesce(oldrow->>'invoiceDocumentStoragePath',oldrow->>'invoiceDocumentUrl','')='' then raise exception 'invoice_document_required'; end if;
 end if;
 if c='quotes' and p?'items' then
  if jsonb_array_length(p->'items')>100 then raise exception 'too_many_quote_lines'; end if;
  for item in select value from jsonb_array_elements(p->'items') loop
   if jsonb_typeof(item)<>'object' or item-array['id','category','description','unitPrice','billingUnit','deposit']<>'{}' or jsonb_typeof(item->'unitPrice') is distinct from 'number' or (item->>'unitPrice')::numeric<0 or coalesce(item->>'billingUnit','') not in ('day','week','fixed') or item->>'category' not in ('Villa','Bateau','Voiture','Conciergerie') or jsonb_typeof(item->'description') is distinct from 'string' or length(item->>'description')>4000 or jsonb_typeof(item->'deposit') is distinct from 'number' or (item->>'deposit')::numeric<0 then raise exception 'invalid_quote_line'; end if;
  end loop;
 end if;
end $function$;

CREATE OR REPLACE FUNCTION app_private.tasks_previous_mutate_record(p_module text, p_collection text, p_id text, p_patch jsonb, p_revision text, p_delete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
 -- These private scalar fields already belong to the owner global workflow.
 -- Never add them to the shared catalogue or limited read projection.
 if p_collection='contacts' and app_private.full_access() then
  c.fields:=c.fields||'{"notes":{"type":"string"},"preferences":{"type":"string"},"importantNotes":{"type":"string"},"supplierPriceNotes":{"type":"string"},"supplierCommissionNotes":{"type":"string"}}'::jsonb;
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
  if p_collection='contacts' and p_patch?'entityType' and
   (jsonb_typeof(p_patch->'entityType') is distinct from 'string' or p_patch->>'entityType' not in ('person','company')) then
   raise exception 'contact_entity_type_invalid' using errcode='22023';
  end if;
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
   if p_collection='contacts' then perform app_private.validate_contact_identity(newrow,oldrow); end if;
   if p_collection in ('properties','vehicles','boats','houseTrackingHouses') and length(btrim(newrow->>'name'))=0 then raise exception 'name_required'; end if;
   if p_collection in ('tasks','quotes','vendorQuotes','vendorInvoices','planningEntries') and length(btrim(coalesce(newrow->>'title','')))=0 then raise exception 'title_required'; end if;
   if p_collection in ('houseTimeEntries','housePayments') and (coalesce(newrow->>'houseId','')='' or coalesce(newrow->>'workerId','')='' or coalesce(newrow->>'date','')='') then raise exception 'house_worker_date_required'; end if;
   if p_module='bookings'  then raise exception 'existing_quote_required'; end if;
   if p_collection='vendorQuotes' then newrow:='{"status":"À valider","contactId":"","contactName":""}'::jsonb||newrow; end if;
   if p_collection='vendorInvoices' then newrow:='{"status":"À payer","paidAmount":0,"contactId":"","contactName":""}'::jsonb||newrow; end if;
  end if;
 end if;
 select coalesce(jsonb_agg(case when r->>'id'=p_id then newrow else r end),'[]') into rows from jsonb_array_elements(coalesce(w.payload->p_collection,'[]')) r where not(p_delete and r->>'id'=p_id);
 if oldrow is null and not p_delete then rows:=rows||jsonb_build_array(newrow); end if;
 -- This private transaction marker only follows the existing permission,
 -- revision, deletion and reference guards. It is not an authorization bypass.
 if p_collection='contacts' and p_delete then
  perform set_config('crm.contact_entity_delete_id',p_id,true);
 end if;
 update public.crm_workspace_state set payload=jsonb_set(w.payload,array[p_collection],rows),updated_by=auth.uid() where workspace_id=w.workspace_id;
 if p_collection='contacts' and p_delete then
  perform set_config('crm.contact_entity_delete_id','',true);
 end if;
 return public.crm_read_module(p_module);
end $function$;

CREATE OR REPLACE FUNCTION public.crm_reference_options(p_module text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare data jsonb; result jsonb:='{}'; c record;
begin
 data:=public.crm_read_module(p_module)->'collections';
 for c in select * from jsonb_each(data) loop
 if jsonb_typeof(c.value)='array' then
 result:=result||jsonb_build_object(c.key,coalesce((select jsonb_agg((select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(r) where key=any(array['id','clientName','supplierCost','paymentStatus','expectedDeposit','name','firstName','companyName','entityType','kind','organizationFunction','supplierCategory','supplierContactName','supplierStatus','title','contactName','category','assetType','assetId','rentalStartDate','rentalEndDate','status','city','port','brand','model','price','startDate','endDate','startTime','endTime','blocksAvailability','dueDate','nextAction','value','owner','amount','paidAmount','invoiceDate','invoiceReference','sourceQuoteId','sourceQuoteReference','linkedInvoiceId','quoteReference','contactId','contactPersonName','unitPrice','items','categories','depositReceived','balanceReceived','paymentDueDate','bookingStatus','startDate','endDate','createdAt','updatedAt','hourlyRate','breakMinutes','date','houseId','workerId']))) from jsonb_array_elements(c.value) r),'[]'));
 end if;
 end loop;
 return result;
end $function$;

-- Old global-save clients may omit entityType or filter out blank-name
-- companies. Preserve omitted identity values for the same ID; reject silent
-- company removal. Explicit scoped deletion remains protected by its old RPC.
create function app_private.guard_contact_entity_identity() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare r jsonb; prior jsonb; rows jsonb:='[]'; k text;
begin
 if new.workspace_id<>'oneaddress-riviera'
  or (tg_op='UPDATE' and old.payload->'contacts' is not distinct from new.payload->'contacts') then return new; end if;
 if tg_op='UPDATE' and exists(select 1 from jsonb_array_elements(coalesce(old.payload->'contacts','[]')) saved
  where saved->>'entityType'='company'
  and saved->>'id' is distinct from current_setting('crm.contact_entity_delete_id',true)
  and not exists(select 1 from jsonb_array_elements(coalesce(new.payload->'contacts','[]')) incoming where incoming->>'id'=saved->>'id')) then
  raise exception 'contact_company_legacy_client_unsafe' using errcode='40001';
 end if;
 for r in select value from jsonb_array_elements(coalesce(new.payload->'contacts','[]')) loop
  prior:=null;
  if tg_op='UPDATE' then select value into prior from jsonb_array_elements(coalesce(old.payload->'contacts','[]')) where value->>'id'=r->>'id'; end if;
  if prior is not null then
   foreach k in array array['entityType','name','firstName','companyName','civility'] loop
    if prior?k and not r?k then r:=r||jsonb_build_object(k,prior->k); end if;
   end loop;
  end if;
  perform app_private.validate_contact_identity(r,prior);
  rows:=rows||jsonb_build_array(r);
 end loop;
 new.payload:=jsonb_set(new.payload,'{contacts}',rows);
 return new;
end $$;
revoke all on function app_private.guard_contact_entity_identity() from public,anon,authenticated;
create trigger crm_guard_contact_entity_identity before insert or update of payload on public.crm_workspace_state
 for each row execute function app_private.guard_contact_entity_identity();

notify pgrst,'reload schema';
commit;
