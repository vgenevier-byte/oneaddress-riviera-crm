import type { FonciereData } from "./model";
import type { FonciereDocumentCategory, LoadedFonciereProject } from "./repository";
import type { FonciereDraftIdentity } from "./creationKey";
export type FonciereLocalDraft = { data: FonciereData; sourceFiles: File[]; sourceFileCategories: FonciereDocumentCategory[]; loaded: LoadedFonciereProject | null; creationReconciled: boolean; recordComplete?: boolean; editingSection?: string | null; editBaseline?: { data: FonciereData; loaded: LoadedFonciereProject | null; sourceFiles: File[]; sourceFileCategories: FonciereDocumentCategory[] } | null; needsResume?: boolean; importSections?: string[]; updatedAt: string };
const databaseName = "oar-fonciere-drafts-v1", storeName = "drafts";
function key(identity: FonciereDraftIdentity) { return `${identity.scope}:${identity.draftId}`; }
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onerror = () => reject(new Error("Le brouillon local ne peut pas être conservé. Aucune nouvelle fiche n’a été créée."));
    request.onsuccess = () => resolve(request.result);
  });
}
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode), request = run(transaction.objectStore(storeName));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = transaction.onerror = () => reject(new Error("Le brouillon local n’a pas pu être conservé. Votre saisie reste dans cet onglet."));
    });
  } finally { db.close(); }
}
export async function readFonciereLocalDraft(identity: FonciereDraftIdentity): Promise<FonciereLocalDraft | undefined> { return transaction("readonly", store => store.get(key(identity))); }
export async function saveFonciereLocalDraft(identity: FonciereDraftIdentity, draft: FonciereLocalDraft): Promise<void> { await transaction("readwrite", store => store.put(draft, key(identity))); }
export async function deleteFonciereLocalDraft(identity: FonciereDraftIdentity): Promise<void> { await transaction("readwrite", store => store.delete(key(identity))); }
