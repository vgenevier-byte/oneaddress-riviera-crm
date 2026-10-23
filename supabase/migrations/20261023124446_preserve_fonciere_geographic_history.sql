-- Retired business coordinates are historical data. Address changes still
-- invalidate provider metadata, without rewriting guided values or snapshots.
begin;

create or replace function app_private.guard_project_address_metadata() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare d jsonb:=new.payload->'data'; prior jsonb:='{}'::jsonb; presentation jsonb; old_presentation jsonb;
begin
 if jsonb_typeof(d) is distinct from 'object' then return new; end if;
 if tg_op='UPDATE' then prior:=old.payload->'data'; end if;
 if tg_table_name='fonciere_projects' then
  if not(d ? 'propertyAddressDetails') and prior ? 'propertyAddressDetails' then d:=jsonb_set(d,'{propertyAddressDetails}',prior->'propertyAddressDetails'); end if;
  d:=app_private.reconcile_address_record(d,prior,app_private.fonciere_address_text(d),'propertyAddressDetails',d->>'city');
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

commit;
