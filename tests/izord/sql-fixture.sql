-- Disposable PostgreSQL ONLY. Minimal historical/Auth/Storage schema facsimile.
-- This tests SQL semantics, NOT Auth JWT validation or the Storage HTTP service.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
grant usage on schema auth to anon,authenticated;
create table public.crm_workspace_state(workspace_id text primary key default 'oneaddress-riviera',payload jsonb not null,updated_by uuid,updated_at timestamptz default now());
alter table public.crm_workspace_state enable row level security;
create policy workspace_select on public.crm_workspace_state for select to authenticated using(workspace_id='oneaddress-riviera');
create policy workspace_insert on public.crm_workspace_state for insert to authenticated with check(workspace_id='oneaddress-riviera');
create policy workspace_update on public.crm_workspace_state for update to authenticated using(workspace_id='oneaddress-riviera') with check(workspace_id='oneaddress-riviera');
insert into public.crm_workspace_state(payload) values('{"fixture":"unchanged"}');
do $$ declare t text; begin
 foreach t in array array['crm_leads','crm_tasks','crm_properties','crm_vehicles','crm_boats','crm_quotes','crm_contacts','crm_backups'] loop
 execute format('create table public.%I(id uuid primary key default gen_random_uuid(),user_id uuid not null,payload jsonb default ''{}'')',t);
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy owner_access on public.%I for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid())',t);
 end loop;
end $$;
-- Columns exercised by the historical cloud-backup UI (still fictional data only).
alter table public.crm_backups
 add column contacts_count integer,
 add column leads_count integer,
 add column properties_count integer,
 add column vehicles_count integer,
 add column boats_count integer,
 add column tasks_count integer,
 add column quotes_count integer;
grant all on all tables in schema public to anon,authenticated;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,version text default gen_random_uuid()::text,metadata jsonb default '{"size":1}',unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated;
grant select,insert,update,delete on storage.objects to authenticated;
create policy crm_docs on storage.objects for all to authenticated using(bucket_id='crm-documents') with check(bucket_id='crm-documents');
insert into storage.buckets(id,name,public) values('crm-documents','crm-documents',false);
insert into storage.objects(bucket_id,name) values('crm-documents','fictional.pdf');
