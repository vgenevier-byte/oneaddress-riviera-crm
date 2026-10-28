-- Project-only ownership/sale context; no data backfill and no new public grants.
create function app_private.fonciere_owner_schema() returns jsonb
language sql immutable set search_path=pg_catalog as $schema$ select '{"type":"object","properties":{"schema":{"type":"number","enum":[1]},"unlinkedOwners":{"type":"string","maxLength":2000},"organization":{"type":"string","enum":["unspecified","sole","indivision","other","confirm"]},"rights":{"type":"string","enum":["unspecified","full","split","other","confirm"]},"declaredCount":{"type":["number","null"],"integer":true,"minimum":0,"maximum":10000},"owners":{"type":"array","items":{"type":"object","properties":{"contactId":{"type":"string","maxLength":180,"minLength":1},"entityType":{"type":"string","enum":["person","company"]},"note":{"type":"string","maxLength":2000},"person":{"type":"object","properties":{"age":{"type":["number","null"],"integer":true,"minimum":0,"maximum":130},"ageApproximate":{"type":"boolean"},"ageAsOf":{"type":"string","maxLength":10,"format":"date"},"residenceCountry":{"type":"string","maxLength":2,"pattern":"^$|^[A-Z]{2}$"},"nationalities":{"type":"array","items":{"type":"string","maxLength":2,"pattern":"^[A-Z]{2}$"},"maxItems":12,"uniqueItems":true},"note":{"type":"string","maxLength":2000},"information":{"type":"object","properties":{"source":{"type":"string","enum":["unspecified","owner","contact","document","other"]},"contactId":{"type":"string","maxLength":180},"documentId":{"type":"string","maxLength":180},"detail":{"type":"string","maxLength":2000},"date":{"type":"string","maxLength":10,"format":"date"},"confirmation":{"type":"string","enum":["confirm","confirmed"]}},"required":["source","contactId","documentId","detail","date","confirmation"]}},"required":["age","ageApproximate","ageAsOf","residenceCountry","nationalities","note","information"]}},"required":["contactId","entityType","note"]},"maxItems":100},"representatives":{"type":"array","items":{"type":"object","properties":{"contactId":{"type":"string","maxLength":180,"minLength":1},"ownerContactId":{"type":"string","maxLength":180},"role":{"type":"string","maxLength":300}},"required":["contactId","ownerContactId","role"]},"maxItems":100},"primaryContactId":{"type":"string","maxLength":180},"primaryRole":{"type":"string","maxLength":300},"sale":{"type":"object","properties":{"agreement":{"type":"string","enum":["unspecified","all_agree","disagreement","confirm"]},"reasons":{"type":"array","items":{"type":"string","enum":["inheritance","separation","relocation","asset_reallocation","investment_sale","other","undisclosed"]},"maxItems":7,"uniqueItems":true},"listedOn":{"type":"string","maxLength":10,"format":"date"},"sellerDeadline":{"type":"string","maxLength":10,"format":"date"},"priceReductions":{"type":"string","maxLength":2000},"pricePosition":{"type":"string","enum":["not_discussed","firm","discussion","offer_expected","confirm"]},"openQuestions":{"type":"string","maxLength":2000},"information":{"type":"object","properties":{"source":{"type":"string","enum":["unspecified","owner","contact","document","other"]},"contactId":{"type":"string","maxLength":180},"documentId":{"type":"string","maxLength":180},"detail":{"type":"string","maxLength":2000},"date":{"type":"string","maxLength":10,"format":"date"},"confirmation":{"type":"string","enum":["confirm","confirmed"]}},"required":["source","contactId","documentId","detail","date","confirmation"]}},"required":["agreement","reasons","listedOn","sellerDeadline","priceReductions","pricePosition","openQuestions","information"]},"negotiation":{"type":"object","properties":{"potential":{"type":"string","enum":["unevaluated","low","moderate","high"]},"justification":{"type":"string","maxLength":2000},"favorablePoints":{"type":"string","maxLength":2000},"blockingPoints":{"type":"string","maxLength":2000},"nextQuestion":{"type":"string","maxLength":2000},"updatedBy":{"type":"string","maxLength":180},"updatedAt":{"type":"string","maxLength":60,"format":"date-time"}},"required":["potential","justification","favorablePoints","blockingPoints","nextQuestion","updatedBy","updatedAt"]},"provenance":{"type":"array","items":{"type":"object","properties":{"field":{"type":"string","maxLength":120,"minLength":1},"filename":{"type":"string","maxLength":240},"page":{"type":["number","null"],"integer":true,"minimum":0,"maximum":10000},"extract":{"type":"string","maxLength":2000},"importedAt":{"type":"string","maxLength":60,"format":"date-time","minLength":1}},"required":["field","filename","page","extract","importedAt"]},"maxItems":100}},"required":["schema","unlinkedOwners","organization","rights","declaredCount","owners","representatives","primaryContactId","primaryRole","sale","negotiation","provenance"]}'::jsonb; $schema$;

