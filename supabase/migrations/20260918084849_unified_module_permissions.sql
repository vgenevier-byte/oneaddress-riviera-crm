-- Additive boundary; no automatic general administrator and no OAR broadening.
begin;
create table public.crm_access_profiles (
 user_id uuid primary key references auth.users(id), active boolean not null default true,
 general_admin boolean not null default false, revision bigint not null default 1,
 updated_at timestamptz not null default clock_timestamp()
);
create table public.crm_module_grants (
 user_id uuid not null references public.crm_access_profiles(user_id),
 module text not null check(module in ('dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','izord')),
 level text not null check(level in ('none','read','contribute')), sensitive jsonb not null default '{}', primary key(user_id,module),
 check(jsonb_typeof(sensitive)='object' and sensitive - array['delete','export','bank_read','bank_write','payment'] = '{}'::jsonb)
);
create table public.crm_permission_events (
 id bigint generated always as identity primary key, actor_id uuid not null, subject_id uuid,
 action text not null, detail jsonb not null default '{}', created_at timestamptz not null default clock_timestamp()
);
create table app_private.module_collections(collection text primary key,module text not null,fields jsonb not null);
create table public.crm_document_scopes (
 provider text not null check(provider in ('storage','google-drive')), resource_id text not null,
 module text not null, collection text not null, record_id text not null,
 folder text not null default 'Documents',
 superseded_by text, title text not null, bank boolean not null default false, primary key(provider,resource_id),
 foreign key(collection) references app_private.module_collections(collection)
);
create table public.crm_access_invitations (
 id uuid primary key default gen_random_uuid(), email text not null, token_hash bytea not null unique,
 grants jsonb not null, izord_role text, assignments uuid[] not null default '{}', created_by uuid not null references auth.users(id),
 expires_at timestamptz not null default clock_timestamp()+interval '48 hours', accepted_at timestamptz, revoked_at timestamptz
);
do $$ declare t text; begin
 foreach t in array array['crm_access_profiles','crm_module_grants','crm_permission_events','crm_document_scopes','crm_access_invitations'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;
-- Preserve only the existing IZORD ceiling; never change a role or assignment.
insert into public.crm_access_profiles(user_id) select user_id from public.app_memberships group by user_id;
insert into public.crm_module_grants(user_id,module,level,sensitive)
 select user_id,'izord',case when role='reader' then 'read' else 'contribute' end,
 jsonb_build_object('export',true,'delete',role in ('admin','partner'))
 from public.app_memberships where workspace_id='izord' and status='active';

create function app_private.module_allowed(p_module text,p_write boolean default false,p_sensitive text default null) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select auth.uid() is not null and exists(select 1 from public.crm_access_profiles p
 join public.crm_module_grants g using(user_id) join public.app_memberships m using(user_id)
 where p.user_id=auth.uid() and p.active and g.module=p_module
 and g.level=any(case when p_write then array['contribute'] else array['read','contribute'] end)
 and m.workspace_id=case when p_module='izord' then 'izord' else 'oar' end and m.status='active'
 and (p_sensitive is null or g.sensitive->p_sensitive='true'::jsonb));
$$;
create function app_private.general_admin() returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select auth.uid() is not null and exists(select 1 from public.crm_access_profiles where user_id=auth.uid() and active and general_admin);
$$;
create function app_private.full_access() returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.general_admin() and not exists(select 1 from unnest(array['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats']) m where not app_private.module_allowed(m,true))
 and app_private.module_allowed('documents',true,'export') and app_private.module_allowed('contacts',true,'bank_read')
 and app_private.module_allowed('contacts',true,'bank_write') and app_private.module_allowed('vendorInvoices',true,'payment')
 and not exists(select 1 from public.crm_module_grants where user_id=auth.uid() and module<>'izord' and (sensitive->'delete' is distinct from 'true'::jsonb or sensitive->'export' is distinct from 'true'::jsonb));
$$;
-- Existing raw payload/history/backup paths are reserved to the explicitly complete profile.
do $$ declare t text; begin
 foreach t in array array['crm_leads','crm_tasks','crm_properties','crm_vehicles','crm_boats','crm_quotes','crm_contacts','crm_backups','crm_workspace_state','crm_drive_folder_registry'] loop
 execute format('create policy unified_full_boundary on public.%I as restrictive for all to authenticated using(app_private.full_access()) with check(app_private.full_access())',t);
 end loop;
end $$;
-- Historical security-definer registry functions also check has_membership('oar').
-- Keep membership SELECT intact, but narrow the old global authority to full access.
create or replace function app_private.has_membership(p_space text,p_roles text[] default null) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select case when p_space='oar' then app_private.full_access()
 else app_private.module_allowed('izord') end
 and exists(select 1 from public.app_memberships m where m.user_id=auth.uid() and m.workspace_id=p_space and m.status='active' and (p_roles is null or m.role=any(p_roles)));
$$;
create function public.crm_access_snapshot() returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('revision',coalesce(p.revision,0),'active',coalesce(p.active,false),
 'generalAdmin',app_private.general_admin(),'fullAccess',app_private.full_access(),'modules',coalesce((select jsonb_object_agg(g.module,jsonb_build_object('level',g.level,'sensitive',g.sensitive)) from public.crm_module_grants g where g.user_id=auth.uid() and app_private.module_allowed(g.module)),'{}'::jsonb))
 from (select 1) dummy left join public.crm_access_profiles p on p.user_id=auth.uid();
$$;
insert into app_private.module_collections values ('contacts','contacts','{"name": {"type": "string", "label": "Nom"}, "firstName": {"type": "string", "label": "Prénom"}, "companyName": {"type": "string", "label": "Entreprise"}, "kind": {"type": "string", "label": "Type de contact", "enum": ["Client", "Propriétaire", "Prestataire"]}, "email": {"type": "string", "label": "Email"}, "phone": {"type": "string", "label": "Téléphone"}, "city": {"type": "string", "label": "Ville"}, "postalAddress": {"type": "string", "label": "Adresse postale"}, "supplierCategory": {"type": "string", "label": "Catégorie prestataire"}, "supplierStatus": {"type": "string", "label": "État prestataire", "enum": ["", "Actif", "À vérifier", "Inactif"]}, "preferredLanguage": {"type": "string", "label": "Langue préférée", "enum": ["Français", "Anglais", "Italien", "Autre"]}, "budget": {"type": "number", "label": "Budget"}, "civility": {"type": "string", "label": "civility", "enum": ["", "M", "MME"]}, "source": {"type": "string", "label": "source"}, "clientLevel": {"type": "string", "label": "clientLevel", "enum": ["Standard", "VIP", "Ultra VIP"]}, "relationshipStatus": {"type": "string", "label": "relationshipStatus", "enum": ["Prospect", "Actif", "Dormant", "Prestataire"]}, "supplierContactName": {"type": "string", "label": "supplierContactName"}, "supplierZone": {"type": "string", "label": "supplierZone"}, "supplierQuality": {"type": "string", "label": "supplierQuality", "enum": ["Standard", "Premium", "Très premium"]}, "supplierReliability": {"type": "string", "label": "supplierReliability", "enum": ["", "À tester", "Fiable", "Très fiable", "À éviter"]}}'::jsonb);
insert into app_private.module_collections values ('leads','leads','{"category": {"type": "string", "label": "Catégorie", "enum": ["Villa", "Voiture", "Bateau", "Conciergerie"]}, "status": {"type": "string", "label": "Statut", "enum": ["Nouveau", "Contacté", "Devis", "Négociation", "Gagné", "Perdu"]}, "priority": {"type": "string", "label": "Priorité", "enum": ["Basse", "Moyenne", "Haute"]}, "nextAction": {"type": "string", "label": "Prochaine action"}, "dueDate": {"type": "string", "label": "Échéance", "date": true}, "rentalStartDate": {"type": "string", "label": "Début de location", "date": true}, "rentalEndDate": {"type": "string", "label": "Fin de location", "date": true}, "value": {"type": "number", "label": "Valeur"}, "contactName": {"type": "string", "label": "contactName", "requires": "contacts"}, "assetType": {"type": "string", "label": "assetType"}, "assetId": {"type": "string", "label": "assetId"}}'::jsonb);
insert into app_private.module_collections values ('properties','properties','{"name": {"type": "string", "label": "Nom"}, "city": {"type": "string", "label": "Ville"}, "type": {"type": "string", "label": "Type"}, "status": {"type": "string", "label": "Statut", "enum": ["Disponible", "Mandat en cours", "Loué", "Vendu"]}, "price": {"type": "number", "label": "Prix"}, "bedrooms": {"type": "number", "label": "Chambres"}, "surface": {"type": "number", "label": "Surface"}, "owner": {"type": "string", "label": "owner", "requires": "contacts"}}'::jsonb);
insert into app_private.module_collections values ('vehicles','vehicles','{"name": {"type": "string", "label": "Nom"}, "brand": {"type": "string", "label": "Marque"}, "model": {"type": "string", "label": "Modèle"}, "city": {"type": "string", "label": "Ville"}, "status": {"type": "string", "label": "Statut", "enum": ["Disponible", "En location", "En maintenance", "Vendu"]}, "price": {"type": "number", "label": "Prix"}, "year": {"type": "number", "label": "Année"}, "mileage": {"type": "number", "label": "Kilométrage"}, "owner": {"type": "string", "label": "owner", "requires": "contacts"}}'::jsonb);
insert into app_private.module_collections values ('boats','boats','{"name": {"type": "string", "label": "Nom"}, "port": {"type": "string", "label": "Port"}, "type": {"type": "string", "label": "Type"}, "status": {"type": "string", "label": "Statut", "enum": ["Disponible", "En charter", "En maintenance", "Vendu"]}, "price": {"type": "number", "label": "Prix"}, "year": {"type": "number", "label": "Année"}, "length": {"type": "number", "label": "Longueur"}, "owner": {"type": "string", "label": "owner", "requires": "contacts"}}'::jsonb);
insert into app_private.module_collections values ('tasks','tasks','{"title": {"type": "string", "label": "Titre"}, "status": {"type": "string", "label": "Statut", "enum": ["À faire", "En cours", "Terminé"]}, "dueDate": {"type": "string", "label": "Échéance", "date": true}, "owner": {"type": "string", "label": "owner"}, "linkedTo": {"type": "string", "label": "linkedTo", "requires": "leads"}}'::jsonb);
insert into app_private.module_collections values ('planningEntries','planning','{"title": {"type": "string", "label": "Titre"}, "type": {"type": "string", "label": "Type", "enum": ["Réservation", "Intervention prestataire", "Maintenance", "Tâche interne", "Autre"]}, "planningCategory": {"type": "string", "label": "Catégorie planning", "enum": ["Villa", "Bateau", "Voiture", "Conciergerie"]}, "status": {"type": "string", "label": "Statut", "enum": ["Prévu", "À confirmer", "En cours", "Terminé", "Annulé"]}, "priority": {"type": "string", "label": "Priorité", "enum": ["Normal", "Important", "Critique"]}, "startDate": {"type": "string", "label": "Date de début", "date": true}, "startTime": {"type": "string", "label": "Début"}, "endDate": {"type": "string", "label": "Date de fin", "date": true}, "endTime": {"type": "string", "label": "Fin"}, "contactName": {"type": "string", "label": "contactName", "requires": "contacts"}, "assetType": {"type": "string", "label": "assetType"}, "assetId": {"type": "string", "label": "assetId"}, "blocksAvailability": {"type": "boolean", "label": "blocksAvailability"}}'::jsonb);
insert into app_private.module_collections values ('quotes','quotes','{"title": {"type": "string", "label": "Titre"}, "clientName": {"type": "string", "label": "Nom du client", "requires": "contacts"}, "requestDate": {"type": "string", "label": "Date de demande", "date": true}, "startDate": {"type": "string", "label": "Date de début", "date": true}, "endDate": {"type": "string", "label": "Date de fin", "date": true}, "leadId": {"type": "string", "label": "leadId", "requires": "leads"}, "location": {"type": "string", "label": "location"}, "guestCount": {"type": "string", "label": "guestCount"}, "categories": {"type": "array", "label": "categories"}, "items": {"type": "array", "label": "items"}, "unitPrice": {"type": "number", "label": "unitPrice"}, "validityDate": {"type": "string", "label": "validityDate", "date": true}, "paymentTerms": {"type": "string", "label": "paymentTerms"}, "cancellationTerms": {"type": "string", "label": "cancellationTerms"}, "included": {"type": "string", "label": "included"}, "excluded": {"type": "string", "label": "excluded"}, "status": {"type": "string", "label": "status", "enum": ["Draft", "Sent", "Negotiation", "Accepted", "Declined"]}, "supplierCost": {"type": "number", "label": "supplierCost"}, "depositReceived": {"type": "number", "label": "depositReceived"}, "balanceReceived": {"type": "number", "label": "balanceReceived"}, "paymentStatus": {"type": "string", "label": "paymentStatus", "enum": ["Non payé", "Acompte reçu", "Partiel", "Payé", "Annulé / remboursé"]}, "expectedDeposit": {"type": "number", "label": "expectedDeposit"}, "paymentDueDate": {"type": "string", "label": "paymentDueDate", "date": true}, "bookingStatus": {"type": "string", "label": "bookingStatus", "enum": ["À préparer", "Prestataire à confirmer", "Confirmé", "En cours", "Terminé", "Annulé"]}, "clientConfirmed": {"type": "boolean", "label": "clientConfirmed"}, "depositConfirmed": {"type": "boolean", "label": "depositConfirmed"}, "supplierConfirmed": {"type": "boolean", "label": "supplierConfirmed"}, "balanceConfirmed": {"type": "boolean", "label": "balanceConfirmed"}, "detailsSent": {"type": "boolean", "label": "detailsSent"}, "serviceCompleted": {"type": "boolean", "label": "serviceCompleted"}, "assignedContactId": {"type": "string", "label": "assignedContactId", "requires": "contacts"}}'::jsonb);
insert into app_private.module_collections values ('vendorQuotes','vendorQuotes','{"title": {"type": "string", "label": "Titre"}, "category": {"type": "string", "label": "Catégorie"}, "quoteReference": {"type": "string", "label": "Référence du devis"}, "quoteDate": {"type": "string", "label": "Date du devis", "date": true}, "validUntil": {"type": "string", "label": "Valable jusqu’au"}, "amount": {"type": "number", "label": "Montant"}, "contactId": {"type": "string", "label": "contactId", "requires": "contacts"}, "contactName": {"type": "string", "label": "contactName", "requires": "contacts"}, "contactPersonName": {"type": "string", "label": "contactPersonName", "requires": "contacts"}, "quoteDocumentStoragePath": {"type": "string", "label": "quoteDocumentStoragePath", "requires": "documents"}, "quoteDocumentName": {"type": "string", "label": "quoteDocumentName", "requires": "documents"}}'::jsonb);
insert into app_private.module_collections values ('vendorInvoices','vendorInvoices','{"title": {"type": "string", "label": "Titre"}, "category": {"type": "string", "label": "Catégorie"}, "invoiceReference": {"type": "string", "label": "Référence de facture"}, "invoiceDate": {"type": "string", "label": "Date de facture", "date": true}, "dueDate": {"type": "string", "label": "Échéance", "date": true}, "amount": {"type": "number", "label": "Montant"}, "contactId": {"type": "string", "label": "contactId", "requires": "contacts"}, "contactName": {"type": "string", "label": "contactName", "requires": "contacts"}, "contactPersonName": {"type": "string", "label": "contactPersonName", "requires": "contacts"}, "paidAmount": {"type": "number", "label": "paidAmount", "writeSensitive": "payment"}, "paymentMethod": {"type": "string", "label": "paymentMethod", "writeSensitive": "payment"}, "invoiceDocumentStoragePath": {"type": "string", "label": "invoiceDocumentStoragePath", "requires": "documents"}, "invoiceDocumentName": {"type": "string", "label": "invoiceDocumentName", "requires": "documents"}}'::jsonb);
insert into app_private.module_collections values ('houseTrackingHouses','houseTracking','{"name": {"type": "string", "label": "Nom"}, "address": {"type": "string", "label": "Adresse"}}'::jsonb);
insert into app_private.module_collections values ('houseTrackingWorkers','houseTracking','{"contactName": {"type": "string", "label": "Nom de l’intervenant"}, "role": {"type": "string", "label": "Fonction"}, "status": {"type": "string", "label": "Statut", "enum": ["Actif", "Inactif"]}, "hourlyRate": {"type": "number", "label": "Taux horaire"}, "contactId": {"type": "string", "label": "contactId", "requires": "contacts"}, "documentStoragePath": {"type": "string", "label": "documentStoragePath", "requires": "documents"}, "documentFileName": {"type": "string", "label": "documentFileName", "requires": "documents"}}'::jsonb);
insert into app_private.module_collections values ('houseTimeEntries','houseTracking','{"houseId": {"type": "string", "label": "Maison"}, "workerId": {"type": "string", "label": "Intervenant"}, "date": {"type": "string", "label": "Date", "date": true}, "startTime": {"type": "string", "label": "Début"}, "endTime": {"type": "string", "label": "Fin"}, "note": {"type": "string", "label": "Note"}, "breakMinutes": {"type": "number", "label": "Pause (minutes)"}, "hourlyRate": {"type": "number", "label": "Taux horaire"}, "houseName": {"type": "string", "label": "houseName"}, "workerName": {"type": "string", "label": "workerName"}}'::jsonb);
insert into app_private.module_collections values ('housePayments','houseTracking','{"houseId": {"type": "string", "label": "Maison"}, "workerId": {"type": "string", "label": "Intervenant"}, "date": {"type": "string", "label": "Date", "date": true}, "method": {"type": "string", "label": "Mode de règlement"}, "note": {"type": "string", "label": "Note"}, "amount": {"type": "number", "label": "Montant"}, "houseName": {"type": "string", "label": "houseName"}, "workerName": {"type": "string", "label": "workerName"}}'::jsonb);
create function app_private.project_record(p_collection text,p_row jsonb) returns jsonb
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
 return v;
end $$;

create function app_private.document_allowed(p_provider text,p_resource text,p_write boolean default false,p_download boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.full_access() or exists(select 1 from public.crm_document_scopes d
 join public.crm_workspace_state w on w.workspace_id='oneaddress-riviera'
 where d.provider=p_provider and d.resource_id=p_resource
 and app_private.module_allowed('documents',p_write,case when p_download then 'export' end)
 and app_private.module_allowed(d.module,p_write,case when p_download then 'export' end)
 and (not d.bank or app_private.module_allowed('contacts',p_write,case when p_write then 'bank_write' else 'bank_read' end))
 and exists(select 1 from jsonb_array_elements(coalesce(w.payload->d.collection,'[]')) r where r->>'id'=d.record_id));
$$;
create policy unified_storage_read on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'crm-documents' or app_private.document_allowed('storage',name,false,true));
create policy unified_storage_insert on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'crm-documents' or app_private.document_allowed('storage',name,true));
create policy unified_storage_update on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'crm-documents' or app_private.full_access()) with check(bucket_id<>'crm-documents' or app_private.full_access());
create policy unified_storage_delete on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'crm-documents' or app_private.full_access());
-- Replace the old OAR global storage predicate, otherwise it would block scoped classified files too.
alter policy oar_documents_membership_required on storage.objects using(bucket_id<>'crm-documents' or app_private.module_allowed('documents')) with check(bucket_id<>'crm-documents' or app_private.module_allowed('documents',true));

