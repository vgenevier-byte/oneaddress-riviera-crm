/** One reviewable patch, including new files and fictional captures; no index mutation. */
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const tracked = ['components/AccessPortal.tsx','components/CRMApp.tsx','components/ModuleWorkspace.tsx','lib/access/modules.ts'];
const extra = ['app/charges','components/monthlyCharges','lib/monthlyCharges','tests/monthly-charges','docs/monthly-charges','supabase/migrations/20261005092958_monthly_charges.sql'];
const output = 'docs/monthly-charges/integration.diff';
function files(path) { return statSync(path).isDirectory() ? readdirSync(path).sort().flatMap(name=>files(join(path,name))) : [path]; }
let patch = execFileSync('git',['diff','--binary','HEAD','--',...tracked],{encoding:'utf8'});
const newFiles = extra.flatMap(files).filter(file=>file!==output).sort();
for (const file of newFiles) {
  const result = spawnSync('git',['diff','--no-index','--binary','--','/dev/null',file],{encoding:'utf8',maxBuffer:16*1024*1024});
  if (result.status !== 0 && result.status !== 1) throw new Error('Could not include '+file+': '+result.stderr);
  patch += result.stdout;
}
writeFileSync(output,patch);
console.log(JSON.stringify({output,trackedPaths:tracked.length,newFiles:newFiles.length,bytes:Buffer.byteLength(patch),indexChanged:false,preexistingPublisherDiffExcluded:true}));
