-- Dedicated family arbitration. No opinion, author or remark is added to a
-- project payload, presentation payload, Drive outbox or public table.
begin;
select pg_advisory_xact_lock(734991);

create table app_private.fonciere_arbitrage_config (
 singleton boolean primary key default true check(singleton), revision bigint not null default 1,
 vincent uuid references auth.users(id), ann_charlotte uuid references auth.users(id),
 vincent_epoch bigint not null default 1, ann_charlotte_epoch bigint not null default 1,
 check(vincent is null or ann_charlotte is null or vincent<>ann_charlotte)
);
insert into app_private.fonciere_arbitrage_config(singleton) values(true);
create table app_private.fonciere_arbitrage_config_history (
 id bigint generated always as identity primary key, actor_id uuid references auth.users(id),
 actor_source text not null default 'crm_account' check(actor_source in ('crm_account','deployment')),
 check(actor_id is not null or actor_source='deployment'),
 recorded_at timestamptz not null default clock_timestamp(), before_config jsonb not null, after_config jsonb not null
);
-- Monotonic business generations prevent a changed-then-reverted dossier from
-- silently reusing an old approval. This counter is independent of project
-- revisions and can never be changed by recording an opinion.
create table app_private.fonciere_dossier_versions (
 project_id uuid primary key references public.fonciere_projects(id), business_version bigint not null default 1
);
insert into app_private.fonciere_dossier_versions(project_id) select id from public.fonciere_projects;
create table app_private.fonciere_arbitrage_snapshots (
 project_id uuid not null references public.fonciere_projects(id), fingerprint text not null,
 project_revision integer not null, title text not null, project_reference text not null,
 payload jsonb not null, assets jsonb not null, captured_at timestamptz not null default clock_timestamp(),
 primary key(project_id,fingerprint)
);
create table app_private.fonciere_arbitrage_opinions (
 project_id uuid not null references public.fonciere_projects(id), slot text not null check(slot in ('vincent','ann_charlotte')),
 author_id uuid not null references auth.users(id), account_epoch bigint not null,
 choice text not null check(choice in ('pending','approved','refused','deepen')),
 remark text not null check(length(remark)<=12000), recorded_at timestamptz not null default clock_timestamp(),
 fingerprint text not null, primary key(project_id,slot),
 foreign key(project_id,fingerprint) references app_private.fonciere_arbitrage_snapshots(project_id,fingerprint),
 check(choice not in ('refused','deepen') or length(btrim(remark))>0)
);
create table app_private.fonciere_arbitrage_history (
 id bigint generated always as identity primary key,
 project_id uuid not null references public.fonciere_projects(id), slot text not null check(slot in ('vincent','ann_charlotte')),
 author_id uuid not null references auth.users(id), account_epoch bigint not null,
 choice text not null check(choice in ('pending','approved','refused','deepen')), remark text not null,
 recorded_at timestamptz not null default clock_timestamp(), fingerprint text not null,
 foreign key(project_id,fingerprint) references app_private.fonciere_arbitrage_snapshots(project_id,fingerprint)
);
create index fonciere_arbitrage_history_project on app_private.fonciere_arbitrage_history(project_id,id desc);
create table app_private.fonciere_bank_presentations (
 project_id uuid primary key references public.fonciere_projects(id),
 presentation_id uuid unique references public.izord_projects(id),
 approved_fingerprint text not null, prepared_fingerprint text,
 state text not null default 'pending' check(state in ('pending','preparing','ready','blocked')),
 reason text, claim_token uuid, claim_author uuid references auth.users(id), claim_fingerprint text,
 claim_revision integer, claimed_at timestamptz, updated_at timestamptz not null default clock_timestamp(),
 foreign key(project_id,approved_fingerprint) references app_private.fonciere_arbitrage_snapshots(project_id,fingerprint)
);

do $$ declare t text; begin
 foreach t in array array['fonciere_arbitrage_config','fonciere_arbitrage_config_history','fonciere_dossier_versions','fonciere_arbitrage_snapshots','fonciere_arbitrage_opinions','fonciere_arbitrage_history','fonciere_bank_presentations'] loop
  execute format('alter table app_private.%I enable row level security',t);
  execute format('revoke all on app_private.%I from public,anon,authenticated',t);
 end loop;