create function public.crm_read_module(p_module text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare w jsonb; result jsonb:='{}'; c record; rows jsonb;
begin
 if not app_private.module_allowed(p_module) then raise exception 'module_forbidden' using errcode='42501'; end if;
 select payload into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera';
 if p_module='dashboard' then
  for c in select * from app_private.module_collections where app_private.module_allowed(module) loop
   result:=result||jsonb_build_object(c.collection,jsonb_array_length(coalesce(w->c.collection,'[]')));
  end loop;
 elsif p_module='documents' then
  select coalesce(jsonb_agg(jsonb_build_object('provider',provider,'resource_id',resource_id,'title',title,'module',module,'bank',bank,'folder',folder,'collection',collection,'record_id',record_id,'superseded_by',superseded_by,'replaceable',provider='storage' and app_private.document_replaceable(resource_id),'deletable',provider='storage' and app_private.document_deletable(resource_id))),'[]') into rows from public.crm_document_scopes where app_private.document_allowed(provider,resource_id);
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
create function app_private.module_revision(p_module text,p_payload jsonb) returns text
language sql stable security definer set search_path=pg_catalog as $$
 select md5(coalesce((select jsonb_object_agg(collection,p_payload->collection) from app_private.module_collections where module=p_module or (p_module='bookings' and collection='quotes')),'{}')::text);
$$;

create function public.crm_mutate_record(p_module text,p_collection text,p_id text,p_patch jsonb,p_revision text,p_delete boolean default false) returns jsonb
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
  if p_collection='contacts' and p_patch?'kind' then newrow:=newrow||jsonb_build_object('relationshipStatus',case when p_patch->>'kind'='Prestataire' then 'Prestataire' when oldrow->>'relationshipStatus'='Prestataire' then 'Prospect' else coalesce(newrow->>'relationshipStatus','Prospect') end); if p_patch->>'kind'<>'Prestataire' then newrow:=newrow||'{"supplierCategory":""}'; end if; end if;
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

create function app_private.validate_grants(p_grants jsonb) returns void language plpgsql set search_path=pg_catalog as $$
declare g record; s record;
begin
 if p_grants is null or jsonb_typeof(p_grants)<>'object' then raise exception 'invalid_grants'; end if;
 for g in select * from jsonb_each(p_grants) loop
 if g.key<>all(array['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','izord'])
 or jsonb_typeof(g.value)<>'object' or g.value-array['level','sensitive']<>'{}' or g.value->>'level' not in ('none','read','contribute') or not(g.value?'level') or jsonb_typeof(coalesce(g.value->'sensitive','{}'))<>'object' then raise exception 'invalid_grants'; end if;
 for s in select * from jsonb_each(coalesce(g.value->'sensitive','{}')) loop
 if s.key<>all(array['delete','export','bank_read','bank_write','payment']) or jsonb_typeof(s.value)<>'boolean' then raise exception 'invalid_sensitive'; end if;
 if s.value='true' then
 if g.value->>'level'='none' or (s.key in ('delete','bank_write','payment') and g.value->>'level'<>'contribute') or (s.key in ('bank_read','bank_write') and g.key<>'contacts') or (s.key='payment' and g.key<>'vendorInvoices') then raise exception 'sensitive_prerequisite'; end if;
 if s.key='bank_write' and g.value->'sensitive'->'bank_read' is distinct from 'true'::jsonb then raise exception 'bank_read_required'; end if;
 if s.key='payment' and (p_grants->'contacts'->'sensitive'->'bank_read' is distinct from 'true'::jsonb or p_grants->'contacts'->>'level' not in ('read','contribute')) then raise exception 'bank_read_required'; end if;
 end if;
 end loop;
 end loop;
end $$;

create function public.crm_admin_users() returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not app_private.general_admin() then raise exception 'general_admin_required' using errcode='42501'; end if;
 return jsonb_build_object('users',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'confirmed',u.email_confirmed_at is not null,'active',coalesce(p.active,false),'generalAdmin',coalesce(p.general_admin,false),'revision',coalesce(p.revision,0),
 'modules',coalesce((select jsonb_object_agg(module,jsonb_build_object('level',level,'sensitive',sensitive)) from public.crm_module_grants where user_id=u.id),'{}'),
 'izordRole',(select role from public.app_memberships where user_id=u.id and workspace_id='izord' and status='active'),
 'assignments',coalesce((select jsonb_agg(project_id) from public.izord_project_assignments where user_id=u.id),'[]'))) ,'[]') from auth.users u left join public.crm_access_profiles p on p.user_id=u.id),
 'projects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title)),'[]') from public.izord_projects),
 'invitations',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'expires_at',i.expires_at,'created_by',i.created_by)),'[]') from public.crm_access_invitations i where i.accepted_at is null and i.revoked_at is null and i.expires_at>clock_timestamp()),
 'history',(select coalesce(jsonb_agg(e),'[]') from (select * from public.crm_permission_events order by id desc limit 100) e));
