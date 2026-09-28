import { AsyncLocalStorage } from 'node:async_hooks';

export const publisherContext = new AsyncLocalStorage();
export function currentOperation() {
  const context = publisherContext.getStore();
  if (!context?.actor || typeof context.check !== 'function') throw new Error('Publisher authorization context required.');
  return context;
}
export async function beforeExternalCall() {
  await currentOperation().check();
}
