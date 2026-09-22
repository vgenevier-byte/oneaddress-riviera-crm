// Fictitious local browser transport only; no database, migration, or real Auth.
// Profile/module vocabulary matches local.mjs without importing its SQL runner.
export const modules = ['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','izord'];
export const labels = ['Dashboard','Contacts','Leads','Tâches','Devis','Réservations','Devis prestataires','Factures prestataires','Suivi maison','Documents','Planning','Biens','Voitures','Bateaux','IZORD Invest'];
const payload = Object.fromEntries(['contacts','leads','properties','vehicles','boats','tasks','suppliers','planningEntries','quotes','documents','vendorQuotes','vendorInvoices','houseTrackingHouses','houseTrackingWorkers','houseTimeEntries','housePayments'].map(key => [key, []]));
payload.vendorQuotes = [{ id: 'unified-vendorQuotes', title: 'Entretien fictif', status: 'À valider', totalAmount: 100, contactName: 'Prestataire fictif', category: 'Autre', date: '2026-09-22', notes: '' }];
payload.vendorInvoices = Array.from({length: 12}, (_, index) => ({id: 'unified-vendorInvoices-' + index, title: 'Facture fictive ' + index, status: 'À payer', amount: 100, totalAmount: 100, paidAmount: 0, contactName: 'Prestataire fictif', category: 'Autre', issueDate: '2026-09-22', dueDate: '2026-10-22', notes: ''}));

export async function installFixture(context, profile, origin) {
  const admin = profile === 'admin';
  const grants = Object.fromEntries(modules.map(module => [module, {level: admin ? 'contribute' : ['houseTracking','planning'].includes(module) ? 'read' : 'none', sensitive: admin ? {delete: true, export: true} : {}}]));
  const access = {revision: 1, active: true, generalAdmin: admin, fullAccess: admin, modules: grants};
  const user = {id: admin ? '00000000-0000-4000-8000-000000000001' : '00000000-0000-4000-8000-000000000002', aud: 'authenticated', role: 'authenticated', email: `unified-${profile}@example.invalid`, email_confirmed_at: '2026-09-22T00:00:00Z', app_metadata: {provider: 'email'}, user_metadata: {}, identities: [], created_at: '2026-09-22T00:00:00Z'};
  const token = [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'), Buffer.from(JSON.stringify({sub:user.id, aud:'authenticated',role:'authenticated',email:user.email,exp:4102444800})).toString('base64url'), 'local-fixture-signature'].join('.');
  const audit = {profile, blocked: [], reads: [], auth: []};
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const respond = data => route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: JSON.stringify(data)});
    if (url.origin === 'http://127.0.0.1:3997') {
      if (request.method() === 'OPTIONS') return route.fulfill({status: 204, headers: {'access-control-allow-origin': '*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
      if (path === '/auth/v1/token') {audit.auth.push('simulated sign in'); return respond({access_token: token,refresh_token:'fixture-refresh-token',token_type:'bearer',expires_in:31536000,user});}
      if (path === '/auth/v1/user') {audit.auth.push('simulated user'); return respond(user);}
      if (path === '/auth/v1/logout') {audit.auth.push('simulated sign out'); return respond({});}
      const rpc = path.split('/rest/v1/rpc/')[1];
      const readRPC = ['crm_access_snapshot','crm_admin_users','crm_read_module','crm_reference_options'];
      if (request.method() !== 'GET' && !readRPC.includes(rpc)) {audit.blocked.push(request.method()+' '+path); return route.abort();}
      audit.reads.push(path);
      if (rpc === 'crm_access_snapshot') return respond(access);
      if (rpc === 'crm_admin_users') return respond({users:[{...user,confirmed:true,active:true,generalAdmin:true,revision:1,modules:grants,izordRole:'admin',assignments:[]}],invitations:[],projects:[],history:[]});
      if (rpc === 'crm_read_module') return respond({revision:'2026-09-22T00:00:00Z',collections:{houseTrackingHouses:[],houseTrackingWorkers:[],houseTimeEntries:[],housePayments:[],planningEntries:[]}});
      if (rpc === 'crm_reference_options') return respond({});
      if (path === '/rest/v1/app_memberships') return respond([{workspace_id:'oar',role:'member'},...(admin?[{workspace_id:'izord',role:'admin'}]:[])]);
      if (path === '/rest/v1/crm_workspace_state') return respond({payload,updated_at:'2026-09-22T00:00:00Z'});
      if (['/rest/v1/izord_projects','/rest/v1/izord_project_versions'].includes(path)) return respond([]);
      audit.blocked.push(request.method()+' '+path); return route.abort();
    }
    if (url.origin === origin && !path.startsWith('/api/')) return route.continue();
    if (['data:','blob:'].includes(url.protocol)) return route.continue();
    audit.blocked.push(request.method()+' '+url.origin+path); return route.abort();
  });
  return {audit, email:user.email, expected:admin?[...labels,'Administration']:['Suivi maison','Planning']};
}
