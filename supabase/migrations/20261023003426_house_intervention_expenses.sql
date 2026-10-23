-- Add optional expenses to an intervention without rewriting any business data.
update app_private.module_collections
set fields = fields || '{"expenseAmount":{"type":"number","label":"Frais annexes (€)"},"expenseNote":{"type":"string","label":"Motif des frais"}}'::jsonb
where collection = 'houseTimeEntries' and module = 'houseTracking';

-- Covers both projected RPC mutations and full-access workspace saves. Only new
-- or changed expense fields are checked, leaving all historical rows untouched.
create function app_private.guard_house_time_expenses() returns trigger
language plpgsql set search_path = pg_catalog as $$
declare r jsonb; amount numeric;
begin
  if TG_OP = 'UPDATE' and new.payload->'houseTimeEntries' is not distinct from old.payload->'houseTimeEntries' then
    return new;
  end if;
  for r in
    select n.value
    from jsonb_array_elements(coalesce(new.payload->'houseTimeEntries', '[]'::jsonb)) n
    left join jsonb_array_elements(case when TG_OP = 'UPDATE' then coalesce(old.payload->'houseTimeEntries', '[]'::jsonb) else '[]'::jsonb end) o
      on o.value->>'id' = n.value->>'id'
    where o.value is null
       or n.value->'expenseAmount' is distinct from o.value->'expenseAmount'
       or n.value->'expenseNote' is distinct from o.value->'expenseNote'
  loop
    if r ? 'expenseAmount' then
      if jsonb_typeof(r->'expenseAmount') is distinct from 'number' then
        raise exception 'invalid_expense_amount' using errcode = '22023';
      end if;
      amount := (r->>'expenseAmount')::numeric;
      if amount < 0 or amount > 100000000000 or amount <> round(amount, 2) then
        raise exception 'invalid_expense_amount' using errcode = '22023';
      end if;
    end if;
    if r ? 'expenseNote' and (jsonb_typeof(r->'expenseNote') is distinct from 'string' or length(r->>'expenseNote') > 4000) then
      raise exception 'invalid_expense_note' using errcode = '22023';
    end if;
  end loop;
  return new;
end $$;
revoke all on function app_private.guard_house_time_expenses() from public, anon, authenticated;
create trigger crm_guard_house_time_expenses
before insert or update of payload on public.crm_workspace_state
for each row execute function app_private.guard_house_time_expenses();

-- Targeted patch: never creates hours, changes their rate, or touches payments.
create function public.crm_update_house_time_expenses(p_id text, p_patch jsonb, p_revision text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare w public.crm_workspace_state%rowtype; entry jsonb; result jsonb; owner_access boolean;
begin
  perform pg_advisory_xact_lock_shared(734991);
  if not app_private.module_allowed('houseTracking', true) then
    raise exception 'module_forbidden' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
    or not (p_patch ? 'expenseAmount')
    or jsonb_typeof(p_patch->'expenseAmount') is distinct from 'number'
    or exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('expenseAmount', 'expenseNote')) then
    raise exception 'invalid_expense_patch' using errcode = '22023';
  end if;
  owner_access := app_private.full_access();
  select * into strict w from public.crm_workspace_state where workspace_id = 'oneaddress-riviera' for update;
  if owner_access then
    if p_revision::timestamptz is distinct from w.updated_at then
      raise exception 'revision_conflict' using errcode = '40001';
    end if;
  elsif p_revision is distinct from app_private.module_revision('houseTracking', w.payload) then
    raise exception 'revision_conflict' using errcode = '40001';
  end if;
  if (select count(*) from jsonb_array_elements(coalesce(w.payload->'houseTimeEntries', '[]')) r where r->>'id' = p_id) <> 1 then
    raise exception 'record_missing';
  end if;
  result := public.crm_mutate_record('houseTracking', 'houseTimeEntries', p_id,
    p_patch, app_private.module_revision('houseTracking', w.payload), false);
  if owner_access then
    select * into strict w from public.crm_workspace_state where workspace_id = 'oneaddress-riviera';
    select r into entry from jsonb_array_elements(w.payload->'houseTimeEntries') r where r->>'id' = p_id;
    return jsonb_build_object('entry', entry, 'workspaceRevision', w.updated_at);
  end if;
  return result;
end $$;
revoke all on function public.crm_update_house_time_expenses(text, jsonb, text) from public, anon;
grant execute on function public.crm_update_house_time_expenses(text, jsonb, text) to authenticated;

-- Reuse the existing source projection and access checks. Expenses stay on the
-- same hours source, and their reason stays in Personnel, outside Charges.
create or replace function public.crm_read_monthly_charges(p_export boolean default false,p_sources text[] default array['invoice','hours']) returns jsonb
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
   ||(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(r) where key=any(array['houseId','houseName','date','startTime','endTime','breakMinutes','hourlyRate','expenseAmount']))),'[]') into entries
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


notify pgrst, 'reload schema';
