-- Informational supplier quotes use dedicated, revision-checked actions.
-- No existing quote, invoice, payment, task, grant or document is reclassified.
begin;
select pg_advisory_xact_lock(734991);

-- Notes are optional business content. Status remains absent from generic fields.
update app_private.module_collections
set fields=fields||'{"notes":{"type":"string","label":"Notes"}}'::jsonb
where module='vendorQuotes' and collection='vendorQuotes';

create function app_private.create_vendor_quote(p_quote text,p_patch jsonb,p_status text,p_revision text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare w jsonb; q jsonb; base_patch jsonb:=p_patch; document_patch jsonb; document_path text; document_prefix text;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if auth.uid() is null or not app_private.module_allowed('vendorQuotes',true) then
  raise exception 'module_forbidden' using errcode='42501';
 end if;
 if p_status is null or p_status not in ('À valider','Pour information') then
  raise exception 'invalid_vendor_quote_status' using errcode='22023';
 end if;
 select payload into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
 if p_revision is distinct from app_private.module_revision('vendorQuotes',w) then
  raise exception 'revision_conflict' using errcode='40001';
 end if;
 if exists(select 1 from jsonb_array_elements(coalesce(w->'vendorQuotes','[]')) r where r->>'id'=p_quote) then
  raise exception 'quote_already_exists' using errcode='23505';
 end if;
 -- The complete-access form uploads its legacy object before saving the new
 -- record. Adopt only that actual object's exact quote directory; restricted
 -- forms continue to reserve/upload a scoped document after record creation.
 if jsonb_typeof(p_patch->'quoteDocumentStoragePath')='string' and p_patch->>'quoteDocumentStoragePath'<>'' then
  if not app_private.full_access() then raise exception 'document_reference_forbidden' using errcode='42501'; end if;
  document_path:=p_patch->>'quoteDocumentStoragePath';
  document_prefix:='oneaddress-riviera/vendor-quotes/'||p_quote||'/';
  if left(document_path,length(document_prefix)) is distinct from document_prefix
   or not exists(select 1 from storage.objects o where o.bucket_id='crm-documents' and o.name=document_path)
   or exists(select 1 from public.crm_document_scopes d where d.provider='storage' and d.resource_id=document_path
    and (d.module<>'vendorQuotes' or d.collection<>'vendorQuotes' or d.record_id<>p_quote or d.bank)) then
   raise exception 'document_reference_forbidden' using errcode='42501';
  end if;
  document_patch:=jsonb_build_object('quoteDocumentStoragePath',p_patch->'quoteDocumentStoragePath');
  if p_patch?'quoteDocumentName' then document_patch:=document_patch||jsonb_build_object('quoteDocumentName',p_patch->'quoteDocumentName'); end if;
  base_patch:=p_patch-array['quoteDocumentStoragePath','quoteDocumentName'];
 end if;
 -- Reuse the complete generic validator, including contact/document rights,
 -- field allowlist, values and revision checks. The patch cannot carry status.
 perform public.crm_mutate_record('vendorQuotes','vendorQuotes',p_quote,base_patch,p_revision,false);
 if document_patch is not null then
  -- Never reassign an existing scope. A document or field validation failure
  -- below rolls the base quote and this scope back in the same transaction.
  insert into public.crm_document_scopes(provider,resource_id,module,collection,record_id,title,bank)
   values('storage',document_path,'vendorQuotes','vendorQuotes',p_quote,
    left(coalesce(nullif(p_patch->>'quoteDocumentName',''),p_quote),200),false)
   on conflict(provider,resource_id) do nothing;
  select payload into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
  perform public.crm_mutate_record('vendorQuotes','vendorQuotes',p_quote,document_patch,app_private.module_revision('vendorQuotes',w),false);
 end if;
 if p_status='Pour information' then
  select payload into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
  select r into strict q from jsonb_array_elements(w->'vendorQuotes') r where r->>'id'=p_quote;
  -- Even an inconsistent preexisting reverse link cannot be adopted by a new
  -- informational record. The exception rolls back its creation atomically.
  if exists(select 1 from jsonb_array_elements(coalesce(w->'vendorInvoices','[]')) r where r->>'sourceQuoteId'=p_quote) then
   raise exception 'vendor_quote_has_linked_invoice' using errcode='23514';
  end if;
  q:=q||jsonb_build_object('status','Pour information');
  update public.crm_workspace_state set payload=jsonb_set(w,'{vendorQuotes}',
   (select jsonb_agg(case when r->>'id'=p_quote then q else r end) from jsonb_array_elements(w->'vendorQuotes') r)),
   updated_by=auth.uid() where workspace_id='oneaddress-riviera';
 end if;
 return public.crm_read_module('vendorQuotes');
end $$;

create function public.crm_create_vendor_quote(p_quote text,p_patch jsonb,p_status text,p_revision text) returns jsonb
language sql security invoker set search_path=pg_catalog as $$
 select app_private.create_vendor_quote(p_quote,p_patch,p_status,p_revision);
$$;

create function app_private.set_vendor_quote_information(p_quote text,p_status text,p_revision text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare w jsonb; q jsonb; invoice jsonb; linked text; reverse_count integer;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if auth.uid() is null or not app_private.module_allowed('vendorQuotes',true) then
  raise exception 'module_forbidden' using errcode='42501';
 end if;
 if p_status is null or p_status not in ('À valider','Pour information') then
  raise exception 'invalid_vendor_quote_status' using errcode='22023';
 end if;
 -- The workspace row serializes this check with invoice creation and editing.
 -- Invoice contribution/read rights are intentionally unnecessary: the action
 -- inspects links internally and only ever updates the authorized quote.
 select payload into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
 if p_revision is distinct from app_private.module_revision('vendorQuotes',w) then
  raise exception 'revision_conflict' using errcode='40001';
 end if;
 select r into q from jsonb_array_elements(coalesce(w->'vendorQuotes','[]')) r where r->>'id'=p_quote;
 if q is null then raise exception 'quote_missing'; end if;
 if (p_status='Pour information' and coalesce(q->>'status','') not in ('À valider','Refusé','Pour information'))
  or (p_status='À valider' and coalesce(q->>'status','') not in ('Pour information','À valider')) then
  raise exception 'vendor_quote_information_transition_forbidden' using errcode='22023';
 end if;
 if p_status='Pour information' then
  linked:=nullif(q->>'linkedInvoiceId','');
  select count(*) into reverse_count from jsonb_array_elements(coalesce(w->'vendorInvoices','[]')) r where r->>'sourceQuoteId'=p_quote;
  if linked is not null then
   select r into invoice from jsonb_array_elements(coalesce(w->'vendorInvoices','[]')) r where r->>'id'=linked;
   if invoice is null then raise exception 'broken_explicit_invoice_link' using errcode='23514'; end if;
   if (coalesce(invoice->>'sourceQuoteId','')<>'' and invoice->>'sourceQuoteId'<>p_quote)
    or exists(select 1 from jsonb_array_elements(coalesce(w->'vendorQuotes','[]')) r where r->>'id'<>p_quote and r->>'linkedInvoiceId'=linked)
    or exists(select 1 from jsonb_array_elements(coalesce(w->'vendorInvoices','[]')) r where r->>'sourceQuoteId'=p_quote and r->>'id' is distinct from linked) then
    raise exception 'vendor_quote_invoice_link_inconsistent' using errcode='23514';
   end if;
   raise exception 'vendor_quote_has_linked_invoice' using errcode='23514';
  end if;
  if reverse_count>1 or exists(select 1 from jsonb_array_elements(coalesce(w->'vendorInvoices','[]')) r where r->>'sourceQuoteId'=p_quote and coalesce(r->>'id','')='') then
   raise exception 'vendor_quote_invoice_link_inconsistent' using errcode='23514';
  end if;
  if reverse_count>0 then raise exception 'vendor_quote_has_linked_invoice' using errcode='23514'; end if;
 end if;
 if q->>'status'=p_status then return public.crm_read_module('vendorQuotes'); end if;
 q:=q||jsonb_build_object('status',p_status,'updatedBy',auth.uid(),'updatedAt',clock_timestamp());
 update public.crm_workspace_state set payload=jsonb_set(w,'{vendorQuotes}',
  (select jsonb_agg(case when r->>'id'=p_quote then q else r end) from jsonb_array_elements(w->'vendorQuotes') r)),
  updated_by=auth.uid() where workspace_id='oneaddress-riviera';
 return public.crm_read_module('vendorQuotes');
end $$;

create function public.crm_set_vendor_quote_information(p_quote text,p_status text,p_revision text) returns jsonb
language sql security invoker set search_path=pg_catalog as $$
 select app_private.set_vendor_quote_information(p_quote,p_status,p_revision);
$$;

-- Keep validation explicit and idempotent, and enforce its document prerequisite
-- on the server as well as the form. Existing invoices remain untouched.
create function app_private.validate_vendor_quote(p_quote text,p_revision text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare w jsonb; q jsonb; invoice jsonb; invoices jsonb; linked text;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if auth.uid() is null or not app_private.module_allowed('vendorQuotes',true) or not app_private.module_allowed('vendorInvoices',true) then
  raise exception 'both_finance_modules_required' using errcode='42501';
 end if;
 select payload into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
 if p_revision is distinct from app_private.module_revision('vendorQuotes',w) then raise exception 'revision_conflict' using errcode='40001'; end if;
 select r into q from jsonb_array_elements(coalesce(w->'vendorQuotes','[]')) r where r->>'id'=p_quote;
 if q is null then raise exception 'quote_missing'; end if;
 if q->>'status' is distinct from 'Validé'
  and coalesce(nullif(q->>'quoteDocumentStoragePath',''),nullif(q->>'quoteDocumentUrl','')) is null then
  raise exception 'quote_document_required' using errcode='23514';
 end if;
 invoices:=coalesce(w->'vendorInvoices','[]');linked:=nullif(q->>'linkedInvoiceId','');
 if linked is not null then
  select r into invoice from jsonb_array_elements(invoices) r where r->>'id'=linked;
  if invoice is null then raise exception 'broken_explicit_invoice_link'; end if;
  if coalesce(invoice->>'sourceQuoteId','')<>'' and invoice->>'sourceQuoteId'<>p_quote then
   raise exception 'vendor_quote_invoice_link_inconsistent' using errcode='23514';
  end if;
 else
  select r into invoice from jsonb_array_elements(invoices) r where r->>'sourceQuoteId'=p_quote limit 1;
 end if;
 if exists(select 1 from jsonb_array_elements(invoices) r where r->>'sourceQuoteId'=p_quote and r->>'id' is distinct from invoice->>'id') then
  raise exception 'vendor_quote_invoice_link_inconsistent' using errcode='23514';
 end if;
 if invoice is null then
  invoice:=jsonb_build_object('id',gen_random_uuid(),'contactId',q->'contactId','contactName',q->'contactName','contactPersonName',q->'contactPersonName','category',q->'category','title','Facture attendue · '||(q->>'title'),'amount',q->'amount','paidAmount',0,'status','En attente de facture','sourceQuoteId',p_quote,'sourceQuoteReference',q->'quoteReference','invoiceDate','','dueDate','','createdAt',clock_timestamp(),'createdBy',auth.uid());
  invoices:=jsonb_build_array(invoice)||invoices;
 end if;
 q:=q||jsonb_build_object('status','Validé','validatedAt',coalesce(q->>'validatedAt',clock_timestamp()::text),'linkedInvoiceId',invoice->'id','updatedBy',auth.uid());
 w:=jsonb_set(w,'{vendorQuotes}',(select jsonb_agg(case when r->>'id'=p_quote then q else r end) from jsonb_array_elements(w->'vendorQuotes') r));
 update public.crm_workspace_state set payload=jsonb_set(w,'{vendorInvoices}',invoices),updated_by=auth.uid() where workspace_id='oneaddress-riviera';
 return public.crm_read_module('vendorQuotes');
end $$;

create or replace function public.crm_validate_vendor_quote(p_quote text,p_revision text) returns jsonb
language sql security invoker set search_path=pg_catalog as $$
 select app_private.validate_vendor_quote(p_quote,p_revision);
$$;

revoke all on function app_private.create_vendor_quote(text,jsonb,text,text),app_private.set_vendor_quote_information(text,text,text),app_private.validate_vendor_quote(text,text),public.crm_create_vendor_quote(text,jsonb,text,text),public.crm_set_vendor_quote_information(text,text,text),public.crm_validate_vendor_quote(text,text) from public,anon,authenticated;
grant execute on function app_private.create_vendor_quote(text,jsonb,text,text),app_private.set_vendor_quote_information(text,text,text),app_private.validate_vendor_quote(text,text),public.crm_create_vendor_quote(text,jsonb,text,text),public.crm_set_vendor_quote_information(text,text,text),public.crm_validate_vendor_quote(text,text) to authenticated;
notify pgrst,'reload schema';
commit;
