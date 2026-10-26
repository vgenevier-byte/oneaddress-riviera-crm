/** Offline generator only. It never connects to a database or invents an Auth
 * session. Apply the reviewed SQL through the connected administrative channel.
 * The durable journal identifies the human authorizer and the actual channel. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const stableJSON = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
 ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const one = (rows, predicate, error) => { const found = rows.filter(predicate); if (found.length !== 1) throw new Error(error); return found[0]; };

function duration(entry) {
 const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
 if (!clock.test(entry.startTime) || !clock.test(entry.endTime) || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) throw new Error('invalid_intervention_time');
 const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
 const start = minutes(entry.startTime); let end = minutes(entry.endTime); if (end < start) end += 1440;
 const pause = entry.breakMinutes ?? 0;
 if (!Number.isSafeInteger(pause) || pause < 0 || pause > end - start) throw new Error('invalid_intervention_pause');
 return end - start - pause;
}

export function prepareHousePrepaidReconciliation(snapshot, plan) {
 if (snapshot.workspace_id !== 'oneaddress-riviera' || !snapshot.updated_at || !snapshot.payload ||
  !['contacts','houseTrackingWorkers','houseTimeEntries','housePayments','vendorInvoices'].every(key => Array.isArray(snapshot.payload[key]))) throw new Error('invalid_workspace_snapshot');
 if (!uuid(plan.operatorId) || !uuid(plan.requestId) || !id(plan.workerId) || !id(plan.contactId) || !id(plan.paymentId) ||
  !positive(plan.capacityMinutes) || plan.capacityMinutes > 10000000 || !positive(plan.priceCents) || plan.priceCents > 10000000000000 ||
  !Number.isSafeInteger(plan.expectedMinutes) || plan.expectedMinutes < 0 || plan.reviewed !== true ||
  typeof plan.reason !== 'string' || !plan.reason.trim() || typeof plan.evidence !== 'string' || !plan.evidence.trim()) throw new Error('explicit_reviewed_reconciliation_required');
 const data = snapshot.payload;
 const worker = one(data.houseTrackingWorkers, x => x.id === plan.workerId, 'canonical_worker_not_unique');
 const contact = one(data.contacts, x => x.id === plan.contactId, 'canonical_contact_not_unique');
 if (worker.contactId !== contact.id || worker.status === 'Inactif') throw new Error('canonical_contact_worker_mismatch');
 const payment = one(data.housePayments, x => x.id === plan.paymentId, 'canonical_payment_not_unique');
 if (payment.workerId !== worker.id || typeof payment.amount !== 'number' || Math.round(payment.amount * 100) !== plan.priceCents || Math.abs(payment.amount * 100 - plan.priceCents) > 1e-6 ||
  payment.prepaidPackageId || !/^\d{4}-\d{2}-\d{2}$/.test(payment.date)) throw new Error('canonical_payment_mismatch_or_reserved');
 const entries = data.houseTimeEntries.filter(x => x.workerId === worker.id);
 const entryIds = new Set(entries.map(x => x.id));
 if (entryIds.size !== entries.length || entries.some(x => !id(x.id)) || data.houseTimeEntries.some(x => x.workerId !== worker.id && entryIds.has(x.id))) throw new Error('canonical_intervention_not_unique');
 const performedMinutes = entries.reduce((sum, entry) => sum + duration(entry), 0);
 if (performedMinutes !== plan.expectedMinutes) throw new Error('verified_duration_does_not_match');
 let invoice;
 if (plan.invoiceId != null) {
  if (!id(plan.invoiceId)) throw new Error('invalid_invoice_reference');
  invoice = one(data.vendorInvoices, x => x.id === plan.invoiceId, 'canonical_invoice_not_unique');
  if (invoice.contactId !== contact.id || typeof invoice.amount !== 'number' || Math.round(invoice.amount * 100) !== plan.priceCents ||
   Math.abs(invoice.amount * 100 - plan.priceCents) > 1e-6 || !['À payer','Partiellement payé','Payé','En retard'].includes(invoice.status) || invoice.prepaidPackageId) throw new Error('canonical_invoice_mismatch');
 }
 const sourceBackup = { workspaceRevision: snapshot.updated_at, payloadDigest: snapshot.payload_md5 ?? null,
  worker: structuredClone(worker), contact: structuredClone(contact), payment: structuredClone(payment),
  entries: structuredClone(entries), ...(invoice ? { invoice: structuredClone(invoice) } : {}) };
 const requestHash = 'reconcile-house-prepaid:v1:' + createHash('sha256').update(stableJSON({ plan, sourceBackup })).digest('hex');
 return { requestHash, plan: structuredClone(plan), sourceBackup,
  preview: { workerId: worker.id, contactId: contact.id, paymentId: payment.id, paymentDate: payment.date,
   packageId: plan.requestId, paidCents: plan.priceCents, purchasedMinutes: plan.capacityMinutes,
   performedMinutes, coveredMinutes: Math.min(performedMinutes, plan.capacityMinutes),
   availableMinutes: Math.max(plan.capacityMinutes - performedMinutes, 0), uncoveredMinutes: Math.max(performedMinutes - plan.capacityMinutes, 0),
   entries: entries.map(entry => ({ id: entry.id, date: entry.date, houseId: entry.houseId, startTime: entry.startTime,
    endTime: entry.endTime, breakMinutes: entry.breakMinutes, minutes: duration(entry), legacyHourlyRate: entry.hourlyRate })),
   invoiceId: invoice?.id ?? null, execution: { channel: 'connected_supabase_admin', authenticatedRpc: false,
    authorizedBy: plan.operatorId, reason: plan.reason, evidence: plan.evidence } } };
}

const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
export function housePrepaidReconciliationSQL(snapshot, prepared) {
 const { plan, sourceBackup, preview, requestHash } = prepared;
 const dollarSources = JSON.stringify([snapshot, prepared]);
 let tagNumber = 0, blockTag;
 do { blockTag = '$prepaid_' + plan.requestId.replaceAll('-', '') + '_' + tagNumber++ + '$'; } while (dollarSources.includes(blockTag));
 const authorizer = `${literal(plan.operatorId)}::uuid`, request = `${literal(plan.requestId)}::uuid`;
 const worker = literal(plan.workerId), payment = literal(plan.paymentId);
 const sourceCheck = /^[a-f0-9]{32}$/.test(snapshot.payload_md5 ?? '')
  ? `md5(w.payload::text) is distinct from ${literal(snapshot.payload_md5)}`
  : `w.payload is distinct from ${literal(JSON.stringify(snapshot.payload))}::jsonb`;
 const execution = literal(JSON.stringify(preview.execution)), backup = literal(JSON.stringify(sourceBackup));
 return `-- Human-reviewed administrative reconciliation. No JWT/session claims are set.
begin;
select pg_advisory_xact_lock(734991);
do ${blockTag}
declare w public.crm_workspace_state%rowtype; before_payload jsonb; before_state jsonb; after_state jsonb;
 prior app_private.house_prepaid_requests%rowtype; result jsonb;
begin
 if current_user not in ('postgres','supabase_admin') or auth.uid() is not null then raise exception 'administrative_channel_required_without_impersonation' using errcode='42501'; end if;
 if not exists(select 1 from public.crm_access_profiles p join public.crm_module_grants g on g.user_id=p.user_id
  join public.app_memberships m on m.user_id=p.user_id and m.workspace_id='oar' and m.status='active'
  where p.user_id=${authorizer} and p.active and p.general_admin and g.module='houseTracking' and g.level='contribute') then raise exception 'verified_active_authorizer_required' using errcode='42501'; end if;
 select * into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
 select * into prior from app_private.house_prepaid_requests r where r.actor_id=${authorizer} and r.request_id=${request};
 if found then
  if prior.request_hash is distinct from ${literal(requestHash)} or prior.action<>'administrator_reconciliation' then raise exception 'reconciliation_request_reused'; end if;
  if not exists(select 1 from app_private.house_prepaid_packages p where p.id=${request} and p.worker_id=${worker} and p.payment_id=${payment}
   and p.capacity_minutes=${plan.capacityMinutes} and p.price_cents=${plan.priceCents}) then raise exception 'reconciliation_journal_inconsistent'; end if;
  return;
 end if;
 if w.updated_at is distinct from ${literal(snapshot.updated_at)}::timestamptz or ${sourceCheck} then raise exception 'reconciliation_source_changed' using errcode='40001'; end if;
 if (select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(w.payload->'houseTrackingWorkers') x where x->>'id'=${worker}) is distinct from ${literal(JSON.stringify([sourceBackup.worker]))}::jsonb
  or (select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(w.payload->'contacts') x where x->>'id'=${literal(plan.contactId)}) is distinct from ${literal(JSON.stringify([sourceBackup.contact]))}::jsonb
  or (select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(w.payload->'housePayments') x where x->>'id'=${payment}) is distinct from ${literal(JSON.stringify([sourceBackup.payment]))}::jsonb
  or (select coalesce(jsonb_agg(x order by ord),'[]') from jsonb_array_elements(w.payload->'houseTimeEntries') with ordinality e(x,ord) where x->>'workerId'=${worker}) is distinct from ${literal(JSON.stringify(sourceBackup.entries))}::jsonb
  ${sourceBackup.invoice ? `or (select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(w.payload->'vendorInvoices') x where x->>'id'=${literal(plan.invoiceId)}) is distinct from ${literal(JSON.stringify([sourceBackup.invoice]))}::jsonb` : ''}
 then raise exception 'reconciliation_reviewed_records_changed' using errcode='40001'; end if;
 if exists(select 1 from app_private.house_prepaid_settings s where s.worker_id=${worker})
  or exists(select 1 from app_private.house_prepaid_packages p where p.worker_id=${worker} or p.payment_id=${payment} or p.id=${request}) then raise exception 'reconciliation_prepaid_history_already_exists'; end if;
 before_payload:=w.payload;
 before_state:=app_private.house_prepaid_snapshot(w.payload)||jsonb_build_object('sourceBackup',${backup}::jsonb,'execution',${execution}::jsonb);
 insert into app_private.house_prepaid_settings(worker_id,billing_mode,default_minutes,default_price_cents,updated_by)
 values(${worker},'prepaid',${plan.capacityMinutes},${plan.priceCents},${authorizer});
 insert into app_private.house_prepaid_packages(id,worker_id,payment_id,capacity_minutes,price_cents,paid_date,invoice_id,created_by)
 values(${request},${worker},${payment},${plan.capacityMinutes},${plan.priceCents},${literal(sourceBackup.payment.date)}::date,${plan.invoiceId ? literal(plan.invoiceId) : 'null'},${authorizer});
 update public.crm_workspace_state set payload=w.payload,updated_by=${authorizer} where workspace_id=w.workspace_id returning * into w;
 after_state:=app_private.house_prepaid_snapshot(w.payload)||jsonb_build_object('execution',${execution}::jsonb);
 select x into result from jsonb_array_elements(after_state->'summaries') x where x->>'workerId'=${worker};
 if result is null or (result->>'purchasedMinutes')::bigint<>${preview.purchasedMinutes} or (result->>'performedMinutes')::bigint<>${preview.performedMinutes}
  or (result->>'coveredMinutes')::bigint<>${preview.coveredMinutes} or (result->>'availableMinutes')::bigint<>${preview.availableMinutes}
  or (result->>'uncoveredMinutes')::bigint<>${preview.uncoveredMinutes} or (result->>'paidCents')::bigint<>${preview.paidCents} then raise exception 'reconciliation_postcondition_failed'; end if;
 -- Preserve every source date, time, pause, rate, note and canonical identity.
 if exists(select 1 from jsonb_array_elements(before_payload->'houseTimeEntries') a where not exists(
  select 1 from jsonb_array_elements(w.payload->'houseTimeEntries') b where (b-'billingMode'-'prepaid')=(a-'billingMode'-'prepaid')))
  or jsonb_array_length(before_payload->'houseTimeEntries')<>jsonb_array_length(w.payload->'houseTimeEntries') then raise exception 'reconciliation_source_interventions_changed'; end if;
 if exists(select 1 from jsonb_array_elements(before_payload->'housePayments') a where not exists(
  select 1 from jsonb_array_elements(w.payload->'housePayments') b where (b-'prepaidPackageId')=(a-'prepaidPackageId')))
  or jsonb_array_length(before_payload->'housePayments')<>jsonb_array_length(w.payload->'housePayments') then raise exception 'reconciliation_source_payments_changed'; end if;
 if exists(select 1 from jsonb_array_elements(before_payload->'houseTrackingWorkers') a where not exists(
  select 1 from jsonb_array_elements(w.payload->'houseTrackingWorkers') b where (b-'billingMode'-'prepaidDefaultMinutes'-'prepaidDefaultPriceCents')=(a-'billingMode'-'prepaidDefaultMinutes'-'prepaidDefaultPriceCents')))
  or jsonb_array_length(before_payload->'houseTrackingWorkers')<>jsonb_array_length(w.payload->'houseTrackingWorkers') then raise exception 'reconciliation_source_workers_changed'; end if;
 if (before_payload-array['houseTrackingWorkers','houseTimeEntries','housePayments','vendorInvoices']) is distinct from (w.payload-array['houseTrackingWorkers','houseTimeEntries','housePayments','vendorInvoices'])
  or (select jsonb_agg(x-'prepaidPackageId' order by ord) from jsonb_array_elements(before_payload->'vendorInvoices') with ordinality e(x,ord)) is distinct from
   (select jsonb_agg(x-'prepaidPackageId' order by ord) from jsonb_array_elements(w.payload->'vendorInvoices') with ordinality e(x,ord)) then raise exception 'reconciliation_unrelated_data_changed'; end if;
 insert into app_private.house_prepaid_requests(actor_id,request_id,request_hash,action,before_state,after_state)
 values(${authorizer},${request},${literal(requestHash)},'administrator_reconciliation',before_state,after_state);
end ${blockTag};
commit;
select request_id,action,created_at,after_state->'execution' execution,after_state->'summaries' summaries
from app_private.house_prepaid_requests where actor_id=${authorizer} and request_id=${request};
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const [snapshotFile, planFile, outputPrefix] = process.argv.slice(2);
 if (!outputPrefix) throw new Error('Usage: node scripts/reconcile-house-prepaid.mjs PRIVATE_SNAPSHOT PRIVATE_REVIEWED_PLAN PRIVATE_OUTPUT_PREFIX');
 const snapshot = JSON.parse(readFileSync(snapshotFile,'utf8')), plan = JSON.parse(readFileSync(planFile,'utf8'));
 const prepared = prepareHousePrepaidReconciliation(snapshot,plan);
 writeFileSync(outputPrefix+'.preview.json',JSON.stringify(prepared.preview,null,2)+'\n',{mode:0o600});
 writeFileSync(outputPrefix+'.apply.sql',housePrepaidReconciliationSQL(snapshot,prepared),{mode:0o600});
 console.log(JSON.stringify({requestId:plan.requestId,requestHash:prepared.requestHash,...prepared.preview,entries:prepared.preview.entries.length}));
}
