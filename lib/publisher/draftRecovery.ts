import type { CreationMode, CreativeDirection, PublisherPost } from '@/components/publisher/types';

export type PublisherDraft = {
  userId: string;
  accessRevision: number;
  post: PublisherPost | null;
  mode: CreationMode;
  direction: { [K in keyof CreativeDirection]: CreativeDirection[K] | '' };
  selectedMusic?: number;
  requests?: Record<string, string>;
};
let held: PublisherDraft | null = null;
/** Memory only: AccessPortal clears this on logout, denial or changed permissions. */
export function readPublisherDraft(userId: string, accessRevision: number) {
  return held?.userId === userId && held.accessRevision === accessRevision ? held : null;
}
export function capturePublisherDraft(draft: PublisherDraft) { held = draft; }
export function clearPublisherDrafts() { held = null; }