end $$;

create function public.crm_admin_save(p_user uuid,p_revision bigint,p_active boolean,p_general_admin boolean,p_grants jsonb,p_izord_role text,p_assignments uuid[]) returns bigint
language plpgsql security definer set search_path=pg_catalog as $$
declare actual bigint; next_revision bigint; before_state jsonb;
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.general_admin() then raise exception 'general_admin_required' using errcode='42501'; end if;
 perform app_private.validate_grants(p_grants);
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) then raise exception 'verified_recipient_required'; end if;
 select revision,to_jsonb(p) into actual,before_state from public.crm_access_profiles p where user_id=p_user for update;
 if p_revision is null or p_user is null or p_active is null or p_general_admin is null or p_assignments is null then raise exception 'invalid_access_parameters' using errcode='22023'; end if;
 if coalesce(actual,0) is distinct from p_revision then raise exception 'access_revision_conflict' using errcode='40001'; end if;
 if (not p_active or not p_general_admin) and exists(select 1 from public.crm_access_profiles where user_id=p_user and active and general_admin) and not exists(select 1 from public.crm_access_profiles where user_id<>p_user and active and general_admin) then raise exception 'last_general_admin'; end if;
 if p_izord_role is not null and p_izord_role not in ('admin','partner','contributor','reader') then raise exception 'invalid_izord_role'; end if;
 if coalesce(p_grants->'izord'->>'level','none')<>'none' and p_izord_role is null then raise exception 'izord_role_required'; end if;
 if exists(select 1 from unnest(p_assignments) a where not exists(select 1 from public.izord_projects project where project.id=a)) then raise exception 'unknown_project'; end if;
 insert into public.crm_access_profiles(user_id,active,general_admin) values(p_user,p_active,p_general_admin)
 on conflict(user_id) do update set active=excluded.active,general_admin=excluded.general_admin,revision=crm_access_profiles.revision+1,updated_at=clock_timestamp() returning revision into next_revision;
 delete from public.crm_module_grants where user_id=p_user;
 insert into public.crm_module_grants select p_user,key,value->>'level',coalesce(value->'sensitive','{}') from jsonb_each(p_grants);
 if exists(select 1 from jsonb_each(p_grants) g where g.key<>'izord' and g.value->>'level'<>'none') then
 insert into public.app_memberships(user_id,workspace_id,role) values(p_user,'oar','member') on conflict(user_id,workspace_id) do update set status='active',updated_at=clock_timestamp(); end if;
 -- Revocation lives in the profile: do not destroy historical IZORD role or assignments.
 if p_izord_role is not null then
 insert into public.app_memberships(user_id,workspace_id,role) values(p_user,'izord',p_izord_role) on conflict(user_id,workspace_id) do update set role=excluded.role,status='active',updated_at=clock_timestamp();
 end if;
 delete from public.izord_project_assignments where user_id=p_user and not(project_id=any(coalesce(p_assignments,'{}')));
 insert into public.izord_project_assignments select distinct x,p_user from unnest(p_assignments) x on conflict do nothing;
 insert into public.crm_permission_events(actor_id,subject_id,action,detail) values(auth.uid(),p_user,'access_saved',jsonb_build_object('previousRevision',coalesce(actual,0),'revision',next_revision,'active',p_active,'generalAdmin',p_general_admin,'grants',p_grants,'izordRole',p_izord_role,'assignments',p_assignments));
 return next_revision;
end $$;

