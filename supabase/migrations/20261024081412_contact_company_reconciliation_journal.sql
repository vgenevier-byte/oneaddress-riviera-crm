begin;

-- Private administrative backup. No client role can read personal snapshots
-- or write a journal entry to authorize a reconciliation.
create table app_private.contact_company_reconciliation_runs (
  plan_id text primary key,
  workspace_id text not null,
  before_revision timestamptz not null,
  after_revision timestamptz,
  before_payload jsonb not null,
  after_contacts jsonb not null,
  operations jsonb not null,
  applied_at timestamptz not null default clock_timestamp(),
  rolled_back_at timestamptz,
  check (jsonb_typeof(before_payload) = 'object'),
  check (jsonb_typeof(after_contacts) = 'array'),
  check (jsonb_typeof(operations) = 'array')
);
alter table app_private.contact_company_reconciliation_runs enable row level security;
revoke all on app_private.contact_company_reconciliation_runs from public, anon, authenticated, service_role;
comment on table app_private.contact_company_reconciliation_runs is
  'Administrative Contacts reconciliation journal; original full workspace and exact operations retained for guarded rollback. Never exposed through Contacts.';

commit;
