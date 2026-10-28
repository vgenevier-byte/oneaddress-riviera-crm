/** Display preferences belong to this browser session, outside project/draft data. */
export const PROJECT_SECTION_IDS = ["identity", "agency", "property", "description", "additional", "hypotheses", "documents", "arbitrage"] as const;
export type ProjectSectionId = typeof PROJECT_SECTION_IDS[number];
export type ProjectSectionIdentity = { kind: "project" | "draft"; id: string };
type SectionStorage = Pick<Storage, "getItem" | "setItem">;
const PREFIX = "oar:fonciere:project-sections:v1:";

function storageForSession(storage?: SectionStorage): SectionStorage | undefined {
  try { return storage ?? (typeof window === "undefined" ? undefined : window.sessionStorage); }
  catch { return undefined; }
}
function keyFor(userId: string, identity: ProjectSectionIdentity): string | undefined {
  // A missing identity must never create an account-wide or draft-wide slot.
  return userId && identity.id ? PREFIX + JSON.stringify([userId, identity.kind, identity.id]) : undefined;
}
function normalized(values: Iterable<string>): Set<ProjectSectionId> {
  const supplied = new Set(values);
  return new Set(PROJECT_SECTION_IDS.filter(id => supplied.has(id)));
}
export function initialProjectSections(identity: ProjectSectionIdentity): Set<ProjectSectionId> {
  return new Set(identity.kind === "draft" ? ["identity"] : []);
}
export function readProjectSections(userId: string, identity: ProjectSectionIdentity, storage?: SectionStorage): Set<ProjectSectionId> {
  try {
    const key = keyFor(userId, identity), raw = key ? storageForSession(storage)?.getItem(key) : null;
    if (raw != null) {
      const values: unknown = JSON.parse(raw);
      if (Array.isArray(values) && values.every(value => typeof value === "string")) return normalized(values);
    }
  } catch { /* An unavailable preference store must not block the editor. */ }
  return initialProjectSections(identity);
}
export function writeProjectSections(userId: string, identity: ProjectSectionIdentity, open: Iterable<string>, storage?: SectionStorage): void {
  try {
    const key = keyFor(userId, identity);
    if (key) storageForSession(storage)?.setItem(key, JSON.stringify([...normalized(open)]));
  } catch { /* Live component state remains authoritative if session storage fails. */ }
}

/** Copy without deleting the source: draft recovery may still use its durable ID. */
export function copyProjectSections(userId: string, source: ProjectSectionIdentity, target: ProjectSectionIdentity, storage?: SectionStorage): Set<ProjectSectionId> {
  const open = readProjectSections(userId, source, storage);
  writeProjectSections(userId, target, open, storage);
  return open;
}