-- Small strict schema validator, private and used only with the constant above.
create function app_private.validate_fonciere_owner_shape(v jsonb,s jsonb) returns void
language plpgsql immutable set search_path=pg_catalog as $$
declare k text; item jsonb; types jsonb; val text;
begin
 types:=case when jsonb_typeof(s->'type')='array' then s->'type' else jsonb_build_array(s->'type') end;
 if v is null or not(types @> jsonb_build_array(jsonb_typeof(v))) then raise exception 'invalid_fonciere_owner_type' using errcode='22023'; end if;
 if s ? 'enum' and not(s->'enum' @> jsonb_build_array(v)) then raise exception 'invalid_fonciere_owner_enum' using errcode='22023'; end if;
 if jsonb_typeof(v)='null' then return; end if;
 if jsonb_typeof(v)='object' then
  for k in select jsonb_object_keys(v) loop
   if not(s->'properties' ? k) then raise exception 'unknown_fonciere_owner_field' using errcode='22023'; end if;
   perform app_private.validate_fonciere_owner_shape(v->k,s->'properties'->k);
  end loop;
  for item in select value from jsonb_array_elements(s->'required') loop
   if not(v ? (item#>>'{}')) then raise exception 'missing_fonciere_owner_field' using errcode='22023'; end if;
  end loop;
 elsif jsonb_typeof(v)='array' then
  if jsonb_array_length(v)>(s->>'maxItems')::integer then raise exception 'invalid_fonciere_owner_array' using errcode='22023'; end if;
  if s->>'uniqueItems'='true' and (select count(*)<>count(distinct value) from jsonb_array_elements(v)) then raise exception 'duplicate_fonciere_owner_value' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(v) loop perform app_private.validate_fonciere_owner_shape(item,s->'items'); end loop;
 elsif jsonb_typeof(v)='number' then
  if s->>'integer'='true' and (v#>>'{}')::numeric<>trunc((v#>>'{}')::numeric) or (s ? 'minimum' and (v#>>'{}')::numeric<(s->>'minimum')::numeric) or (s ? 'maximum' and (v#>>'{}')::numeric>(s->>'maximum')::numeric) then raise exception 'invalid_fonciere_owner_number' using errcode='22023'; end if;
 elsif jsonb_typeof(v)='string' then
  val:=v#>>'{}';
  if length(val)>coalesce((s->>'maxLength')::integer,2000) or length(val)<coalesce((s->>'minLength')::integer,0) or (s ? 'pattern' and val !~ (s->>'pattern')) then raise exception 'invalid_fonciere_owner_text' using errcode='22023'; end if;
  if val<>'' and s->>'format'='date' then
   if val !~ '^\d{4}-\d{2}-\d{2}$' or val='0000-00-00' or to_char(val::date,'YYYY-MM-DD')<>val then raise exception 'invalid_fonciere_owner_date' using errcode='22023'; end if;
  elsif val<>'' and s->>'format'='date-time' then
   if val !~ '^\d{4}-\d{2}-\d{2}T' or not isfinite(val::timestamptz) then raise exception 'invalid_fonciere_owner_timestamp' using errcode='22023'; end if;
  end if;
 end if;
end $$;

alter function app_private.validate_fonciere_payload(uuid,jsonb) rename to validate_fonciere_payload_before_owners;
create function app_private.validate_fonciere_payload(p_id uuid,p_payload jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare c jsonb:=p_payload#>'{data,ownerContext}';
begin
 perform app_private.validate_fonciere_payload_before_owners(p_id,jsonb_set(p_payload,'{data}',(p_payload->'data')-'ownerContext'));
 if c is null then return; end if;
 if octet_length(c::text)>200000 then raise exception 'invalid_fonciere_owner_size' using errcode='22023'; end if;
 perform app_private.validate_fonciere_owner_shape(c,app_private.fonciere_owner_schema());
 if exists(select 1 from jsonb_array_elements(c->'owners') o where o->>'entityType'='company' and o ? 'person')
 or (select count(*)<>count(distinct o->>'contactId') from jsonb_array_elements(c->'owners') o)
 or (select count(*)<>count(distinct o->>'contactId') from jsonb_array_elements(c->'representatives') o)
 or exists(select 1 from jsonb_array_elements(c->'provenance') o where o->'page'='0'::jsonb)
 then raise exception 'invalid_fonciere_owner_identity' using errcode='22023'; end if;
end $$;

-- Existing project RPCs still enforce their current locks, assignments and ACL.
-- The trigger adds association admission and server-owned negotiation attribution.
create function app_private.prepare_fonciere_owner_context() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare c jsonb:=new.payload#>'{data,ownerContext}'; previous jsonb; old_links jsonb; new_links jsonb; item jsonb; link text; expected text; crm jsonb; information jsonb;
begin
 if tg_op='UPDATE' then previous:=old.payload#>'{data,ownerContext}'; end if;
 -- Old clients cannot erase data they do not understand by omitting the block.
 if c is null then
  if previous is not null then new.payload:=jsonb_set(new.payload,'{data,ownerContext}',previous); end if;
  return new;
 end if;
 perform app_private.validate_fonciere_owner_shape(c,app_private.fonciere_owner_schema());
 new_links:=jsonb_build_object('primaryContactId',coalesce(c->'primaryContactId','""'),'owners',coalesce((select jsonb_agg(jsonb_build_object('contactId',o->'contactId','entityType',o->'entityType') order by o->>'contactId') from jsonb_array_elements(c->'owners') o),'[]'),'representatives',coalesce((select jsonb_agg(jsonb_build_object('contactId',o->'contactId','ownerContactId',o->'ownerContactId') order by o->>'contactId') from jsonb_array_elements(c->'representatives') o),'[]'));
 old_links:=jsonb_build_object('primaryContactId',coalesce(previous->'primaryContactId','""'),'owners',coalesce((select jsonb_agg(jsonb_build_object('contactId',o->'contactId','entityType',o->'entityType') order by o->>'contactId') from jsonb_array_elements(coalesce(previous->'owners','[]')) o),'[]'),'representatives',coalesce((select jsonb_agg(jsonb_build_object('contactId',o->'contactId','ownerContactId',o->'ownerContactId') order by o->>'contactId') from jsonb_array_elements(coalesce(previous->'representatives','[]')) o),'[]'));
 if new_links is distinct from old_links then
  if auth.uid() is null or not app_private.module_allowed('contacts') then raise exception 'fonciere_owner_contact_forbidden' using errcode='42501'; end if;
  select w.payload->'contacts' into crm from public.crm_workspace_state w where workspace_id='oneaddress-riviera' for share;
  for item in select value from jsonb_array_elements(c->'owners') union all select jsonb_build_object('contactId',o->'contactId','entityType','person') from jsonb_array_elements(c->'representatives') o loop
   link:=item->>'contactId';expected:=item->>'entityType';
   if not exists(select 1 from jsonb_array_elements(coalesce(crm,'[]')) contact where contact->>'id'=link and (case when contact->>'entityType'='company' then 'company' else 'person' end)=expected)
   then raise exception 'fonciere_owner_contact_missing' using errcode='42501'; end if;
  end loop;
 end if;
 -- A newly selected represented-owner identity must be an explicit owner link.
 -- If an owner was removed, its unchanged reference remains available for review.
 for item in select value from jsonb_array_elements(c->'representatives') loop
  link:=item->>'ownerContactId';
  if coalesce(link,'')<>'' and not exists(select 1 from jsonb_array_elements(coalesce(previous->'representatives','[]')) r where r->>'contactId'=item->>'contactId' and r->>'ownerContactId'=link)
   and not exists(select 1 from jsonb_array_elements(c->'owners') o where o->>'contactId'=link)
  then raise exception 'fonciere_owner_represented_owner_unlinked' using errcode='22023'; end if;
 end loop;
 -- Context metadata may cite an authorized CRM contact or one of this project's documents.
 for information in select c#>'{sale,information}' union all select o#>'{person,information}' from jsonb_array_elements(c->'owners') o where o ? 'person' loop
  link:=information->>'contactId';
  if coalesce(link,'')<>'' and not exists(select 1 from (select previous#>'{sale,information}' i union all select o#>'{person,information}' from jsonb_array_elements(coalesce(previous->'owners','[]')) o) old_info where old_info.i->>'contactId'=link) then
   if not app_private.module_allowed('contacts') or not exists(select 1 from public.crm_workspace_state w cross join lateral jsonb_array_elements(w.payload->'contacts') contact where w.workspace_id='oneaddress-riviera' and contact->>'id'=link) then raise exception 'fonciere_owner_source_contact_forbidden' using errcode='42501'; end if;
  end if;
  link:=information->>'documentId';
  if coalesce(link,'')<>'' and not exists(select 1 from public.fonciere_assets a where a.id::text=link and a.project_id=new.id and a.lifecycle='finalized' and app_private.can_fonciere_asset(a.object_path)) then raise exception 'fonciere_owner_source_document_forbidden' using errcode='42501'; end if;
 end loop;
 if ((c->'negotiation')-'updatedBy'-'updatedAt') is distinct from ((previous->'negotiation')-'updatedBy'-'updatedAt') and
  (previous is not null or c#>>'{negotiation,potential}'<>'unevaluated' or exists(select 1 from jsonb_each_text((c->'negotiation')-'updatedBy'-'updatedAt'-'potential') x where x.value<>'')) then
  c:=jsonb_set(c,'{negotiation,updatedBy}',to_jsonb(coalesce(auth.uid()::text,'')));
  c:=jsonb_set(c,'{negotiation,updatedAt}',to_jsonb(to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
 else
  c:=jsonb_set(c,'{negotiation,updatedBy}',coalesce(previous#>'{negotiation,updatedBy}','""'));
  c:=jsonb_set(c,'{negotiation,updatedAt}',coalesce(previous#>'{negotiation,updatedAt}','""'));
 end if;
 new.payload:=jsonb_set(new.payload,'{data,ownerContext}',c);return new;
end $$;
create trigger fonciere_owner_context before insert or update of payload on public.fonciere_projects for each row execute function app_private.prepare_fonciere_owner_context();

-- Deferred until the existing save RPC has also written its agency/agent links.
create function app_private.validate_fonciere_owner_primary() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare c jsonb:=new.payload#>'{data,ownerContext}'; previous jsonb;
begin
 if tg_op='UPDATE' then previous:=old.payload#>'{data,ownerContext}'; end if;
 if coalesce(c->>'primaryContactId','')<>'' and c->>'primaryContactId' is distinct from previous->>'primaryContactId'
  and not exists(select 1 from jsonb_array_elements(c->'owners') o where o->>'contactId'=c->>'primaryContactId' and o->>'entityType'='person')
  and not exists(select 1 from jsonb_array_elements(c->'representatives') o where o->>'contactId'=c->>'primaryContactId')
  and not exists(select 1 from public.fonciere_project_contacts x join public.crm_workspace_state w on w.workspace_id='oneaddress-riviera' cross join lateral jsonb_array_elements(coalesce(w.payload->'contacts','[]')) contact where x.project_id=new.id and x.contact_id=c->>'primaryContactId' and contact->>'id'=x.contact_id and coalesce(contact->>'entityType','person')<>'company')
 then raise exception 'fonciere_owner_primary_contact_unlinked' using errcode='22023'; end if;
 return new;
end $$;
create constraint trigger fonciere_owner_primary after insert or update on public.fonciere_projects deferrable initially deferred for each row execute function app_private.validate_fonciere_owner_primary();

-- A linked CRM owner/representative identity cannot silently disappear.
create function app_private.guard_fonciere_owner_identity() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if new.workspace_id='oneaddress-riviera' and exists(select 1 from public.fonciere_projects p cross join lateral (
  select o->>'contactId' id,o->>'entityType' expected from jsonb_array_elements(coalesce(p.payload#>'{data,ownerContext,owners}','[]')) o
  union select o->>'contactId','person' from jsonb_array_elements(coalesce(p.payload#>'{data,ownerContext,representatives}','[]')) o
 ) link where not exists(select 1 from jsonb_array_elements(coalesce(new.payload->'contacts','[]')) contact where contact->>'id'=link.id and (case when contact->>'entityType'='company' then 'company' else 'person' end)=link.expected)) then raise exception 'fonciere_owner_identity_in_use' using errcode='23503'; end if;
 return new;
end $$;
create trigger fonciere_owner_identity before update on public.crm_workspace_state for each row execute function app_private.guard_fonciere_owner_identity();

-- Defense at the persistence boundary: presentations cannot retain a hidden
-- copy of the project-only ownerContext in metadata or any nested JSON object.
create function app_private.contains_fonciere_owner_context(v jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare item jsonb;
begin
 if jsonb_typeof(v)='object' then
  if v ? 'ownerContext' then return true; end if;
  for item in select value from jsonb_each(v) loop if app_private.contains_fonciere_owner_context(item) then return true; end if; end loop;
 elsif jsonb_typeof(v)='array' then
  for item in select value from jsonb_array_elements(v) loop if app_private.contains_fonciere_owner_context(item) then return true; end if; end loop;
 end if;
 return false;
end $$;
create function app_private.guard_presentation_owner_context() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if app_private.contains_fonciere_owner_context(new.payload) then raise exception 'presentation_owner_context_forbidden' using errcode='22023'; end if;
 return new;
end $$;
create trigger presentation_owner_context before insert or update of payload on public.izord_projects for each row execute function app_private.guard_presentation_owner_context();

revoke all on function app_private.fonciere_owner_schema(),app_private.validate_fonciere_owner_shape(jsonb,jsonb),app_private.validate_fonciere_payload_before_owners(uuid,jsonb),app_private.validate_fonciere_payload(uuid,jsonb),app_private.prepare_fonciere_owner_context(),app_private.guard_fonciere_owner_identity(),app_private.validate_fonciere_owner_primary(),app_private.contains_fonciere_owner_context(jsonb),app_private.guard_presentation_owner_context() from public,anon,authenticated;
