export function isPrivateBlobUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith('.private.blob.vercel-storage.com')
    );
  } catch {
    return false;
  }
}