create function public.crm_invite_prepare(p_email text,p_grants jsonb,p_izord_role text default null,p_assignments uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare token text:=gen_random_uuid()::text||gen_random_uuid()::text; id uuid;
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.general_admin() then raise exception 'general_admin_required' using errcode='42501'; end if;
 perform app_private.validate_grants(p_grants);
 if p_email is null or length(p_email)>254 or p_email !~ '^[^ @]+@[^ @]+\.[^ @]+$' then raise exception 'invalid_email'; end if;
 if coalesce(p_grants->'izord'->>'level','none')<>'none' and (p_izord_role is null or p_izord_role not in ('reader','contributor','partner','admin')) then raise exception 'izord_role_required'; end if;
 if exists(select 1 from unnest(p_assignments) a where not exists(select 1 from public.izord_projects project where project.id=a)) then raise exception 'unknown_project'; end if;
 update public.crm_access_invitations set revoked_at=clock_timestamp() where email=lower(btrim(p_email)) and accepted_at is null and revoked_at is null;
 insert into public.crm_access_invitations(email,token_hash,grants,izord_role,assignments,created_by) values(lower(btrim(p_email)),sha256(convert_to(token,'UTF8')),p_grants,p_izord_role,p_assignments,auth.uid()) returning crm_access_invitations.id into id;
 insert into public.crm_permission_events(actor_id,subject_id,action) values(auth.uid(),id,'invitation_prepared');
 -- Auth existence and password initialization are separate: a previous invite
 -- can already have created the account without completing its onboarding.
 -- Only this boolean leaves Auth; never expose a password hash or trust metadata.
 return jsonb_build_object('id',id,'token',token,
  'existingUser',exists(select 1 from auth.users u where lower(u.email)=lower(btrim(p_email))),
  'needsPasswordSetup',not exists(select 1 from auth.users u where lower(u.email)=lower(btrim(p_email)) and coalesce(u.encrypted_password,'')<>''));
end $$;
create function public.crm_invite_accept(p_token text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare i public.crm_access_invitations%rowtype; email text;
begin
 perform pg_advisory_xact_lock(734991);
 select lower(u.email) into email from auth.users u where id=auth.uid() and email_confirmed_at is not null;
 select * into i from public.crm_access_invitations where token_hash=sha256(convert_to(p_token,'UTF8')) for update;
 if not found or email is null or i.email<>email or i.expires_at<=clock_timestamp() or i.revoked_at is not null or i.accepted_at is not null
 or not exists(select 1 from public.crm_access_profiles where user_id=i.created_by and active and general_admin) then raise exception 'invalid_invitation' using errcode='42501'; end if;
 if exists(select 1 from public.crm_module_grants where user_id=auth.uid() and level<>'none') then raise exception 'existing_access_requires_admin_review'; end if;
 if exists(select 1 from public.crm_access_profiles where user_id=auth.uid() and general_admin) then raise exception 'existing_admin_requires_review' using errcode='42501'; end if;
 if i.izord_role is not null and exists(select 1 from public.app_memberships m where m.user_id=auth.uid() and m.workspace_id='izord' and (m.role<>i.izord_role or m.status<>'active' or exists(select 1 from unnest(i.assignments) a where not exists(select 1 from public.izord_project_assignments x where x.user_id=auth.uid() and x.project_id=a)))) then raise exception 'existing_izord_requires_review' using errcode='42501'; end if;
 perform app_private.validate_grants(i.grants);
 insert into public.crm_access_profiles(user_id) values(auth.uid()) on conflict(user_id) do update set active=true,general_admin=false,revision=crm_access_profiles.revision+1;
 delete from public.crm_module_grants where user_id=auth.uid();
 insert into public.crm_module_grants select auth.uid(),key,value->>'level',coalesce(value->'sensitive','{}') from jsonb_each(i.grants);
 if exists(select 1 from jsonb_each(i.grants) g where g.key<>'izord' and g.value->>'level'<>'none') then
 insert into public.app_memberships(user_id,workspace_id,role) values(auth.uid(),'oar','member') on conflict(user_id,workspace_id) do update set status='active'; end if;
 if i.izord_role is not null then
 -- Do not replace an existing role through invitation acceptance.
 insert into public.app_memberships(user_id,workspace_id,role) values(auth.uid(),'izord',i.izord_role) on conflict do nothing; end if;
 insert into public.izord_project_assignments select distinct x,auth.uid() from unnest(i.assignments) x where i.izord_role is not null on conflict do nothing;
 update public.crm_access_invitations set accepted_at=clock_timestamp() where id=i.id;
 insert into public.crm_permission_events(actor_id,subject_id,action) values(auth.uid(),i.id,'invitation_accepted');
end $$;
create function public.crm_invite_revoke(p_id uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.general_admin() then raise exception 'general_admin_required' using errcode='42501'; end if;
 update public.crm_access_invitations set revoked_at=clock_timestamp() where id=p_id and accepted_at is null and revoked_at is null;
 if not found then raise exception 'invitation_not_pending'; end if;
 insert into public.crm_permission_events(actor_id,subject_id,action) values(auth.uid(),p_id,'invitation_revoked');
end $$;

create function public.crm_classify_document(p_provider text,p_resource text,p_collection text,p_record text,p_title text,p_bank boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare m text;
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.general_admin() then raise exception 'general_admin_required' using errcode='42501'; end if;
 select module into m from app_private.module_collections where collection=p_collection;
 if m is null or p_resource is null or length(p_resource) not between 1 and 500 or length(p_title) not between 1 and 200 or not exists(select 1 from public.crm_workspace_state w cross join lateral jsonb_array_elements(coalesce(w.payload->p_collection,'[]')) r where w.workspace_id='oneaddress-riviera' and r->>'id'=p_record) then raise exception 'invalid_document_owner'; end if;
 if p_bank and p_collection<>'contacts' then raise exception 'bank_contact_required'; end if;
 insert into public.crm_document_scopes(provider,resource_id,module,collection,record_id,title,bank) values(p_provider,p_resource,m,p_collection,p_record,p_title,p_bank)
 on conflict(provider,resource_id) do update set module=excluded.module,collection=excluded.collection,record_id=excluded.record_id,title=excluded.title,bank=excluded.bank;
 insert into public.crm_permission_events(actor_id,action,detail) values(auth.uid(),'document_classified',jsonb_build_object('module',m,'bank',p_bank));
end $$;
create function public.crm_authorize_drive(p_resource text default null,p_write boolean default false,p_download boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select case when p_resource is null then app_private.full_access() else app_private.document_allowed('google-drive',p_resource,p_write,p_download) end;
$$;
create function public.crm_export_module(p_module text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not app_private.module_allowed(p_module,false,'export') then raise exception 'export_forbidden' using errcode='42501'; end if;
 return public.crm_read_module(p_module);
end $$;

-- IZORD module contribution never replaces the project role/assignment checks.
-- Also close presentation Storage reads when organized downloading is not granted.
create policy unified_izord_presentation_export on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'izord-documents' or app_private.module_allowed('izord',false,'export') or not exists(select 1 from public.izord_assets a where a.object_path=name and a.kind='presentation'));


-- Keep existing business functions, adding only the modular boundary.
create or replace function app_private.can_project(p_id uuid, p_write boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.module_allowed('izord',p_write) and app_private.has_membership('izord', case when p_write then array['admin','partner','contributor'] else null end)
 and exists (select 1 from public.izord_projects p where p.id=p_id and
   (app_private.has_membership('izord',array['admin','partner'])
    or (p.owner_id=auth.uid() and app_private.has_membership('izord',array['contributor']))
    or exists (select 1 from public.izord_project_assignments a where a.project_id=p.id and a.user_id=auth.uid())));
$$;
create or replace function app_private.create_project(p_title text) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare v_id uuid;
begin
 if not app_private.module_allowed('izord',true) then raise exception 'module_forbidden' using errcode='42501'; end if;
 if not app_private.has_membership('izord',array['admin','partner','contributor']) then raise exception 'forbidden' using errcode='42501'; end if;
 insert into public.izord_projects(owner_id,title) values(auth.uid(),btrim(p_title)) returning id into v_id;
 insert into public.izord_project_versions(project_id,revision,title,payload,status,author_id)
 select id,revision,title,payload,status,auth.uid() from public.izord_projects where id=v_id;
 return v_id;
end $$;
create or replace function app_private.save_project(p_id uuid,p_expected_revision integer,p_title text,p_payload jsonb,p_status text) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare p public.izord_projects%rowtype;
begin
 if not app_private.module_allowed('izord',true) then raise exception 'module_forbidden' using errcode='42501'; end if;
 if not app_private.can_project(p_id,true) then raise exception 'forbidden' using errcode='42501'; end if;
 select * into strict p from public.izord_projects where id=p_id for update;
 if p.revision is distinct from p_expected_revision then raise exception 'revision_conflict' using errcode='40001'; end if;
 if p_status is null or p_status not in ('draft','review','approved') then raise exception 'invalid_status' using errcode='22023'; end if;
 if (p_status='approved' or p.status='approved') and not app_private.has_membership('izord',array['admin','partner']) then raise exception 'approval_forbidden' using errcode='42501'; end if;
 update public.izord_projects set title=btrim(p_title),payload=p_payload,status=p_status,revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into p;
 insert into public.izord_project_versions(project_id,revision,title,payload,status,author_id) values(p.id,p.revision,p.title,p.payload,p.status,auth.uid());
 return p.revision;
end $$;
create or replace function app_private.register_asset(p_project uuid,p_revision integer,p_kind text) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare v_id uuid := gen_random_uuid(); v_path text;
begin
 if not app_private.module_allowed('izord',true) then raise exception 'module_forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(734991);
 perform 1 from public.izord_projects where id=p_project for update;
 if not app_private.can_document_write(p_project,p_revision) then raise exception 'forbidden_document_revision' using errcode='42501'; end if;
 v_path := p_project::text || '/' || v_id::text;
 insert into public.izord_assets(id,project_id,project_revision,kind,object_path,created_by) values(v_id,p_project,p_revision,p_kind,v_path,auth.uid());
 return v_path;
end $$;
create or replace function app_private.finalize_asset(p_asset uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare a public.izord_assets%rowtype; o record;
begin
 if not app_private.module_allowed('izord',true) then raise exception 'module_forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(734991);
 select * into a from public.izord_assets where id=p_asset;
 if not found then raise exception 'forbidden_document' using errcode='42501'; end if;
 perform 1 from public.izord_projects where id=a.project_id for update;
 -- Lock order: project then asset. The Storage trigger locks only the asset;
 -- reading the completed Storage row needs no second lock and cannot deadlock it.
 select * into a from public.izord_assets where id=p_asset for update;
 if a.lifecycle<>'pending' or not app_private.can_document_write(a.project_id,a.project_revision)
  or (a.created_by<>auth.uid() and not app_private.has_membership('izord',array['admin','partner'])) then
  raise exception 'forbidden_document_finalization' using errcode='42501'; end if;
 select id,version,metadata into o from storage.objects where bucket_id='izord-documents' and name=a.object_path;
 if not found or o.version is null or coalesce((o.metadata->>'size')::bigint,0)<=0 then
  raise exception 'document_upload_incomplete' using errcode='23514'; end if;
 update public.izord_assets set lifecycle='finalized',storage_object_id=o.id,storage_object_version=o.version,
  finalized_at=clock_timestamp(),finalized_by=auth.uid(),reader_download=false where id=a.id;
 insert into public.izord_access_events(actor_id,action,subject_id) values(auth.uid(),'finalize_document',a.id);
end $$;
create or replace function app_private.withdraw_asset(p_asset uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare a public.izord_assets%rowtype;
begin
 if not app_private.module_allowed('izord',true,'delete') then raise exception 'module_forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(734991);
 select * into a from public.izord_assets where id=p_asset for update;
 if not found or a.lifecycle='withdrawn' or not
  (app_private.has_membership('izord',array['admin','partner']) or
   (a.lifecycle='pending' and a.created_by=auth.uid() and app_private.can_document_write(a.project_id,a.project_revision))) then
  raise exception 'forbidden_document_withdrawal' using errcode='42501'; end if;
 update public.izord_assets set lifecycle='withdrawn',reader_download=false,withdrawn_at=clock_timestamp(),withdrawn_by=auth.uid() where id=a.id;
 insert into public.izord_access_events(actor_id,action,subject_id) values(auth.uid(),'withdraw_document',a.id);
end $$;
create or replace function app_private.allow_reader_download(p_asset uuid,p_allowed boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not app_private.module_allowed('izord',true) then raise exception 'module_forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(734991);
 if not app_private.has_membership('izord',array['admin','partner']) then raise exception 'forbidden' using errcode='42501'; end if;
 update public.izord_assets set reader_download=p_allowed where id=p_asset and kind='presentation' and lifecycle='finalized';
 if not found then raise exception 'invalid_or_unfinalized_asset'; end if;
 insert into public.izord_access_events(actor_id,action,subject_id) values(auth.uid(),case when p_allowed then 'allow_download' else 'deny_download' end,p_asset);
end $$;
create or replace function app_private.assign_project(p_project uuid,p_user uuid,p_assigned boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not app_private.module_allowed('izord',true) then raise exception 'module_forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(734991);
 if not app_private.has_membership('izord',array['admin']) then raise exception 'forbidden' using errcode='42501'; end if;
 if not exists(select 1 from public.app_memberships where user_id=p_user and workspace_id='izord' and status='active') then raise exception 'inactive_member'; end if;
 if p_assigned then insert into public.izord_project_assignments values(p_project,p_user) on conflict do nothing;
 else delete from public.izord_project_assignments where project_id=p_project and user_id=p_user; end if;
 insert into public.izord_access_events(actor_id,action,subject_id) values(auth.uid(),case when p_assigned then 'assign:' else 'unassign:' end || p_project::text,p_user);
end $$;
create or replace function app_private.set_izord_member(p_user uuid,p_role text,p_status text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not app_private.module_allowed('izord',true) then raise exception 'module_forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(734991);
 if not app_private.has_membership('izord',array['admin']) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_user=auth.uid() and (p_role is distinct from 'admin' or p_status is distinct from 'active') and
   not exists(select 1 from public.app_memberships where workspace_id='izord' and role='admin' and status='active' and user_id<>auth.uid()) then raise exception 'last_admin'; end if;
 -- No INSERT: only an accepted invitation/bootstrap creates a membership.
 update public.app_memberships set role=p_role,status=p_status,updated_at=clock_timestamp() where user_id=p_user and workspace_id='izord';
 if not found then raise exception 'membership_missing'; end if;
 if p_status='revoked' or p_role<>'admin' then
  update public.izord_invitations set revoked_at=clock_timestamp() where created_by=p_user and accepted_at is null and revoked_at is null;
 end if;
 if p_status='revoked' then delete from public.izord_project_assignments where user_id=p_user; end if;
 insert into public.izord_access_events(actor_id,action,subject_id) values(auth.uid(),'member:'||p_role||':'||p_status,p_user);
end $$;
create or replace function app_private.invite_izord(p_email text,p_role text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare v_token text := gen_random_uuid()::text || gen_random_uuid()::text; v_id uuid;
begin
 if not app_private.module_allowed('izord',true) then raise exception 'module_forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(734991);
 if not app_private.has_membership('izord',array['admin']) then raise exception 'forbidden' using errcode='42501'; end if;
 insert into public.izord_invitations(email,role,token_hash,created_by,expires_at)
 values(lower(btrim(p_email)),p_role,sha256(convert_to(v_token,'UTF8')),auth.uid(),clock_timestamp()+interval '48 hours') returning id into v_id;
 insert into public.izord_access_events(actor_id,action,subject_id) values(auth.uid(),'invite',v_id);
 return jsonb_build_object('id',v_id,'token',v_token);
end $$;
create or replace function app_private.revoke_invitation(p_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not app_private.module_allowed('izord',true) then raise exception 'module_forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(734991);
 if not app_private.has_membership('izord',array['admin']) then raise exception 'forbidden' using errcode='42501'; end if;
 update public.izord_invitations set revoked_at=clock_timestamp() where id=p_id and accepted_at is null and revoked_at is null;
 if not found then raise exception 'invitation_not_pending'; end if;
 insert into public.izord_access_events(actor_id,action,subject_id) values(auth.uid(),'revoke_invitation',p_id);
end $$;

-- Sensitive workflows are fixed operations, never arbitrary collection replacement.
create function app_private.valid_iban(p_value text) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare v text:=upper(regexp_replace(p_value,'\s','','g')); expanded text:=''; c text; sizes jsonb:='{"AD":24,"AE":23,"AL":28,"AT":20,"AZ":28,"BA":20,"BE":16,"BG":22,"BH":22,"BR":29,"BY":28,"CH":21,"CR":22,"CY":28,"CZ":24,"DE":22,"DK":18,"DO":28,"EE":20,"EG":29,"ES":24,"FI":18,"FO":18,"FR":27,"GB":22,"GE":22,"GI":23,"GL":18,"GR":27,"GT":28,"HR":21,"HU":28,"IE":22,"IL":23,"IQ":23,"IS":26,"IT":27,"JO":30,"KW":30,"KZ":20,"LB":28,"LC":32,"LI":21,"LT":20,"LU":20,"LV":21,"MC":27,"MD":24,"ME":22,"MK":19,"MR":27,"MT":31,"MU":30,"NL":18,"NO":15,"PK":24,"PL":28,"PS":29,"PT":25,"QA":29,"RO":24,"RS":22,"SA":24,"SC":31,"SE":24,"SI":19,"SK":24,"SM":27,"ST":25,"SV":28,"TL":23,"TN":24,"TR":26,"UA":29,"VA":22,"VG":24,"XK":20}';
begin
 if v is null or v !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]+$' or (sizes->>left(v,2)) is null or length(v)<>(sizes->>left(v,2))::int then return false; end if;
 for c in select regexp_split_to_table(substring(v,5)||left(v,4),'') loop expanded:=expanded||case when c~'[A-Z]' then (ascii(c)-55)::text else c end; end loop;
 return expanded::numeric%97=1;
end $$;
create function public.crm_bank_action(p_contact text,p_action text,p_account jsonb,p_revision text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare w jsonb; contact jsonb; accounts jsonb; a jsonb; updated jsonb; primary_exists boolean;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.module_allowed('contacts',true,'bank_write') or not app_private.module_allowed('contacts',false,'bank_read') then raise exception 'bank_write_forbidden' using errcode='42501'; end if;
 if p_action is null or p_account is null or p_action not in ('add','verify','primary','archive') or jsonb_typeof(p_account)<>'object' then raise exception 'invalid_bank_action'; end if;
 if p_action='add' and (p_account-array['accountHolder','iban','bic','bankName','label']<>'{}' or exists(select 1 from jsonb_each(p_account) where jsonb_typeof(value)<>'string' or length(value#>>'{}')>200)) then raise exception 'invalid_bank_fields'; end if;
 if p_action<>'add' and (p_account-array['id']<>'{}' or jsonb_typeof(p_account->'id')<>'string') then raise exception 'invalid_bank_fields'; end if;
 select payload into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
 if p_revision is distinct from app_private.module_revision('contacts',w) then raise exception 'revision_conflict' using errcode='40001'; end if;
 select r into contact from jsonb_array_elements(coalesce(w->'contacts','[]')) r where r->>'id'=p_contact;
 if contact is null then raise exception 'contact_missing'; end if;
 accounts:=coalesce(contact->'supplierBankAccounts','[]');
 if p_action='add' then
  a:=p_account||jsonb_build_object('id',gen_random_uuid(),'iban',upper(regexp_replace(p_account->>'iban','\s','','g')),'bic',upper(regexp_replace(p_account->>'bic','\s','','g')),'status','À vérifier','isPrimary',false,'createdBy',auth.uid(),'createdAt',clock_timestamp());
  if not app_private.valid_iban(a->>'iban') or coalesce(a->>'bic','')!~'^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$' or length(btrim(coalesce(a->>'accountHolder','')))=0 then raise exception 'invalid_bank_account'; end if;
  if exists(select 1 from jsonb_array_elements(accounts) r where r->>'status'<>'Archivé' and r->>'iban'=a->>'iban') then raise exception 'bank_account_exists'; end if;
  accounts:=accounts||jsonb_build_array(a);
 else
  select r into a from jsonb_array_elements(accounts) r where r->>'id'=p_account->>'id';
  if a is null then raise exception 'bank_account_missing'; end if;
  if p_action<>'archive' and (a->>'status'='Archivé' or not app_private.valid_iban(a->>'iban') or coalesce(a->>'bic','')!~'^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$') then raise exception 'invalid_bank_account'; end if;
  if p_action='primary' and a->>'status'<>'Vérifié' then raise exception 'verified_bank_required'; end if;
  primary_exists:=exists(select 1 from jsonb_array_elements(accounts) r where r->>'status'='Vérifié' and r->'isPrimary'='true');
  updated:=a||jsonb_build_object('status',case when p_action='archive' then 'Archivé' else 'Vérifié' end,'isPrimary',case when p_action='archive' then false else p_action='primary' or (p_action='verify' and not primary_exists) or a->'isPrimary'='true' end,'updatedBy',auth.uid(),'updatedAt',clock_timestamp());
  if p_action='verify' then updated:=updated||jsonb_build_object('verifiedBy',auth.uid(),'verifiedAt',clock_timestamp()); end if;
  select jsonb_agg(case when r->>'id'=a->>'id' then updated when updated->'isPrimary'='true' then r||'{"isPrimary":false}' else r end) into accounts from jsonb_array_elements(accounts) r;
 end if;
 contact:=contact||jsonb_build_object('supplierBankAccounts',accounts);
 update public.crm_workspace_state set payload=jsonb_set(w,'{contacts}',(select jsonb_agg(case when r->>'id'=p_contact then contact else r end) from jsonb_array_elements(w->'contacts')r)) where workspace_id='oneaddress-riviera';
 return public.crm_read_module('contacts');
end $$;

create function public.crm_prepare_payment(p_invoice text,p_account text,p_revision text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare w jsonb; invoice jsonb; bank jsonb;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.module_allowed('vendorInvoices',true,'payment') or not app_private.module_allowed('contacts',false,'bank_read') then raise exception 'payment_forbidden' using errcode='42501'; end if;
 select payload into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
 if p_revision is distinct from app_private.module_revision('vendorInvoices',w) then raise exception 'revision_conflict' using errcode='40001'; end if;
 select r into invoice from jsonb_array_elements(coalesce(w->'vendorInvoices','[]'))r where r->>'id'=p_invoice;
 select b into bank from jsonb_array_elements(coalesce(w->'contacts','[]'))c cross join lateral jsonb_array_elements(coalesce(c->'supplierBankAccounts','[]'))b where c->>'id'=invoice->>'contactId' and b->>'id'=p_account and b->>'status'='Vérifié';
 if invoice is null or bank is null or not app_private.valid_iban(bank->>'iban') then raise exception 'verified_bank_required'; end if;
 if coalesce((invoice->>'paidAmount')::numeric,0)>0 and coalesce(invoice->>'paymentBankAccountId','') not in ('',p_account) then raise exception 'paid_account_locked'; end if;
 invoice:=invoice||jsonb_build_object('paymentBankAccountId',p_account,'updatedBy',auth.uid(),'updatedAt',clock_timestamp());
 update public.crm_workspace_state set payload=jsonb_set(w,'{vendorInvoices}',(select jsonb_agg(case when r->>'id'=p_invoice then invoice else r end) from jsonb_array_elements(w->'vendorInvoices')r)) where workspace_id='oneaddress-riviera';
 return public.crm_read_module('vendorInvoices');
end $$;

create function public.crm_validate_vendor_quote(p_quote text,p_revision text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare w jsonb; q jsonb; invoice jsonb; invoices jsonb; linked text;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.module_allowed('vendorQuotes',true) or not app_private.module_allowed('vendorInvoices',true) then raise exception 'both_finance_modules_required' using errcode='42501'; end if;
 select payload into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
 if p_revision is distinct from app_private.module_revision('vendorQuotes',w) then raise exception 'revision_conflict' using errcode='40001'; end if;
 select r into q from jsonb_array_elements(coalesce(w->'vendorQuotes','[]'))r where r->>'id'=p_quote;
 if q is null then raise exception 'quote_missing'; end if;
 invoices:=coalesce(w->'vendorInvoices','[]');linked:=q->>'linkedInvoiceId';
 if coalesce(linked,'')<>'' then
 select r into invoice from jsonb_array_elements(invoices)r where r->>'id'=linked;
 if invoice is null then raise exception 'broken_explicit_invoice_link'; end if;
 else select r into invoice from jsonb_array_elements(invoices)r where r->>'sourceQuoteId'=p_quote limit 1; end if;
 if invoice is null then
 invoice:=jsonb_build_object('id',gen_random_uuid(),'contactId',q->'contactId','contactName',q->'contactName','contactPersonName',q->'contactPersonName','category',q->'category','title','Facture attendue · '||(q->>'title'),'amount',q->'amount','paidAmount',0,'status','En attente de facture','sourceQuoteId',p_quote,'sourceQuoteReference',q->'quoteReference','invoiceDate','','dueDate','','createdAt',clock_timestamp(),'createdBy',auth.uid());
 invoices:=jsonb_build_array(invoice)||invoices;
 end if;
 -- Preserve existing invoices (including recurring records and payment/document fields) unchanged.
 q:=q||jsonb_build_object('status','Validé','validatedAt',coalesce(q->>'validatedAt',clock_timestamp()::text),'linkedInvoiceId',invoice->'id','updatedBy',auth.uid());
 w:=jsonb_set(w,'{vendorQuotes}',(select jsonb_agg(case when r->>'id'=p_quote then q else r end) from jsonb_array_elements(w->'vendorQuotes')r));
 update public.crm_workspace_state set payload=jsonb_set(w,'{vendorInvoices}',invoices) where workspace_id='oneaddress-riviera';
 return public.crm_read_module('vendorQuotes');
end $$;

create function public.crm_new_document(p_collection text,p_record text,p_title text,p_bank boolean default false) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare m text; path text:='classified/'||gen_random_uuid()::text;
begin
 perform pg_advisory_xact_lock_shared(734991);
 select module into m from app_private.module_collections where collection=p_collection;
 if m is null or not app_private.module_allowed('documents',true) or not app_private.module_allowed(m,true) then raise exception 'document_write_forbidden' using errcode='42501'; end if;
 if p_bank and (p_collection<>'contacts' or not app_private.module_allowed('contacts',true,'bank_write')) then raise exception 'bank_write_forbidden' using errcode='42501'; end if;
 if length(p_title) not between 1 and 200 or not exists(select 1 from public.crm_workspace_state w cross join lateral jsonb_array_elements(coalesce(w.payload->p_collection,'[]'))r where w.workspace_id='oneaddress-riviera' and r->>'id'=p_record) then raise exception 'invalid_document_owner'; end if;
 insert into public.crm_document_scopes(provider,resource_id,module,collection,record_id,title,bank) values('storage',path,m,p_collection,p_record,p_title,p_bank);
 return path;
end $$;
revoke all on function app_private.valid_iban(text) from public,anon,authenticated;
revoke all on function public.crm_bank_action(text,text,jsonb,text),public.crm_prepare_payment(text,text,text),public.crm_validate_vendor_quote(text,text),public.crm_new_document(text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.crm_bank_action(text,text,jsonb,text),public.crm_prepare_payment(text,text,text),public.crm_validate_vendor_quote(text,text),public.crm_new_document(text,text,text,boolean) to authenticated;


create function app_private.document_deletable(p_resource text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.full_access() or (app_private.module_allowed('documents',true,'delete') and exists(select 1 from public.crm_document_scopes d where d.provider='storage' and d.resource_id=p_resource and app_private.module_allowed(d.module,true,'delete') and app_private.document_allowed('storage',p_resource,true) and not d.bank and not exists(select 1 from public.crm_workspace_state w where position(p_resource in w.payload::text)>0)));
$$;
alter policy unified_storage_delete on storage.objects using(bucket_id<>'crm-documents' or app_private.document_deletable(name));
create function public.crm_forget_document(p_resource text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.document_deletable(p_resource) then raise exception 'document_delete_forbidden' using errcode='42501'; end if;
 if exists(select 1 from storage.objects where bucket_id='crm-documents' and name=p_resource) then raise exception 'delete_storage_first'; end if;
 delete from public.crm_document_scopes where provider='storage' and resource_id=p_resource;
end $$;
revoke all on function app_private.document_deletable(text),public.crm_forget_document(text) from public,anon,authenticated;
grant execute on function app_private.document_deletable(text),public.crm_forget_document(text) to authenticated;

-- Narrow function grants, including non-exposed helpers needed by RLS.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='public' and p.proname in ('crm_access_snapshot','crm_read_module','crm_mutate_record','crm_admin_users','crm_admin_save','crm_invite_prepare','crm_invite_accept','crm_invite_revoke','crm_classify_document','crm_authorize_drive','crm_export_module'))
 or (n.nspname='app_private' and p.proname in ('module_allowed','general_admin','full_access','project_record','document_allowed','module_revision','validate_grants')) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.nspname='public' or f.proname in ('module_allowed','general_admin','full_access','document_allowed') then execute format('grant execute on function %s to authenticated',f.signature); end if;
 end loop;
end $$;
notify pgrst,'reload schema';

-- Business guards mirror the existing forms and lib/vendorFinance/houseTracking;
-- the UI reuses those implementations, while REST callers must meet the same bounds.
create function app_private.validate_business_patch(c text,p jsonb,oldrow jsonb,w jsonb,fields jsonb) returns void
language plpgsql set search_path=pg_catalog as $$
declare kv record; row jsonb:=coalesce(oldrow,'{}')||p; target text; item jsonb; d date; m text;
begin
 select module into m from app_private.module_collections where collection=c;
 if p?'title' and btrim(p->>'title')='' then raise exception 'title_required'; end if;
 if p?'name' and btrim(p->>'name')='' then raise exception 'name_required'; end if;
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
end $$;
create function app_private.guard_record_delete(c text,r jsonb,w jsonb) returns void
language plpgsql set search_path=pg_catalog as $$
begin
 if c='contacts' and jsonb_array_length(coalesce(r->'supplierBankAccounts','[]'))>0 then raise exception 'bank_history_requires_archiving' using errcode='42501'; end if;
 if exists(select 1 from public.crm_document_scopes d where d.collection=c and d.record_id=r->>'id') or exists(select 1 from jsonb_each_text(r) f where f.key ~ '(Document|document|paymentBank|linkedInvoice|sourceQuote)' and coalesce(f.value,'') not in ('','null','[]','{}')) then raise exception 'record_has_protected_content' using errcode='42501'; end if;
 if c='quotes' and (coalesce((r->>'depositReceived')::numeric,0)>0 or coalesce((r->>'balanceReceived')::numeric,0)>0) then raise exception 'quote_payment_history_protected'; end if;
 if c='vendorInvoices' and (coalesce((r->>'paidAmount')::numeric,0)>0 or r->>'status' in ('Payé','Partiellement payé') or coalesce(r->>'paymentMethod','')<>'') then raise exception 'used_invoice_protected' using errcode='42501'; end if;
 if c='houseTrackingWorkers' and exists(select 1 from jsonb_array_elements(coalesce(w->'houseTimeEntries','[]')||coalesce(w->'housePayments','[]')) x where x->>'workerId'=r->>'id') then raise exception 'worker_history_requires_archiving'; end if;
 -- Includes references inside nested content, like the existing hasVendorInvoiceReference helper.
 if exists(select 1 from jsonb_each(w) col cross join lateral jsonb_array_elements(case when jsonb_typeof(col.value)='array' then col.value else '[]' end) x where not(col.key=c and x->>'id'=r->>'id') and position(r->>'id' in x::text)>0) then raise exception 'record_referenced' using errcode='23503'; end if;
end $$;
create function public.crm_reference_options(p_module text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare data jsonb; result jsonb:='{}'; c record;
begin
 data:=public.crm_read_module(p_module)->'collections';
 for c in select * from jsonb_each(data) loop
 if jsonb_typeof(c.value)='array' then
 result:=result||jsonb_build_object(c.key,coalesce((select jsonb_agg((select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(r) where key=any(array['id','clientName','supplierCost','paymentStatus','expectedDeposit','name','firstName','companyName','kind','supplierCategory','supplierContactName','supplierStatus','title','contactName','category','assetType','assetId','rentalStartDate','rentalEndDate','status','city','port','brand','model','price','startDate','endDate','startTime','endTime','blocksAvailability','dueDate','nextAction','value','owner','amount','paidAmount','invoiceDate','invoiceReference','sourceQuoteId','sourceQuoteReference','linkedInvoiceId','quoteReference','contactId','contactPersonName','unitPrice','items','categories','depositReceived','balanceReceived','paymentDueDate','bookingStatus','startDate','endDate','createdAt','updatedAt','hourlyRate','breakMinutes','date','houseId','workerId']))) from jsonb_array_elements(c.value) r),'[]'));
 end if;
 end loop;
 return result;
end $$;
revoke all on function app_private.validate_business_patch(text,jsonb,jsonb,jsonb,jsonb),app_private.guard_record_delete(text,jsonb,jsonb),public.crm_reference_options(text) from public,anon,authenticated;
grant execute on function public.crm_reference_options(text) to authenticated;
create function public.crm_update_document(p_resource text,p_title text,p_folder text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock_shared(734991);
 if p_title is null or length(btrim(p_title))=0 or length(p_title)>240 or p_folder is null or length(p_folder)>160 then raise exception 'invalid_document_metadata'; end if;
 if not exists(select 1 from public.crm_document_scopes d where d.resource_id=p_resource and app_private.document_allowed(d.provider,p_resource,true)) then raise exception 'document_write_forbidden' using errcode='42501'; end if;
 update public.crm_document_scopes set title=btrim(p_title),folder=btrim(p_folder) where resource_id=p_resource;
end $$;
create function public.crm_reject_vendor_quote(p_quote text,p_revision text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare w jsonb; q jsonb; changes_invoice boolean;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.module_allowed('vendorQuotes',true) then raise exception 'module_forbidden' using errcode='42501'; end if;
 select payload into w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
 if p_revision is distinct from app_private.module_revision('vendorQuotes',w) then raise exception 'revision_conflict' using errcode='40001'; end if;
 select r into q from jsonb_array_elements(w->'vendorQuotes') r where r->>'id'=p_quote;
 if q is null then raise exception 'quote_missing'; end if;
 select exists(select 1 from jsonb_array_elements(coalesce(w->'vendorInvoices','[]')) r where (r->>'id'=q->>'linkedInvoiceId' or r->>'sourceQuoteId'=p_quote) and r->>'status'='En attente de facture' and app_private.empty_automatic_invoice(r)) into changes_invoice;
 if changes_invoice and not app_private.module_allowed('vendorInvoices',true) then raise exception 'linked_invoice_write_forbidden' using errcode='42501'; end if;
 if changes_invoice then
  w:=jsonb_set(w,'{vendorInvoices}',(select jsonb_agg(case when (r->>'id'=q->>'linkedInvoiceId' or r->>'sourceQuoteId'=p_quote) and r->>'status'='En attente de facture' and app_private.empty_automatic_invoice(r) then r||jsonb_build_object('status','Annulé') else r end) from jsonb_array_elements(w->'vendorInvoices') r));
 end if;
 update public.crm_workspace_state set payload=jsonb_set(w,'{vendorQuotes}',(select jsonb_agg(case when r->>'id'=p_quote then r||jsonb_build_object('status','Refusé','updatedBy',auth.uid(),'updatedAt',clock_timestamp()) else r end) from jsonb_array_elements(w->'vendorQuotes') r)),updated_by=auth.uid() where workspace_id='oneaddress-riviera';
 return public.crm_read_module('vendorQuotes');
end $$;
revoke all on function public.crm_update_document(text,text,text),public.crm_reject_vendor_quote(text,text) from public,anon,authenticated;
grant execute on function public.crm_update_document(text,text,text),public.crm_reject_vendor_quote(text,text) to authenticated;

create function public.crm_invite_delivery_allowed(p_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.general_admin() and exists(select 1 from public.crm_access_invitations where id=p_id and created_by=auth.uid() and revoked_at is null and accepted_at is null and expires_at>clock_timestamp());
$$;
revoke all on function public.crm_invite_delivery_allowed(uuid) from public,anon,authenticated;
grant execute on function public.crm_invite_delivery_allowed(uuid) to authenticated;


create function app_private.empty_automatic_invoice(r jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $$
 select r is not null and (r->>'notes' like 'Créée automatiquement depuis le devis %' or (coalesce(r->>'sourceQuoteId','')<>'' and r->>'title' like 'Facture attendue · %'))
 and coalesce((r->>'paidAmount')::numeric,0)=0 and coalesce(r->>'status','') not in ('Payé','Partiellement payé')
 and (coalesce(r->>'notes','')='' or r->>'notes' like 'Créée automatiquement depuis le devis %')
 and not exists(select 1 from jsonb_each(r) f where f.key<>all(array['id','contactId','contactName','contactPersonName','category','title','amount','paidAmount','status','sourceQuoteId','sourceQuoteReference','notes','createdAt','createdBy','updatedBy','updatedAt']) and f.value not in ('null','""','[]'));
$$;
create function public.crm_delete_vendor_quote(p_quote text,p_choice text,p_revision text,p_invoice_revision text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare w jsonb; q jsonb; invoices jsonb; inv jsonb;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.module_allowed('vendorQuotes',true,'delete') then raise exception 'quote_delete_forbidden' using errcode='42501'; end if;
 select payload into w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
 if p_revision is distinct from app_private.module_revision('vendorQuotes',w) then raise exception 'revision_conflict' using errcode='40001'; end if;
 select r into q from jsonb_array_elements(w->'vendorQuotes') r where r->>'id'=p_quote;
 if q is null then raise exception 'quote_missing'; end if;
 if exists(select 1 from public.crm_document_scopes d where d.collection='vendorQuotes' and d.record_id=p_quote) or coalesce(q->>'quoteDocumentStoragePath','')<>'' or coalesce(q->>'quoteDocumentUrl','')<>'' then raise exception 'quote_document_protected'; end if;
 select coalesce(jsonb_agg(r),'[]') into invoices from jsonb_array_elements(coalesce(w->'vendorInvoices','[]')) r where r->>'id'=q->>'linkedInvoiceId' or r->>'sourceQuoteId'=p_quote;
 if (jsonb_array_length(invoices)>0 or coalesce(q->>'linkedInvoiceId','')<>'') and (p_choice is null or p_choice not in ('keep-invoice','delete-both')) then raise exception 'explicit_invoice_choice_required'; end if;
 if p_choice='delete-both' then
  if not app_private.module_allowed('vendorInvoices',true,'delete') then raise exception 'invoice_delete_forbidden' using errcode='42501'; end if;
  if p_invoice_revision is distinct from app_private.module_revision('vendorInvoices',w) then raise exception 'revision_conflict' using errcode='40001'; end if;
  if jsonb_array_length(invoices)=0 or (coalesce(q->>'linkedInvoiceId','')<>'' and not exists(select 1 from jsonb_array_elements(invoices) r where r->>'id'=q->>'linkedInvoiceId')) then raise exception 'broken_invoice_link'; end if;
  for inv in select value from jsonb_array_elements(invoices) loop
   if not app_private.empty_automatic_invoice(inv) then raise exception 'used_invoice_protected'; end if;
   perform app_private.guard_record_delete('vendorInvoices',inv-array['sourceQuoteId','sourceQuoteReference'],jsonb_set(w,'{vendorQuotes}',coalesce((select jsonb_agg(r) from jsonb_array_elements(w->'vendorQuotes') r where r->>'id'<>p_quote),'[]')));
  end loop;
  w:=jsonb_set(w,'{vendorInvoices}',coalesce((select jsonb_agg(r) from jsonb_array_elements(w->'vendorInvoices') r where not exists(select 1 from jsonb_array_elements(invoices) i where i->>'id'=r->>'id')),'[]'));
 end if;
 w:=jsonb_set(w,'{vendorQuotes}',coalesce((select jsonb_agg(r) from jsonb_array_elements(w->'vendorQuotes') r where r->>'id'<>p_quote),'[]'));
 update public.crm_workspace_state set payload=w,updated_by=auth.uid() where workspace_id='oneaddress-riviera';
 return public.crm_read_module('vendorQuotes');
end $$;
create function public.crm_delete_orphan_invoice(p_invoice text,p_revision text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare w jsonb; r jsonb;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.module_allowed('vendorInvoices',true,'delete') then raise exception 'invoice_delete_forbidden' using errcode='42501'; end if;
 select payload into w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
 if p_revision is distinct from app_private.module_revision('vendorInvoices',w) then raise exception 'revision_conflict' using errcode='40001'; end if;
 select x into r from jsonb_array_elements(w->'vendorInvoices') x where x->>'id'=p_invoice;
 if not app_private.empty_automatic_invoice(r) or exists(select 1 from jsonb_array_elements(w->'vendorQuotes') q where q->>'id'=r->>'sourceQuoteId' or q->>'linkedInvoiceId'=p_invoice) then raise exception 'not_empty_orphan'; end if;
 perform app_private.guard_record_delete('vendorInvoices',r-array['sourceQuoteId','sourceQuoteReference'],w);
 update public.crm_workspace_state set payload=jsonb_set(w,'{vendorInvoices}',coalesce((select jsonb_agg(x) from jsonb_array_elements(w->'vendorInvoices') x where x->>'id'<>p_invoice),'[]')),updated_by=auth.uid() where workspace_id='oneaddress-riviera';
 return public.crm_read_module('vendorInvoices');
end $$;
revoke all on function app_private.empty_automatic_invoice(jsonb),public.crm_delete_vendor_quote(text,text,text,text),public.crm_delete_orphan_invoice(text,text) from public,anon,authenticated;
grant execute on function public.crm_delete_vendor_quote(text,text,text,text),public.crm_delete_orphan_invoice(text,text) to authenticated;
create function public.crm_create_from_message(p_contact jsonb,p_lead jsonb,p_contacts_revision text,p_leads_revision text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.module_allowed('contacts',true) or not app_private.module_allowed('leads',true) then raise exception 'message_modules_forbidden' using errcode='42501'; end if;
 if exists(select 1 from public.crm_workspace_state w cross join lateral jsonb_array_elements(coalesce(w.payload->'contacts','[]')||coalesce(w.payload->'leads','[]')) r where r->>'id' in (p_contact->>'id',p_lead->>'id')) then raise exception 'message_record_exists'; end if;
 if coalesce(p_contact->>'name','') is distinct from coalesce(p_lead->>'contactName','') then raise exception 'message_contact_mismatch'; end if;
 perform public.crm_mutate_record('contacts','contacts',p_contact->>'id',p_contact-'id',p_contacts_revision,false);
 perform public.crm_mutate_record('leads','leads',p_lead->>'id',p_lead-'id',p_leads_revision,false);
end $$;
revoke all on function public.crm_create_from_message(jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.crm_create_from_message(jsonb,jsonb,text,text) to authenticated;
create function public.crm_replace_document(p_previous text,p_next text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare old_doc public.crm_document_scopes%rowtype; next_doc public.crm_document_scopes%rowtype; w jsonb; row jsonb; k text;
begin
 perform pg_advisory_xact_lock_shared(734991);
 select * into old_doc from public.crm_document_scopes where provider='storage' and resource_id=p_previous for update;
 select * into next_doc from public.crm_document_scopes where provider='storage' and resource_id=p_next for update;
 if old_doc.resource_id is null or next_doc.resource_id is null or p_previous=p_next or old_doc.bank or next_doc.bank or old_doc.superseded_by is not null or next_doc.superseded_by is not null or old_doc.collection<>next_doc.collection or old_doc.record_id<>next_doc.record_id or not app_private.document_replaceable(p_previous) or not app_private.document_allowed('storage',p_next,true) then raise exception 'replacement_forbidden' using errcode='42501'; end if;
 if not exists(select 1 from storage.objects where bucket_id='crm-documents' and name=p_next) then raise exception 'replacement_file_missing'; end if;
 select payload into w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
 select r into row from jsonb_array_elements(w->old_doc.collection) r where r->>'id'=old_doc.record_id;
 if old_doc.collection='vendorInvoices' and (coalesce((row->>'paidAmount')::numeric,0)>0 or row->>'status' in ('Payé','Partiellement payé') or coalesce(row->>'paymentBankAccountId','')<>'') then raise exception 'used_invoice_document_protected'; end if;
 foreach k in array array['invoiceDocumentStoragePath','quoteDocumentStoragePath','documentStoragePath'] loop
  if row->>k=p_previous then row:=jsonb_set(row,array[k],to_jsonb(p_next)); end if;
 end loop;
 update public.crm_workspace_state set payload=jsonb_set(w,array[old_doc.collection],(select jsonb_agg(case when r->>'id'=old_doc.record_id then row else r end) from jsonb_array_elements(w->old_doc.collection) r)),updated_by=auth.uid() where workspace_id='oneaddress-riviera';
 update public.crm_document_scopes set superseded_by=p_next where provider='storage' and resource_id=p_previous;
 update public.crm_document_scopes set folder=old_doc.folder where provider='storage' and resource_id=p_next;
end $$;
revoke all on function public.crm_replace_document(text,text) from public,anon,authenticated;
grant execute on function public.crm_replace_document(text,text) to authenticated;
create function app_private.document_replaceable(p_resource text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.crm_document_scopes d join public.crm_workspace_state w on w.workspace_id='oneaddress-riviera' cross join lateral jsonb_array_elements(coalesce(w.payload->d.collection,'[]')) r where d.provider='storage' and d.resource_id=p_resource and not d.bank and d.superseded_by is null and r->>'id'=d.record_id and app_private.document_allowed('storage',p_resource,true) and (d.collection<>'vendorInvoices' or (coalesce((r->>'paidAmount')::numeric,0)=0 and coalesce(r->>'status','') not in ('Payé','Partiellement payé') and coalesce(r->>'paymentBankAccountId','')='')));
$$;
revoke all on function app_private.document_replaceable(text) from public,anon,authenticated;
commit;
