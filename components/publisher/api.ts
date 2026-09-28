"use client";
import { useMemo } from 'react';
import { useScopedOperations, type ScopedOperation } from '@/lib/access/operations';
import type { CreationMode, CreativeDirection, GenerationProgressState, MusicStatus, PublisherMusic, PublisherPost } from './types';

export type GenerationState =
  | { state: 'empty' }
  | { state: 'preparing'; id: string | null; progress: GenerationProgressState }
  | { state: 'ready'; post: PublisherPost }
  | { state: 'error'; error: string; terminal?: boolean };

export class PublisherRequestError extends Error {
  constructor(message: string, readonly terminal = false) { super(message); }
}

/** Captures the CRM actor for every request and rejects responses after access changes. */
export function usePublisherApi() {
  const begin = useScopedOperations('publisher');
  return useMemo(() => {
    async function request<T>(action: string, body?: object, query?: Record<string, string>): Promise<T> {
      const op = await begin();
      return op.run(async () => {
        const response = await fetch(`/api/publisher?${new URLSearchParams({ action, ...query })}`, {
          method: body ? 'POST' : 'GET', cache: 'no-store', signal: op.signal,
          headers: { Authorization: `Bearer ${op.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new PublisherRequestError(data.error || 'Une erreur est survenue. Votre saisie est conservée.', data.terminal === true);
        return data as T;
      });
    }
    async function media(id: string, action: 'image' | 'export'): Promise<{ blob: Blob; operation: ScopedOperation }> {
      const operation = await begin();
      const blob = await operation.run(async () => {
        const response = await fetch(`/api/publisher?${new URLSearchParams({ action, id })}`, {
          cache: 'no-store', signal: operation.signal, headers: { Authorization: `Bearer ${operation.token}` },
        });
        if (!response.ok) throw new Error('Accès au média refusé ou média indisponible.');
        return response.blob();
      });
      return { blob, operation };
    }
    async function mutate<T extends { post: PublisherPost }>(action: string, body: object): Promise<T> {
      const result = await request<T>(action, body);
      if (!result.post?.id) throw new Error('Cette opération est encore en cours. Votre brouillon est conservé. Réessayez la même commande pour récupérer sa confirmation.');
      return result;
    }
    return {
      begin,
      today: () => request<GenerationState>('today'),
      generate: (mode: CreationMode, direction: CreativeDirection, requestId: string) => request<GenerationState>('generate', { mode, direction, requestId }),
      generationStatus: (identifier: { id?: string; requestId?: string }) => request<GenerationState>('status', undefined, Object.fromEntries(Object.entries(identifier).filter((entry): entry is [string, string] => Boolean(entry[1])))),
      history: () => request<{ posts: PublisherPost[] }>('history'),
      regenerateText: (post: PublisherPost, requestId: string) => mutate('regenerate-text', { id: post.id, revision: post.revision, requestId }),
      regenerateImage: (post: PublisherPost, requestId: string) => mutate('regenerate-image', { id: post.id, revision: post.revision, requestId }),
      setMusicStatus: (post: PublisherPost, id: number, status: MusicStatus, requestId: string) => mutate<{ music: PublisherMusic; post: PublisherPost }>('music-status', { postId: post.id, revision: post.revision, musicRevision: post.music.find(item => item.id === id)?.revision, id, status, requestId }),
      publish: (post: PublisherPost, musicId: number, requestId: string) => mutate('publish', { id: post.id, revision: post.revision, musicId, requestId }),
      copy: async (postId: string, value: string) => {
        const operation = await begin();
        await operation.run(async () => {
          const response = await fetch(`/api/publisher?${new URLSearchParams({ action: 'export-text', id: postId })}`, {
            cache: 'no-store', signal: operation.signal, headers: { Authorization: `Bearer ${operation.token}` },
          });
          if (!response.ok) throw new Error('Export du texte non autorisé.');
        });
        await operation.run(() => navigator.clipboard.writeText(value));
      },
      media,
    };
  }, [begin]);
}
export type PublisherApi = ReturnType<typeof usePublisherApi>;
