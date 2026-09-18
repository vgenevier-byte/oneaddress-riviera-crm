import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectData } from '../../lib/izord/model';
import { draftTarget, reducedIzordRole, resumeGeneratorDraft, temporaryAccessFailure, type DraftRecovery, type VerifiedDraftProject } from '../../lib/izord/draftRecovery';
import type { LoadedProject } from '../../lib/izord/repository';
function recovery(existing = true): DraftRecovery {
  const data = createProjectData(); data.state.acq = '612345'; data.state.decision = 'GO';
  return { userId: 'fixture-account-a', workspace: 'izord', role: 'contributor', draft: {
    draftId: 'fixture-draft', data, dirty: true, workflow: 'approved', conflict: false,
    loaded: existing ? { project: { id: 'fixture-project', revision: 2, status: 'draft', payload: {} }, data, assets: [{id: 'old-asset'}], sourceDocuments: [] } as unknown as LoadedProject : null,
    sourceFiles: [new File(['fixture'], 'fixture.pdf')], reports: [], reportIndex: 0, reviewed: false, pdfFiles: [],
  }};
}
const project: VerifiedDraftProject = { id: 'fixture-project', revision: 3, status: 'review', payload: {data:{state:{decision:'À examiner'}}} };
test('transient transport failures are distinct from denied credentials/rights', () => {
  for(const status of [0,408,429,500,503,504]) assert.equal(temporaryAccessFailure({status}),true);
  for(const status of [400,401,403,404]) assert.equal(temporaryAccessFailure({status}),false);
  assert.equal(temporaryAccessFailure(new TypeError('network')),true);
  assert.equal(temporaryAccessFailure(new Error('unknown')),false);
});
test('same account/project retains draft values/files and old revision; official state comes from current server', () => {
  const held=recovery(), resumed=resumeGeneratorDraft(held,held.userId,held.role,project)!;
  assert.equal(resumed.data?.state.acq,'612345'); assert.equal(resumed.loaded?.project.revision,2);
  assert.equal(resumed.workflow,'review'); assert.equal(resumed.loaded?.project.status,'review');
  assert.equal(resumed.data?.state.decision,'À examiner'); assert.deepEqual(resumed.loaded?.assets,[]);
  assert.equal(resumed.sourceFiles,held.draft.sourceFiles); assert.equal(resumed.dirty,true);
  assert.equal(held.draft.data?.state.decision,'GO'); assert.equal(held.draft.loaded?.project.status,'draft');
});
test('different identity, missing or different project cannot recover', () => {
  const held=recovery(); assert.equal(resumeGeneratorDraft(held,'fixture-b',held.role,project),undefined);
  assert.equal(resumeGeneratorDraft(held,held.userId,held.role,null),undefined);
  assert.equal(resumeGeneratorDraft(held,held.userId,held.role,{...project,id:'another'}),undefined);
});
test('reader and any role reduction receive none of the old writer draft', () => {
  const held=recovery(); assert.equal(resumeGeneratorDraft(held,held.userId,'reader',project),undefined);
  assert.equal(reducedIzordRole('admin','partner'),true);
  assert.equal(reducedIzordRole('partner','contributor'),true);
  assert.equal(reducedIzordRole('contributor','unknown'),true);
  assert.equal(reducedIzordRole('contributor','partner'),false);
});
test('new draft retains its identity and files with no manufactured saved revision', () => {
  const held=recovery(false), resumed=resumeGeneratorDraft(held,held.userId,held.role,null)!;
  assert.equal(resumed.loaded,null); assert.equal(resumed.draftId,'fixture-draft');
  assert.equal(resumed.workflow,'draft'); assert.equal(resumed.data?.state.acq,'612345');
  assert.equal(resumed.sourceFiles,held.draft.sourceFiles);
  assert.equal(resumeGeneratorDraft(held,held.userId,held.role,project),undefined);
});
test('target binds explicit draft, project and original revision, including unsaved drafts', () => {
  const held=recovery(); assert.equal(draftTarget(held.draft),'fixture-draft:fixture-project:2');
  assert.notEqual(draftTarget({...held.draft,draftId:'replacement'}),draftTarget(held.draft));
  assert.equal(draftTarget(recovery(false).draft),'fixture-draft:new:new');
});
