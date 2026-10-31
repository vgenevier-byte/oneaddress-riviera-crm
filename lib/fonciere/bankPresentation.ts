import type { SupabaseClient } from "@supabase/supabase-js";
import { ALL_NUM, BASE } from "../izord/finance";
import { assertImageByteBudget, assertEncodedImageBudget, encodedJpegLength } from "../izord/image-budget";
import { createProjectData, PHOTO_ROLES, type ProjectData } from "../izord/model";
import { createGeneratorRepository, type OperationOptions } from "../izord/repository";
import { toPresentationData, validateFonciereData, type FonciereData } from "./model";
import { createFonciereRepository, type FonciereAssetRecord, type StoredFoncierePayload } from "./repository";

type BankReservation = {
  presentationId?: string; revision?: number; token?: string; fingerprint?: string;
  ready?: boolean; blocked?: boolean; preparing?: boolean; needsUpdate?: boolean; reason?: string;
  snapshot?: { id: string; revision: number; title: string; project_reference: string; payload: StoredFoncierePayload };
  assets?: FonciereAssetRecord[];
};

/** Only the approved business snapshot enters the existing presentation mapper.
 * Arbitration remarks/history live in separate server records and are never input. */
export function bankPresentationData(data: FonciereData, source: { id: string; revision: number; reference: string; fingerprint: string }): ProjectData {
  const mapped = toPresentationData(data, source);
  // These initial generator assumptions are template values, not reviewed
  // financial hypotheses. Leave them to complete unless the saved value differs.
  const directlyMapped = new Set(["asking", "area", "land", "works", "resale", "weekly", "monthly", "rentedMonths", "weeks"]);
  for (const key of ALL_NUM) {
    if (!directlyMapped.has(key) && mapped.state[key] === BASE[key as keyof typeof BASE]) mapped.state[key] = "";
  }
  const prefix = `${source.reference} — `, suffix = " — Dossier bancaire";
  mapped.state.project = `${prefix}${data.name.slice(0, 200 - prefix.length - suffix.length)}${suffix}`;
  const missing = [
    ...([ ["address", "address"], ["asking", "asking"], ["area", "area"], ["acquisition", "acq"], ["financing", "finance"], ["works", "works"] ] as const)
      .filter(([, field]) => !String(mapped.state[field] ?? "").trim()).map(([label]) => label),
    ...(!PHOTO_ROLES.some(role => data.presentationData.photos[role] !== createProjectData().photos[role]) && !data.presentationData.importGallery.length ? ["photos"] : []),
  ];
  mapped.importMeta = { ...mapped.importMeta, fonciereBankApproval: { fingerprint: source.fingerprint }, fonciereBankMissing: missing };
  return mapped;
}

/** Persistent reservation + ordinary source/target ACLs. Retrying always finds
 * the principal presentation; an edited target is never overwritten here. */
export async function prepareBankPresentation(client: SupabaseClient, projectId: string, options: OperationOptions & {accessToken?:string} = {}): Promise<void> {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    options.signal?.throwIfAborted();
    let request = client.rpc(name, args);
    if (options.signal) request = request.abortSignal(options.signal);
    const result = await request;
    options.signal?.throwIfAborted();
    if (result.error) throw new Error("Présentation à préparer — intervention nécessaire. Vérifiez les droits et reprenez la préparation.");
    return result.data as T;
  }
  const reservation = await rpc<BankReservation>("fonciere_bank_prepare", { p_project: projectId });
  if (reservation.ready || reservation.preparing || reservation.needsUpdate) return;
  if (reservation.blocked) throw new Error("Présentation à préparer — intervention nécessaire. Les droits d’export du projet et de création/modification des présentations sont requis.");
  const { snapshot, assets, token, fingerprint, presentationId } = reservation;
  if (!snapshot || !assets || !token || !fingerprint || !presentationId) throw new Error("La préparation est en cours. Vérifiez son état avant de reprendre.");
  try {
    const generator = createGeneratorRepository(client,{accessToken:options.accessToken});
    const target = await generator.loadProject(presentationId, options);
    if (target.project.revision !== reservation.revision) {
      // A response may have been lost after a successful ordinary save. The
      // finalizer verifies the immutable approval marker on the server.
      await rpc("fonciere_bank_finish", { p_project: projectId, p_token: token, p_revision: target.project.revision });
      return;
    }
    const data = structuredClone(snapshot.payload.data), empty = createProjectData();
    const references = [...PHOTO_ROLES.map(role => data.presentationData.photos[role]), ...data.presentationData.importGallery.map(photo => photo.data)].filter(Boolean);
    const declared = references.map(id => ({ id, bytes: assets.find(asset => asset.id === id)?.expected_size || 0 }));
    assertImageByteBudget(declared);
    assertEncodedImageBudget(declared.map(asset => encodedJpegLength(asset.bytes)));
    const source = createFonciereRepository(client,{accessToken:options.accessToken}), downloaded = new Map<string, Blob>();
    async function download(id: string) {
      options.signal?.throwIfAborted();
      const asset = assets!.find(item => item.id === id && item.project_id === projectId && item.lifecycle === "finalized");
      if (!asset) throw new Error("Un document approuvé n’est plus disponible. La présentation est conservée pour reprise.");
      if (!downloaded.has(id)) downloaded.set(id, await source.downloadAsset(asset, options));
      return downloaded.get(id)!;
    }
    async function image(id: string, fallback: string): Promise<string> {
      if (!id) return fallback;
      const blob = await download(id), bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      return `data:${blob.type};base64,${btoa(binary)}`;
    }
    for (const role of PHOTO_ROLES) data.presentationData.photos[role] = await image(data.presentationData.photos[role], empty.photos[role]);
    for (const photo of data.presentationData.importGallery) photo.data = await image(photo.data, empty.photos.main);
    const sourceFiles: File[] = [];
    for (const id of snapshot.payload.sourceDocuments) {
      const asset = assets.find(item => item.id === id);
      if (!asset || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(asset.expected_mime)) continue;
      sourceFiles.push(new File([await download(id)], asset.original_name, { type: asset.expected_mime }));
    }
    const mapped = bankPresentationData(validateFonciereData(data), { id: snapshot.id, revision: snapshot.revision, reference: snapshot.project_reference, fingerprint });
    const saved = await generator.saveProject({ project: target.project, previous: target, data: mapped, status: "draft", sourceFiles,transferKey:`bank:${fingerprint}` }, options);
    await rpc("fonciere_bank_finish", { p_project: projectId, p_token: token, p_revision: saved.project.revision });
  } catch (error) {
    // Best effort records an actionable resumable state. A committed save after
    // a lost network reply is detected by prepare/finalize on the next attempt.
    try { await rpc("fonciere_bank_fail", { p_project: projectId, p_token: token, p_reason: "preparation_failed" }); } catch { /* Retry uses the durable principal link. */ }
    throw error;
  }
}
