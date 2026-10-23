-- Additive structured metadata; historical address text, roles and snapshots are untouched.
begin;
select pg_advisory_xact_lock(734991);

update app_private.module_collections set fields=fields||'{"postalAddressDetails":{"type":"object","label":"Détails de l’adresse postale"}}'::jsonb where collection='contacts';
update app_private.module_collections set fields=fields||'{"addressDetails":{"type":"object","label":"Détails de l’adresse"}}'::jsonb where collection='houseTrackingHouses';

create function app_private.address_fingerprint(p_text text) returns text
language sql immutable set search_path=pg_catalog as $$
 select lower(btrim(regexp_replace(normalize(coalesce(p_text,''),NFC),'[[:space:]]+',' ','g')));
$$;
revoke all on function app_private.address_fingerprint(text) from public,anon,authenticated;

-- No arbitrary nested fields, provider payload, URLs or business data may enter this object.
create function app_private.validate_address_details(p_value jsonb) returns void
language plpgsql immutable set search_path=pg_catalog as $$
declare k text; v jsonb; required text[]:=array['houseNumber','street','line1','complement','postalCode','city','country','countryCode','formattedAddress','source','precision','fingerprint'];
begin
 if jsonb_typeof(p_value) is distinct from 'object' or octet_length(p_value::text)>16000 then raise exception 'invalid_address_details' using errcode='22023'; end if;
 if p_value='{}'::jsonb then return; end if;
 if not(p_value ?& required) or p_value-(required||array['latitude','longitude','sourceId'])<>'{}'::jsonb then raise exception 'invalid_address_details_fields' using errcode='22023'; end if;
 for k,v in select key,value from jsonb_each(p_value) loop
  if k in ('latitude','longitude') then
   if jsonb_typeof(v) is distinct from 'number' then raise exception 'invalid_address_coordinates' using errcode='22023'; end if;
   if abs((v#>>'{}')::numeric)>(case when k='latitude' then 90 else 180 end) then raise exception 'invalid_address_coordinates' using errcode='22023'; end if;
  elsif jsonb_typeof(v) is distinct from 'string' or length(v#>>'{}')>4000 then raise exception 'invalid_address_details_text' using errcode='22023'; end if;
 end loop;
 if (p_value ? 'latitude')<>(p_value ? 'longitude') then raise exception 'invalid_address_coordinates' using errcode='22023'; end if;
 if btrim(p_value->>'formattedAddress')='' or p_value->>'source' not in ('ign','manual') or p_value->>'precision' not in ('address','street','city','manual') or (p_value->>'countryCode'<>'' and p_value->>'countryCode' !~ '^[A-Z]{2}$') then raise exception 'invalid_address_details_value' using errcode='22023'; end if;
 if p_value->>'source'='manual' and ((p_value ? 'latitude') or (p_value ? 'longitude') or (p_value ? 'sourceId') or p_value->>'precision'<>'manual') then raise exception 'invalid_manual_address_reference' using errcode='22023'; end if;
end $$;
revoke all on function app_private.validate_address_details(jsonb) from public,anon,authenticated;

-- Handles legacy clients as well as current forms. A changed address/city loses
-- the previous structured base, geocode and provider identity; complement survives.
create function app_private.coherent_address_details(p_value jsonb,p_text text,p_city text default null) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
declare fingerprint text:=app_private.address_fingerprint(p_text);
begin
 perform app_private.validate_address_details(p_value);
 if p_value='{}'::jsonb or fingerprint='' then return '{}'::jsonb; end if;
 if app_private.address_fingerprint(p_value->>'formattedAddress') is distinct from fingerprint
  or p_value->>'fingerprint' is distinct from fingerprint
  or (p_city is not null and coalesce(p_value->>'city','')<>'' and app_private.address_fingerprint(p_value->>'city') is distinct from app_private.address_fingerprint(p_city)) then
  return jsonb_build_object('houseNumber','','street','','line1','','complement',p_value->>'complement','postalCode','','city','','country','','countryCode','','formattedAddress',p_text,'source','manual','precision','manual','fingerprint',fingerprint);
 end if;
 return p_value;
end $$;
revoke all on function app_private.coherent_address_details(jsonb,text,text) from public,anon,authenticated;

create function app_private.reconcile_address_record(p_row jsonb,p_prior jsonb,p_text text,p_key text,p_city text default null) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
declare details jsonb;
begin
 if not(p_row ? p_key) and not(coalesce(p_prior,'{}'::jsonb) ? p_key) then return p_row; end if;
 details:=app_private.coherent_address_details(coalesce(p_row->p_key,p_prior->p_key),coalesce(p_text,''),p_city);
 if details='{}'::jsonb then return p_row-p_key; end if;
 return jsonb_set(p_row,array[p_key],details);
end $$;
revoke all on function app_private.reconcile_address_record(jsonb,jsonb,text,text,text) from public,anon,authenticated;

-- Trigger needs its owner's private helper execution rights; it cannot authorize
-- a write and never changes any record identity, permission or unrelated field.
create function app_private.guard_address_metadata() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare collection text; key text; row jsonb; prior jsonb; next_rows jsonb; old_payload jsonb:='{}'::jsonb;
begin
 if new.workspace_id<>'oneaddress-riviera' then return new; end if;
 if tg_op='UPDATE' then old_payload:=old.payload; end if;
 foreach collection in array array['contacts','houseTrackingHouses'] loop
  if new.payload->collection is not distinct from old_payload->collection then continue; end if;
  if jsonb_typeof(new.payload->collection) is distinct from 'array' then continue; end if;
  key:=case collection when 'contacts' then 'postalAddressDetails' else 'addressDetails' end;
  next_rows:='[]'::jsonb;
  for row in select value from jsonb_array_elements(new.payload->collection) loop
   select value into prior from jsonb_array_elements(coalesce(old_payload->collection,'[]'::jsonb)) where value->>'id'=row->>'id';
   row:=app_private.reconcile_address_record(row,prior,row->>(case collection when 'contacts' then 'postalAddress' else 'address' end),key,case when collection='contacts' then row->>'city' else null end);
   next_rows:=next_rows||jsonb_build_array(row);
  end loop;
  new.payload:=jsonb_set(new.payload,array[collection],next_rows);
 end loop;
 return new;
end $$;
revoke all on function app_private.guard_address_metadata() from public,anon,authenticated;
create trigger crm_guard_address_metadata before insert or update of payload on public.crm_workspace_state for each row execute function app_private.guard_address_metadata();

create or replace function app_private.project_record(p_collection text,p_row jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare v jsonb; allowed jsonb;
begin
 select fields into allowed from app_private.module_collections where collection=p_collection;
 select coalesce(jsonb_object_agg(key,value),'{}') into v from jsonb_each(p_row)
 where (allowed ? key or key=any(array['id','createdAt','updatedAt','createdBy','updatedBy'])) and (not coalesce(allowed->key ? 'requires',false) or app_private.module_allowed(allowed->key->>'requires')) and jsonb_typeof(value) in ('string','number','boolean','null');
 if p_collection='quotes' then v:=v||jsonb_build_object('categories',coalesce(p_row->'categories','[]'),'items',coalesce((select jsonb_agg((select jsonb_object_agg(k,x) from jsonb_each(item) e(k,x) where k=any(array['id','category','description','unitPrice','billingUnit','deposit']) and jsonb_typeof(x) in ('string','number'))) from jsonb_array_elements(coalesce(p_row->'items','[]')) item),'[]')); end if;
 if p_collection in ('vendorQuotes','vendorInvoices') then v:=v||jsonb_build_object('linkedInvoiceId',p_row->'linkedInvoiceId','sourceQuoteId',p_row->'sourceQuoteId','sourceQuoteReference',p_row->'sourceQuoteReference'); end if;
 -- Linked records are opt-in through their own module. Never return hidden names, financial histories or embedded URLs.
 if p_collection in ('vendorQuotes','vendorInvoices') then
  v:=v || jsonb_build_object('status',p_row->'status');
  if app_private.module_allowed('contacts') then v:=v || jsonb_build_object('contactId',p_row->'contactId','contactName',p_row->'contactName'); end if;
  if p_collection='vendorInvoices' then v:=v||jsonb_build_object('paidAmount',p_row->'paidAmount'); if app_private.module_allowed('vendorInvoices',true,'payment') and app_private.module_allowed('contacts',false,'bank_read') then v:=v||jsonb_build_object('paymentBankAccountId',p_row->'paymentBankAccountId'); end if; end if;
 end if;
 if p_collection='contacts' and app_private.module_allowed('contacts',false,'bank_read') then v:=v||jsonb_build_object('supplierBankAccounts',coalesce((select jsonb_agg((select jsonb_object_agg(key,value) from jsonb_each(a) where key=any(array['id','accountHolder','iban','bic','bankName','label','status','isPrimary','verifiedAt','verifiedBy','createdAt']))) from jsonb_array_elements(coalesce(p_row->'supplierBankAccounts','[]')) a),'[]')); end if;
 if p_collection='quotes' and not app_private.module_allowed('contacts') then v:=v-'clientName'; end if;
 for allowed in select jsonb_build_object('key',key,'path',value) from jsonb_each(p_row) where key like '%StoragePath' loop
  if not app_private.document_allowed('storage',allowed->>'path') then v:=v-(allowed->>'key'); end if;
 end loop;
 -- Only the metadata field of the already authorized parent module is projected.
 if p_collection='contacts' and app_private.module_allowed('contacts') and p_row ? 'postalAddressDetails' then
  v:=v||jsonb_build_object('postalAddressDetails',app_private.coherent_address_details(p_row->'postalAddressDetails',p_row->>'postalAddress',p_row->>'city'));
 elsif p_collection='houseTrackingHouses' and app_private.module_allowed('houseTracking') and p_row ? 'addressDetails' then
  v:=v||jsonb_build_object('addressDetails',app_private.coherent_address_details(p_row->'addressDetails',p_row->>'address'));
 end if;
 return v;
end $$;

-- Existing module authorization and curated field projection remain in place.
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
 result:=result||jsonb_build_object(c.key,coalesce((select jsonb_agg((select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(r) where key=any(array['id','clientName','supplierCost','paymentStatus','expectedDeposit','name','firstName','companyName','entityType','kind','organizationFunction','supplierCategory','supplierContactName','supplierStatus','title','contactName','category','assetType','assetId','rentalStartDate','rentalEndDate','status','city','postalAddress','postalAddressDetails','address','addressDetails','port','brand','model','price','startDate','endDate','startTime','endTime','blocksAvailability','dueDate','nextAction','value','owner','amount','paidAmount','invoiceDate','invoiceReference','sourceQuoteId','sourceQuoteReference','linkedInvoiceId','quoteReference','contactId','contactPersonName','unitPrice','items','categories','depositReceived','balanceReceived','paymentDueDate','bookingStatus','startDate','endDate','createdAt','updatedAt','hourlyRate','breakMinutes','date','houseId','workerId']))) from jsonb_array_elements(c.value) r),'[]'));
 end if;
 end loop;
 return result;
end $function$;

create or replace function app_private.validate_fonciere_payload(p_id uuid,p_payload jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare d jsonb:=p_payload->'data'; g jsonb:=d->'guided'; catalog jsonb:=app_private.fonciere_guided_catalog();
 k text; v jsonb; def jsonb; sk text; sv jsonb; row jsonb; source text; role text; baseline jsonb; seen text[]; allowed text[];
begin
 if octet_length(p_payload::text)>1048576 then raise exception 'invalid_fonciere_payload' using errcode='22023'; end if;
 -- Keep all established auth/project/storage checks in the original validator.
 perform app_private.validate_fonciere_payload_legacy_v1(p_id,jsonb_set(p_payload,'{data}',d-'guided'-'contactSources'-'propertyAddressDetails'-'agencyAddressDetails'));
 foreach k in array array['propertyAddressDetails','agencyAddressDetails'] loop
  if d ? k then perform app_private.validate_address_details(d->k); end if;
 end loop;
 if d->'presentationData' ? 'addressDetails' then perform app_private.validate_address_details(d->'presentationData'->'addressDetails'); end if;
 if d ? 'contactSources' then
  if jsonb_typeof(d->'contactSources') is distinct from 'object' then raise exception 'invalid_fonciere_contact_sources' using errcode='22023'; end if;
  for role,v in select key,value from jsonb_each(d->'contactSources') loop
   if role not in ('agent','agency') or jsonb_typeof(v) is distinct from 'object' or v-'baseline'<>'{}'::jsonb or jsonb_typeof(v->'baseline') is distinct from 'object' then raise exception 'invalid_fonciere_contact_sources' using errcode='22023'; end if;
   allowed:=case when role='agent' then array['agentName','agentEmail','agentPhone','agencyName'] else array['agencyName','agencyAddress','agencyPhone','agencyEmail'] end;
   for sk,sv in select key,value from jsonb_each(v->'baseline') loop
    if not(sk=any(allowed)) or jsonb_typeof(sv) is distinct from 'string' or length(sv#>>'{}')>12000 then raise exception 'invalid_fonciere_contact_sources' using errcode='22023'; end if;
   end loop;
  end loop;
 end if;
 if g is null then return; end if;
 if jsonb_typeof(g) is distinct from 'object' or g->'version' is distinct from '1'::jsonb or jsonb_typeof(g->'values') is distinct from 'object' or g-'version'-'values'-'inactive'-'details'<>'{}'::jsonb then raise exception 'invalid_fonciere_guided' using errcode='22023'; end if;
 if g ? 'inactive' then
  if jsonb_typeof(g->'inactive') is distinct from 'array' then raise exception 'invalid_fonciere_guided_applicability' using errcode='22023'; end if;
  seen:=array[]::text[];
  for v in select value from jsonb_array_elements(g->'inactive') loop
   k:=v#>>'{}';
   if jsonb_typeof(v) is distinct from 'string' or not(catalog ? k) or k=any(seen) then raise exception 'invalid_fonciere_guided_applicability' using errcode='22023'; end if;
   seen:=array_append(seen,k);
  end loop;
 end if;
 if g ? 'details' then
  if jsonb_typeof(g->'details') is distinct from 'object' then raise exception 'invalid_fonciere_guided_details' using errcode='22023'; end if;
  for k,v in select key,value from jsonb_each(g->'details') loop
   if not(catalog ? k) or jsonb_typeof(v) is distinct from 'string' or length(v#>>'{}')>12000 then raise exception 'invalid_fonciere_guided_details' using errcode='22023'; end if;
  end loop;
 end if;
 for k,v in select key,value from jsonb_each(g->'values') loop
  def:=catalog->k;
  if def is null then raise exception 'unknown_fonciere_guided_field' using errcode='22023'; end if;
  if v='null'::jsonb then continue; end if;
  if def->>'kind'='composite' then
   if jsonb_typeof(v) is distinct from 'object' then raise exception 'invalid_fonciere_guided_composite' using errcode='22023'; end if;
   for sk,sv in select key,value from jsonb_each(v) loop
    if not(def->'subfields' ? sk) then raise exception 'unknown_fonciere_guided_subfield' using errcode='22023'; end if;
    perform app_private.validate_fonciere_guided_scalar(sv,def->'subfields'->sk);
   end loop;
  elsif def->>'kind' in ('checklist','diagnostics') then
   if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v)>50 then raise exception 'invalid_fonciere_guided_checks' using errcode='22023'; end if;
   seen:=array[]::text[];
   for row in select value from jsonb_array_elements(v) loop
    if jsonb_typeof(row) is distinct from 'object' or row-'code'-'status'-'detail'-'documentId'-'grade'<>'{}'::jsonb or jsonb_typeof(row->'code') is distinct from 'string' or not(def->'options' @> jsonb_build_array(row->'code')) or (row->>'code')=any(seen) then raise exception 'invalid_fonciere_guided_checks' using errcode='22023'; end if;
    seen:=array_append(seen,row->>'code');
    if jsonb_typeof(row->'status') is distinct from 'string' or (def->>'kind'='checklist' and row->>'status' not in ('to_verify','in_progress','verified')) or (def->>'kind'='diagnostics' and row->>'status' not in ('available','not_provided','in_progress','not_applicable')) then raise exception 'invalid_fonciere_guided_check_status' using errcode='22023'; end if;
    if row ? 'grade' and (row->>'code' not in ('dpe','ges') or row->>'status'<>'available' or jsonb_typeof(row->'grade') is distinct from 'string' or row->>'grade' !~ '^[A-G]$') then raise exception 'invalid_fonciere_guided_grade' using errcode='22023'; end if;
    if row ? 'detail' and (jsonb_typeof(row->'detail') is distinct from 'string' or length(row->>'detail')>12000) then raise exception 'invalid_fonciere_guided_check_detail' using errcode='22023'; end if;
    if row ? 'documentId' and (jsonb_typeof(row->'documentId') is distinct from 'string' or length(row->>'documentId')>180) then raise exception 'invalid_fonciere_guided_document' using errcode='22023'; end if;
   end loop;
  else perform app_private.validate_fonciere_guided_scalar(v,def); end if;
 end loop;
 -- A referenced evidence document must be a finalized asset of this exact property.
 for source in
  select x.value->>'documentId' from jsonb_each(g->'values') x where jsonb_typeof(x.value)='object' and x.value ? 'documentId'
  union all
  select evidence.value->>'documentId' from jsonb_each(g->'values') x cross join lateral jsonb_array_elements(case when jsonb_typeof(x.value)='array' then x.value else '[]'::jsonb end) evidence(value) where jsonb_typeof(evidence.value)='object' and evidence.value ? 'documentId'
 loop
  if coalesce(source,'')='' then continue; end if;
  if source !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists(select 1 from public.fonciere_assets a where a.id::text=source and a.project_id=p_id and a.lifecycle='finalized' and a.kind in ('pdf','attachment') and app_private.can_fonciere_asset(a.object_path)) then raise exception 'forbidden_fonciere_guided_document' using errcode='42501'; end if;
 end loop;
end $$;

-- Foncière stores the street/complement and locality in separate fields.
create function app_private.fonciere_address_text(p_data jsonb) returns text
language sql immutable set search_path=pg_catalog as $$
 select concat_ws(E'\n',nullif(btrim(p_data->>'propertyAddress'),''),nullif(btrim(concat_ws(' ',nullif(btrim(p_data->>'postalCode'),''),nullif(btrim(p_data->>'city'),''))),''),
  case when app_private.address_fingerprint(concat_ws(E'\n',nullif(btrim(p_data->'propertyAddressDetails'->>'line1'),''),nullif(btrim(p_data->'propertyAddressDetails'->>'complement'),'')))=app_private.address_fingerprint(p_data->>'propertyAddress')
   and coalesce(p_data->'propertyAddressDetails'->>'postalCode','')=coalesce(p_data->>'postalCode','') and coalesce(p_data->'propertyAddressDetails'->>'city','')=coalesce(p_data->>'city','')
  then nullif(btrim(p_data->'propertyAddressDetails'->>'country'),'') end);
$$;
revoke all on function app_private.fonciere_address_text(jsonb) from public,anon,authenticated;

-- Current editable projects only. Version rows and presentation-source snapshots
-- keep their original payload and author/revision semantics.
create function app_private.guard_project_address_metadata() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare d jsonb:=new.payload->'data'; prior jsonb:='{}'::jsonb; presentation jsonb; old_presentation jsonb; address_changed boolean;
begin
 if jsonb_typeof(d) is distinct from 'object' then return new; end if;
 if tg_op='UPDATE' then prior:=old.payload->'data'; end if;
 if tg_table_name='fonciere_projects' then
  address_changed:=tg_op='UPDATE' and (d->>'propertyAddress' is distinct from prior->>'propertyAddress' or d->>'postalCode' is distinct from prior->>'postalCode' or d->>'city' is distinct from prior->>'city');
  if not(d ? 'propertyAddressDetails') and prior ? 'propertyAddressDetails' then d:=jsonb_set(d,'{propertyAddressDetails}',prior->'propertyAddressDetails'); end if;
  d:=app_private.reconcile_address_record(d,prior,app_private.fonciere_address_text(d),'propertyAddressDetails',d->>'city');
  if address_changed and coalesce(d->'propertyAddressDetails'->>'source','manual')<>'ign' and d->'guided'->'values' ? 'coordinates' then d:=jsonb_set(d,'{guided,values,coordinates}','null'::jsonb); end if;
  d:=app_private.reconcile_address_record(d,prior,d->>'agencyAddress','agencyAddressDetails');
  presentation:=d->'presentationData'; old_presentation:=prior->'presentationData';
  if jsonb_typeof(presentation)='object' then
   presentation:=app_private.reconcile_address_record(presentation,old_presentation,presentation->'state'->>'address','addressDetails');
   d:=jsonb_set(d,'{presentationData}',presentation);
  end if;
 else
  d:=app_private.reconcile_address_record(d,prior,d->'state'->>'address','addressDetails');
 end if;
 if d is not null then new.payload:=jsonb_set(new.payload,'{data}',d); end if;
 return new;
end $$;
revoke all on function app_private.guard_project_address_metadata() from public,anon,authenticated;
create trigger fonciere_guard_address_metadata before insert or update of payload on public.fonciere_projects for each row execute function app_private.guard_project_address_metadata();
create trigger izord_guard_address_metadata before insert or update of payload on public.izord_projects for each row execute function app_private.guard_project_address_metadata();

notify pgrst, 'reload schema';
commit;