end $$;

-- All saved business data, contact identities and referenced immutable document
-- identities/content versions affect approval. Technical revision/timestamps,
-- creation retry hashes, archive state and the separate Drive queue do not.
-- Merely uploading an unattached pending file is not a dossier change.
create function app_private.fonciere_dossier(p_project uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('businessVersion',coalesce((select v.business_version from app_private.fonciere_dossier_versions v where v.project_id=p.id),1),'data',p.payload->'data','sourceDocuments',p.payload->'sourceDocuments',
  'contacts',coalesce((select jsonb_build_object('agent',c.contact_id,'agency',c.agency_contact_id) from public.fonciere_project_contacts c where c.project_id=p.id),'{}'),
  'assets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'project_id',a.project_id,'object_path',a.object_path,'kind',a.kind,'lifecycle',a.lifecycle,
    'expected_size',a.expected_size,'expected_mime',a.expected_mime,'original_name',a.original_name,
    'storage_object_id',a.storage_object_id,'storage_object_version',a.storage_object_version,'drive_category',a.drive_category) order by a.id)
   from public.fonciere_assets a where a.project_id=p.id and a.id::text in (
    select value#>>'{}' from jsonb_array_elements(coalesce(p.payload->'sourceDocuments','[]'))
    union select value from jsonb_each_text(coalesce(p.payload#>'{data,presentationData,photos}','{}'))
    union select value->>'data' from jsonb_array_elements(coalesce(p.payload#>'{data,presentationData,importGallery}','[]'))
   )),'[]')) from public.fonciere_projects p where p.id=p_project;
$$;
create function app_private.track_fonciere_dossier_version() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare project uuid; changed boolean:=false;
begin
 if tg_table_name='fonciere_projects' then
  project:=new.id;
  if tg_op='INSERT' then
   insert into app_private.fonciere_dossier_versions(project_id) values(project) on conflict do nothing;
   return new;
  end if;
  changed:=old.payload->'data' is distinct from new.payload->'data' or old.payload->'sourceDocuments' is distinct from new.payload->'sourceDocuments';
 elsif tg_table_name='fonciere_project_contacts' then
  project:=case when tg_op='DELETE' then old.project_id else new.project_id end;
  changed:=tg_op in ('INSERT','DELETE') or (old.contact_id is distinct from new.contact_id or old.agency_contact_id is distinct from new.agency_contact_id);
 else
  project:=case when tg_op='DELETE' then old.project_id else new.project_id end;
  -- Unattached uploads/finalizations and technical metadata are ignored.
  changed:=exists(select 1 from public.fonciere_projects p where p.id=project and (
   p.payload->'sourceDocuments' @> jsonb_build_array(case when tg_op='DELETE' then old.id::text else new.id::text end)
   or exists(select 1 from jsonb_each_text(coalesce(p.payload#>'{data,presentationData,photos}','{}')) kv where kv.value=case when tg_op='DELETE' then old.id::text else new.id::text end)
   or exists(select 1 from jsonb_array_elements(coalesce(p.payload#>'{data,presentationData,importGallery}','[]')) item where item->>'data'=case when tg_op='DELETE' then old.id::text else new.id::text end)
  ));
  if tg_op='UPDATE' then changed:=changed and (old.lifecycle is distinct from new.lifecycle or old.storage_object_version is distinct from new.storage_object_version
   or old.original_name is distinct from new.original_name or old.drive_category is distinct from new.drive_category); end if;
 end if;
 if changed then
  perform 1 from public.fonciere_projects where id=project for update;
  insert into app_private.fonciere_dossier_versions(project_id,business_version) values(project,2)
  on conflict(project_id) do update set business_version=fonciere_dossier_versions.business_version+1;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger fonciere_dossier_project_generation after insert or update of payload on public.fonciere_projects for each row execute function app_private.track_fonciere_dossier_version();
create trigger fonciere_dossier_contact_generation after insert or update or delete on public.fonciere_project_contacts for each row execute function app_private.track_fonciere_dossier_version();
create trigger fonciere_dossier_asset_generation after insert or update or delete on public.fonciere_assets for each row execute function app_private.track_fonciere_dossier_version();

create function app_private.fonciere_dossier_fingerprint(p_project uuid) returns text
language sql stable security definer set search_path=pg_catalog as $$
 select encode(sha256(convert_to(app_private.fonciere_dossier(p_project)::text,'UTF8')),'hex');
$$;
create function app_private.fonciere_arbitrage_status(p_project uuid,p_fingerprint text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare c app_private.fonciere_arbitrage_config%rowtype; v text; a text; result text; waiting jsonb:='[]';
begin
 select * into strict c from app_private.fonciere_arbitrage_config where singleton;
 select choice into v from app_private.fonciere_arbitrage_opinions o where o.project_id=p_project and o.slot='vincent'
  and o.author_id=c.vincent and o.account_epoch=c.vincent_epoch and o.fingerprint=p_fingerprint;
 select choice into a from app_private.fonciere_arbitrage_opinions o where o.project_id=p_project and o.slot='ann_charlotte'
  and o.author_id=c.ann_charlotte and o.account_epoch=c.ann_charlotte_epoch and o.fingerprint=p_fingerprint;
 result:=case when v='approved' and a='approved' then 'approved' when v='refused' and a='refused' then 'refused'
  when v='deepen' or a='deepen' then 'deepen' else 'pending' end;
 if v is null or v='pending' then waiting:=waiting||'"vincent"'::jsonb; end if;
 if a is null or a='pending' then waiting:=waiting||'"ann_charlotte"'::jsonb; end if;
 return jsonb_build_object('status',result,'pending',waiting,'disagreement',coalesce((v='approved' and a='refused') or (v='refused' and a='approved'),false));
end $$;

create function app_private.fonciere_arbitrage_read(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare p public.fonciere_projects%rowtype; c app_private.fonciere_arbitrage_config%rowtype;
 b app_private.fonciere_bank_presentations%rowtype; fp text; own_slot text; result jsonb; private_opinions jsonb; private_history jsonb;
 can_prepare boolean; bank_state text; bank_reason text; approved boolean;
begin
 if auth.uid() is null or not app_private.can_fonciere_project(p_project) then raise exception 'arbitrage_forbidden' using errcode='42501'; end if;
 select * into strict p from public.fonciere_projects where id=p_project;
 select * into strict c from app_private.fonciere_arbitrage_config where singleton;
 fp:=app_private.fonciere_dossier_fingerprint(p_project);
 own_slot:=case when auth.uid()=c.vincent then 'vincent' when auth.uid()=c.ann_charlotte then 'ann_charlotte' end;
 result:=app_private.fonciere_arbitrage_status(p_project,fp);
 select * into b from app_private.fonciere_bank_presentations where project_id=p_project;
 can_prepare:=app_private.module_allowed('fonciere',false,'export') and app_private.module_allowed('izord',true)
  and app_private.has_membership('izord',array['admin','partner','contributor'])
  and (b.presentation_id is null or app_private.can_project(b.presentation_id,true));
 approved:=result->>'status'='approved' and b.approved_fingerprint=fp and (b.prepared_fingerprint is null or b.prepared_fingerprint=fp) and b.reason is distinct from 'presentation_changed';
 bank_state:=coalesce(b.state,'none'); bank_reason:=b.reason;
 if result->>'status'='approved' and b.prepared_fingerprint is null and not can_prepare then bank_state:='blocked'; bank_reason:='permissions'; end if;
 if b.state='preparing' and b.claimed_at<clock_timestamp()-interval '10 minutes' then bank_state:='pending'; bank_reason:='interrupted'; end if;
 if own_slot is not null then
  select coalesce(jsonb_object_agg(o.slot,jsonb_build_object('choice',o.choice,'remark',o.remark,'recordedAt',o.recorded_at,'authorId',o.author_id,'fingerprint',o.fingerprint,
   'stale',o.fingerprint<>fp or case when o.slot='vincent' then o.author_id is distinct from c.vincent or o.account_epoch<>c.vincent_epoch else o.author_id is distinct from c.ann_charlotte or o.account_epoch<>c.ann_charlotte_epoch end)),'{}')
   into private_opinions from app_private.fonciere_arbitrage_opinions o where o.project_id=p_project;
  select coalesce(jsonb_agg(jsonb_build_object('slot',h.slot,'choice',h.choice,'remark',h.remark,'recordedAt',h.recorded_at,'authorId',h.author_id,'fingerprint',h.fingerprint,'stale',h.fingerprint<>fp) order by h.id desc),'[]')
   into private_history from (select * from app_private.fonciere_arbitrage_history where project_id=p_project order by id desc limit 200) h;
  result:=result||jsonb_build_object('opinions',private_opinions,'history',private_history);
 end if;
 return result||jsonb_build_object('projectId',p.id,'fingerprint',fp,'revision',p.revision,'private',own_slot is not null,
  'canVote',case when p.status='active' then own_slot end,
  'bank',jsonb_build_object('presentationId',case when b.presentation_id is not null and app_private.can_project(b.presentation_id) then b.presentation_id end,
   'state',bank_state,'reason',bank_reason,'approvedFingerprint',b.approved_fingerprint,'currentApproval',coalesce(approved,false),
   'needsUpdate',(b.prepared_fingerprint is not null and b.prepared_fingerprint is distinct from b.approved_fingerprint) or coalesce(b.reason='presentation_changed',false),
   'missing',coalesce((select t.payload#>'{data,importMeta,fonciereBankMissing}' from public.izord_projects t where t.id=b.presentation_id and app_private.can_project(t.id)),'[]'),'canPrepare',can_prepare and result->>'status'='approved','canOpen',b.presentation_id is not null and app_private.can_project(b.presentation_id)));
end $$;

create function app_private.fonciere_arbitrage_vote(p_project uuid,p_fingerprint text,p_choice text,p_remark text default '') returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p public.fonciere_projects%rowtype; c app_private.fonciere_arbitrage_config%rowtype; own_slot text; epoch bigint; fp text; remark text; dossier jsonb;
begin
 -- Same access-change lock and row lock order as ordinary project saves.
 perform pg_advisory_xact_lock_shared(734991);
 if auth.uid() is null or not app_private.can_fonciere_project(p_project) then raise exception 'arbitrage_forbidden' using errcode='42501'; end if;
 select * into strict c from app_private.fonciere_arbitrage_config where singleton for share;
 own_slot:=case when auth.uid()=c.vincent then 'vincent' when auth.uid()=c.ann_charlotte then 'ann_charlotte' end;
 if own_slot is null then raise exception 'arbitrage_own_opinion_only' using errcode='42501'; end if;
 select * into strict p from public.fonciere_projects where id=p_project for update;
 if p.status<>'active' then raise exception 'arbitrage_archived' using errcode='42501'; end if;
 if p_choice is null or p_choice not in ('pending','approved','refused','deepen') or p_remark is null or length(p_remark)>12000 then raise exception 'arbitrage_invalid_opinion' using errcode='22023'; end if;
 remark:=regexp_replace(p_remark,'^[[:space:]]+|[[:space:]]+$','','g');
 if p_choice in ('refused','deepen') and remark='' then raise exception 'arbitrage_remark_required' using errcode='22023'; end if;
 fp:=app_private.fonciere_dossier_fingerprint(p_project);
 if p_fingerprint is distinct from fp then raise exception 'arbitrage_dossier_changed' using errcode='40001'; end if;
 dossier:=app_private.fonciere_dossier(p_project);
 if exists(select 1 from jsonb_array_elements(dossier->'assets') asset where asset->>'lifecycle'<>'finalized') then raise exception 'arbitrage_document_changed' using errcode='40001'; end if;
 insert into app_private.fonciere_arbitrage_snapshots(project_id,fingerprint,project_revision,title,project_reference,payload,assets)
 values(p.id,fp,p.revision,p.title,p.project_reference,p.payload,dossier->'assets') on conflict do nothing;
 epoch:=case when own_slot='vincent' then c.vincent_epoch else c.ann_charlotte_epoch end;
 insert into app_private.fonciere_arbitrage_opinions(project_id,slot,author_id,account_epoch,choice,remark,fingerprint)
 values(p.id,own_slot,auth.uid(),epoch,p_choice,remark,fp)
 on conflict(project_id,slot) do update set author_id=excluded.author_id,account_epoch=excluded.account_epoch,choice=excluded.choice,
 remark=excluded.remark,fingerprint=excluded.fingerprint,recorded_at=clock_timestamp();
 insert into app_private.fonciere_arbitrage_history(project_id,slot,author_id,account_epoch,choice,remark,fingerprint)
 values(p.id,own_slot,auth.uid(),epoch,p_choice,remark,fp);
 if app_private.fonciere_arbitrage_status(p.id,fp)->>'status'='approved' then
  insert into app_private.fonciere_bank_presentations(project_id,approved_fingerprint) values(p.id,fp)
  on conflict(project_id) do update set approved_fingerprint=excluded.approved_fingerprint,updated_at=clock_timestamp();
 end if;
 -- Deliberately no update of public.fonciere_projects or Drive outbox.
 return app_private.fonciere_arbitrage_read(p.id);
end $$;

create function app_private.fonciere_arbitrage_list() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'arbitrage_forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_object_agg(p.id::text,app_private.fonciere_arbitrage_status(p.id,app_private.fonciere_dossier_fingerprint(p.id))),'{}') into result
 from public.fonciere_projects p where app_private.can_fonciere_project(p.id);
 return result;
end $$;
create function app_private.fonciere_arbitrage_config_read() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not app_private.general_admin() then raise exception 'arbitrage_admin_required' using errcode='42501'; end if;
 return (select jsonb_build_object('revision',revision,'vincent',vincent,'annCharlotte',ann_charlotte) from app_private.fonciere_arbitrage_config where singleton);
end $$;
create function app_private.fonciere_arbitrage_config_save(p_revision bigint,p_vincent uuid,p_ann_charlotte uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare c app_private.fonciere_arbitrage_config%rowtype; after_config jsonb; account uuid;
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.general_admin() then raise exception 'arbitrage_admin_required' using errcode='42501'; end if;
 select * into strict c from app_private.fonciere_arbitrage_config where singleton for update;
 if c.revision is distinct from p_revision then raise exception 'arbitrage_config_changed' using errcode='40001'; end if;
 if p_vincent is not null and p_vincent=p_ann_charlotte then raise exception 'arbitrage_accounts_must_differ' using errcode='22023'; end if;
 foreach account in array array[p_vincent,p_ann_charlotte] loop
  if account is not null and not exists(select 1 from auth.users u join public.crm_access_profiles p on p.user_id=u.id
   where u.id=account and p.active and u.email_confirmed_at is not null) then raise exception 'arbitrage_crm_account_required' using errcode='22023'; end if;
 end loop;
 if c.vincent is not distinct from p_vincent and c.ann_charlotte is not distinct from p_ann_charlotte then return app_private.fonciere_arbitrage_config_read(); end if;
 update app_private.fonciere_arbitrage_config set vincent=p_vincent,ann_charlotte=p_ann_charlotte,revision=revision+1,
  vincent_epoch=vincent_epoch+case when vincent is distinct from p_vincent then 1 else 0 end,
  ann_charlotte_epoch=ann_charlotte_epoch+case when ann_charlotte is distinct from p_ann_charlotte then 1 else 0 end where singleton;
 select to_jsonb(x) into after_config from app_private.fonciere_arbitrage_config x where singleton;
 insert into app_private.fonciere_arbitrage_config_history(actor_id,before_config,after_config) values(auth.uid(),to_jsonb(c),after_config);
 return app_private.fonciere_arbitrage_config_read();
end $$;

-- Reserve the one principal dossier under the actor's existing source-export
-- and presentation-create/write permissions. An opinion never needs these.
create function app_private.fonciere_bank_prepare(p_project uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p public.fonciere_projects%rowtype; b app_private.fonciere_bank_presentations%rowtype;
 s app_private.fonciere_arbitrage_snapshots%rowtype; target public.izord_projects%rowtype;
 fp text; token uuid; why text;
begin
 perform pg_advisory_xact_lock(734991);
 if auth.uid() is null or not app_private.can_fonciere_project(p_project) then raise exception 'arbitrage_forbidden' using errcode='42501'; end if;
 select * into strict p from public.fonciere_projects where id=p_project for update;
 fp:=app_private.fonciere_dossier_fingerprint(p.id);
 if app_private.fonciere_arbitrage_status(p.id,fp)->>'status'<>'approved' then raise exception 'arbitrage_double_approval_required' using errcode='42501'; end if;
 select * into strict b from app_private.fonciere_bank_presentations where project_id=p.id for update;
 if not app_private.module_allowed('fonciere',false,'export') or not app_private.module_allowed('izord',true)
  or not app_private.has_membership('izord',array['admin','partner','contributor'])
  or b.presentation_id is not null and not app_private.can_project(b.presentation_id,true) then
  update app_private.fonciere_bank_presentations set state=case when prepared_fingerprint is null then 'blocked' else state end,reason='permissions',updated_at=clock_timestamp() where project_id=p.id;
  return jsonb_build_object('blocked',true,'reason','permissions');
 end if;
 if b.presentation_id is not null then
  select * into strict target from public.izord_projects where id=b.presentation_id for update;
  -- A lost response after saving is recovered from the saved snapshot marker.
  if target.payload#>>'{data,importMeta,fonciereBankApproval,fingerprint}'=b.claim_fingerprint then
   update app_private.fonciere_bank_presentations set prepared_fingerprint=b.claim_fingerprint,state='ready',reason=null,claim_token=null,updated_at=clock_timestamp() where project_id=p.id;
   return jsonb_build_object('presentationId',b.presentation_id,'ready',true,'needsUpdate',b.claim_fingerprint is distinct from b.approved_fingerprint);
  end if;
  if b.prepared_fingerprint is not null or target.revision>1 then
   if b.prepared_fingerprint is null then
    update app_private.fonciere_bank_presentations set state='blocked',reason='presentation_changed',claim_token=null,updated_at=clock_timestamp() where project_id=p.id;
   end if;
   return jsonb_build_object('presentationId',b.presentation_id,'ready',true,'needsUpdate',b.prepared_fingerprint is distinct from b.approved_fingerprint);
  end if;
 end if;
 if b.state='preparing' and b.claimed_at>clock_timestamp()-interval '10 minutes' then
  return jsonb_build_object('presentationId',b.presentation_id,'preparing',true);
 end if;
 select * into strict s from app_private.fonciere_arbitrage_snapshots where project_id=p.id and fingerprint=b.approved_fingerprint;
 if b.presentation_id is null then
  b.presentation_id:=app_private.create_project(s.project_reference||' — '||left(s.title,greatest(1,200-length(s.project_reference)-length(' — ')-length(' — Dossier bancaire')))||' — Dossier bancaire');
  select * into strict target from public.izord_projects where id=b.presentation_id;
 end if;
 token:=gen_random_uuid();
 update app_private.fonciere_bank_presentations set presentation_id=b.presentation_id,state='preparing',reason=null,claim_token=token,
  claim_author=auth.uid(),claim_fingerprint=s.fingerprint,claim_revision=target.revision,claimed_at=clock_timestamp(),updated_at=clock_timestamp() where project_id=p.id;
 return jsonb_build_object('presentationId',b.presentation_id,'revision',target.revision,'token',token,'fingerprint',s.fingerprint,
  'snapshot',jsonb_build_object('id',s.project_id,'revision',s.project_revision,'title',s.title,'project_reference',s.project_reference,'payload',s.payload),
  'assets',s.assets);
end $$;

create function app_private.fonciere_bank_finish(p_project uuid,p_token uuid,p_revision integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare b app_private.fonciere_bank_presentations%rowtype; target public.izord_projects%rowtype;
begin
 perform pg_advisory_xact_lock(734991);
 if auth.uid() is null or not app_private.can_fonciere_project(p_project) then raise exception 'arbitrage_forbidden' using errcode='42501'; end if;
 select * into strict b from app_private.fonciere_bank_presentations where project_id=p_project for update;
 if not app_private.module_allowed('fonciere',false,'export') or not app_private.can_project(b.presentation_id,true) then raise exception 'arbitrage_forbidden' using errcode='42501'; end if;
 if b.state='ready' and b.claim_token is null then return app_private.fonciere_arbitrage_read(p_project); end if;
 if b.claim_token is distinct from p_token or b.claim_author is distinct from auth.uid() then raise exception 'arbitrage_preparation_claim_changed' using errcode='40001'; end if;
 select * into strict target from public.izord_projects where id=b.presentation_id;
 if target.revision is distinct from p_revision or target.status<>'draft'
  or target.payload#>>'{data,importMeta,fonciereBankApproval,fingerprint}' is distinct from b.claim_fingerprint then raise exception 'arbitrage_preparation_not_saved' using errcode='40001'; end if;
 update app_private.fonciere_bank_presentations set prepared_fingerprint=b.claim_fingerprint,state='ready',reason=null,claim_token=null,updated_at=clock_timestamp() where project_id=p_project;
 return app_private.fonciere_arbitrage_read(p_project);
end $$;
create function app_private.fonciere_bank_fail(p_project uuid,p_token uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock(734991);
 if auth.uid() is null or not app_private.can_fonciere_project(p_project) then raise exception 'arbitrage_forbidden' using errcode='42501'; end if;
 if p_reason is null or p_reason not in ('permissions','documents','interrupted','error','preparation_failed') then raise exception 'arbitrage_invalid_reason' using errcode='22023'; end if;
 update app_private.fonciere_bank_presentations set state='blocked',reason=p_reason,claim_token=null,updated_at=clock_timestamp()
 where project_id=p_project and claim_token=p_token and claim_author=auth.uid();
 return app_private.fonciere_arbitrage_read(p_project);
end $$;

create function public.fonciere_arbitrage_read(p_project uuid) returns jsonb language sql security invoker set search_path=pg_catalog as $$select app_private.fonciere_arbitrage_read(p_project);$$;
create function public.fonciere_arbitrage_vote(p_project uuid,p_fingerprint text,p_choice text,p_remark text default '') returns jsonb language sql security invoker set search_path=pg_catalog as $$select app_private.fonciere_arbitrage_vote(p_project,p_fingerprint,p_choice,p_remark);$$;
create function public.fonciere_arbitrage_list() returns jsonb language sql security invoker set search_path=pg_catalog as $$select app_private.fonciere_arbitrage_list();$$;
create function public.fonciere_arbitrage_config() returns jsonb language sql security invoker set search_path=pg_catalog as $$select app_private.fonciere_arbitrage_config_read();$$;
create function public.fonciere_arbitrage_config_save(p_revision bigint,p_vincent uuid,p_ann_charlotte uuid) returns jsonb language sql security invoker set search_path=pg_catalog as $$select app_private.fonciere_arbitrage_config_save(p_revision,p_vincent,p_ann_charlotte);$$;
create function public.fonciere_bank_prepare(p_project uuid) returns jsonb language sql security invoker set search_path=pg_catalog as $$select app_private.fonciere_bank_prepare(p_project);$$;
create function public.fonciere_bank_finish(p_project uuid,p_token uuid,p_revision integer) returns jsonb language sql security invoker set search_path=pg_catalog as $$select app_private.fonciere_bank_finish(p_project,p_token,p_revision);$$;
create function public.fonciere_bank_fail(p_project uuid,p_token uuid,p_reason text) returns jsonb language sql security invoker set search_path=pg_catalog as $$select app_private.fonciere_bank_fail(p_project,p_token,p_reason);$$;

-- Internal helpers stay uncallable by API roles. Only guarded entry points can
-- see private data; wrappers preserve the repository's existing invoker pattern.
do $$ declare f regprocedure; begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','app_private') and p.proname=any(array['fonciere_dossier','fonciere_dossier_fingerprint','track_fonciere_dossier_version','fonciere_arbitrage_status',
   'fonciere_arbitrage_read','fonciere_arbitrage_vote','fonciere_arbitrage_list','fonciere_arbitrage_config_read','fonciere_arbitrage_config',
   'fonciere_arbitrage_config_save','fonciere_bank_prepare','fonciere_bank_finish','fonciere_bank_fail']) loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  if f::text !~ '(fonciere_dossier|track_fonciere_dossier_version|fonciere_arbitrage_status)' then execute format('grant execute on function %s to authenticated',f); end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
