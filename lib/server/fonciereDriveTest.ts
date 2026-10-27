import "server-only";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { copyOriginalToDrive, FonciereDriveError, reserveDriveId, validateProjetsRoot, type DriveConfig, type DriveJob, type FonciereDriveFetch, type FonciereDriveStore } from "./fonciereDrive";

/** Explicitly authorized operational check. Every creation is fictional, confined
 * to one dedicated test folder. Only this invocation's known IDs may be trashed. */
export async function testFonciereDriveIntegration(store: FonciereDriveStore, fetchDrive: FonciereDriveFetch, sharedDriveId: string) {
  const config = await store.call<DriveConfig>("get_config");
  if (config.shared_drive_id !== sharedDriveId) throw new FonciereDriveError("drive_configuration_conflict", true);
  await validateProjetsRoot(fetchDrive, config);
  const runId = randomUUID(), folderId = await reserveDriveId(fetchDrive);
  const known = new Map<string, string>([[folderId, "folder"]]);
  const readbacks: Array<{ name: string; mime: string; bytes: number; sha256: string; replayConfirmed: boolean }> = [];
  let cleanup = true, result: { verified: boolean; files: typeof readbacks; lostResponseRecovered: boolean; cleanup: boolean; testRunId: string; testFolderId: string } | undefined;
  try {
    const folder = await fetchDrive("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: folderId, name: `TEST CRM - Foncière - ${runId}`, mimeType: "application/vnd.google-apps.folder", parents: [config.root_folder_id], appProperties: { managedBy: "oar-fonciere-test", testRunId: runId } }), signal: AbortSignal.timeout(15000) });
    if (!folder.ok) throw new FonciereDriveError("drive_test_folder_failed");
    const image = sharp({ create: { width: 48, height: 32, channels: 3, background: { r: 17, g: 88, b: 145 } } });
    const pdf = Buffer.from("%PDF-1.4\n% Fictional CRM Drive copy verification only.\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n");
    const largePdf = Buffer.concat([pdf, Buffer.alloc(5 * 1024 * 1024 + 17, 32)]);
    const cases = [{ name: "piece-fictive.pdf", mime: "application/pdf", bytes: pdf }, { name: "piece-fictive.pdf", mime: "application/pdf", bytes: largePdf }, { name: "photo-fictive.jpg", mime: "image/jpeg", bytes: await image.clone().jpeg().toBuffer() }, { name: "photo-fictive.png", mime: "image/png", bytes: await image.clone().png().toBuffer() }, { name: "photo-fictive.webp", mime: "image/webp", bytes: await image.clone().webp().toBuffer() }];
    let lostResponseRecovered = false;
    for (const [index, item] of cases.entries()) {
      const id = await reserveDriveId(fetchDrive), assetId = randomUUID();
      known.set(id, assetId);
      const job: DriveJob = { id: randomUUID(), project_id: runId, asset_id: assetId, job_type: "file", title: "Projet fictif", project_reference: "PRJ-TEST", category: "other", expected_size: item.bytes.length, expected_mime: item.mime, object_path: `${runId}/${assetId}`, original_name: item.name, storage_object_version: randomUUID(), reserved_file_id: id, attempts: 1, lease_token: randomUUID() };
      let simulatedLoss = false;
      const ambiguousFetch: FonciereDriveFetch = async (input, init) => {
        const response = await fetchDrive(input, init);
        if (index === 0 && init?.method === "PUT" && response.ok && !simulatedLoss) { simulatedLoss = true; throw new Error("Fictional lost response after successful Google creation"); }
        return response;
      };
      const original = new Blob([new Uint8Array(item.bytes)], { type: item.mime });
      await copyOriginalToDrive(ambiguousFetch, job, original, folderId, sharedDriveId, id);
      let replayCreates = 0;
      await copyOriginalToDrive(async (input, init) => { if (init?.method === "POST") replayCreates++; return fetchDrive(input, init); }, job, original, folderId, sharedDriveId, id);
      const reread = await fetchDrive(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { cache: "no-store", signal: AbortSignal.timeout(45000) });
      if (!reread.ok) throw new FonciereDriveError("drive_test_readback_failed");
      const returned = Buffer.from(await reread.arrayBuffer()), sha256 = createHash("sha256").update(item.bytes).digest("hex");
      if (returned.length !== item.bytes.length || createHash("sha256").update(returned).digest("hex") !== sha256 || replayCreates !== 0) throw new FonciereDriveError("drive_test_content_mismatch", true);
      if (simulatedLoss) lostResponseRecovered = true;
      readbacks.push({ name: item.name, mime: item.mime, bytes: item.bytes.length, sha256, replayConfirmed: replayCreates === 0 });
    }
    result = { verified: true, files: readbacks, lostResponseRecovered, cleanup: false, testRunId: runId, testFolderId: folderId };
  } finally {
    for (const [id, asset] of [...known.entries()].reverse()) {
      try {
        const response = await fetchDrive(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,appProperties`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
        if (response.status === 404) continue;
        if (!response.ok) { cleanup = false; continue; }
        const metadata = await response.json();
        if (asset === "folder" ? metadata.appProperties?.managedBy !== "oar-fonciere-test" || metadata.appProperties?.testRunId !== runId : metadata.appProperties?.managedBy !== "oar-fonciere" || metadata.appProperties?.projectId !== runId || metadata.appProperties?.assetId !== asset) { cleanup = false; continue; }
        const removed = await fetchDrive(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,trashed`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ trashed: true }), signal: AbortSignal.timeout(10000) });
        if (!removed.ok || (await removed.json()).trashed !== true) cleanup = false;
      } catch { cleanup = false; }
    }
    if (result) result.cleanup = cleanup;
  }
  return result;
}
