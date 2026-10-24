-- Add authorized house address/city to task suggestions. No business data rewrite.
begin;
do $$ declare definition text; begin
 if to_regprocedure('app_private.task_target_resolve_before_house_address(jsonb,boolean)') is null then
  select pg_get_functiondef('app_private.task_target_resolve(jsonb,boolean)'::regprocedure) into definition;
  execute replace(definition,'FUNCTION app_private.task_target_resolve(','FUNCTION app_private.task_target_resolve_before_house_address(');
 end if;
end $$;
create or replace function app_private.task_target_resolve(p_ref jsonb,p_for_add boolean default false) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb; house jsonb; address_value text; city_value text;
begin
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
revoke all on function app_private.task_target_resolve_before_house_address(jsonb,boolean),app_private.task_target_resolve(jsonb,boolean) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
