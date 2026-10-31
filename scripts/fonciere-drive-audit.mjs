/** Read-only audit. Never load repository .env files or output backend errors.
 * Registry: node --conditions=react-server scripts/fonciere-drive-audit.mjs inventory.json report.json
 * Technical-identity verification: same command with --verify (see README).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { inventoryDriveCandidates, auditDriveCopies, summarizeDriveInventory } = require('../lib/server/fonciereDriveAudit.ts');
const args = process.argv.slice(2);
if (args.length < 2 || args.length > 3 || args.length === 3 && args[2] !== '--verify') {
  console.error('Usage: node --conditions=react-server scripts/fonciere-drive-audit.mjs inventory.json report.json [--verify]');
  process.exit(1);
}
try {
  const inventory = JSON.parse(readFileSync(args[0], 'utf8'));
  let audit = { rows: inventoryDriveCandidates(inventory), sourceBytesRead: 0 };
  if (args[2] === '--verify') {
    // No personal Google OAuth flow or fallback is accepted. Reuse server WIF.
    const required = ['NEXT_PUBLIC_SUPABASE_URL', 'CRM_INVITE_AUTH_KEY', 'GCP_PROJECT_ID', 'GCP_PROJECT_NUMBER', 'GCP_SERVICE_ACCOUNT_EMAIL', 'GCP_WORKLOAD_IDENTITY_POOL_ID', 'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID', 'GOOGLE_DRIVE_SHARED_DRIVE_ID'];
    const missing = required.filter(key => !process.env[key]);
    if (missing.length) { console.error('Required technical runtime variables unavailable: ' + missing.join(', ')); process.exitCode = 2; }
    else {
      if (process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID !== inventory.config.shared_drive_id) throw Error('configuration_conflict');
      const { createClient } = require('@supabase/supabase-js');
      const { createGoogleDriveFetch } = require('../app/api/drive/_utils.ts');
      const source = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.CRM_INVITE_AUTH_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      audit = await auditDriveCopies(inventory, {
        fetchDrive: createGoogleDriveFetch(),
        rereadAsset: async id => {
          const row = await source.from('fonciere_assets').select('id,project_id,object_path,kind,lifecycle,expected_size,expected_mime,storage_object_id,storage_object_version,drive_category').eq('id', id).single();
          if (row.error || !row.data) throw Error('asset_unavailable');
          const info = await source.storage.from('fonciere-documents').info(row.data.object_path);
          if (info.error || !info.data || info.data.id !== row.data.storage_object_id) throw Error('source_binding_changed');
          return { ...row.data, storage_present: true, storage_size: String(info.data.size), storage_mime: info.data.contentType, actual_storage_version: info.data.version };
        },
        readSource: async asset => {
          const response = await source.storage.from('fonciere-documents').download(asset.object_path);
          if (response.error || !response.data) throw Error('source_unavailable');
          return response.data;
        },
      });
    }
  }
  if (!process.exitCode) {
    const summary = summarizeDriveInventory(inventory, audit.rows);
    const report = { mode: args[2] === '--verify' ? 'technical-identity-read-only' : 'registry-only-unverified', ...summary, sourceBytesRead: audit.sourceBytesRead, rows: audit.rows };
    writeFileSync(args[1], JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ mode: report.mode, states: summary.states, sourceBytesRead: audit.sourceBytesRead, freedSupabaseBytes: 0 }));
  }
} catch {
  console.error('Audit not confirmed. No storage provider was changed. Backend error contents are withheld.');
  process.exitCode = 1;
}
