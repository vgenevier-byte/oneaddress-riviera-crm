// Availability belongs to this Instagram account and publishing surface. A
// catalogue flag (including historical "available") is never verification.
export const MUSIC_ACCOUNT = 'one-address-riviera';
export const MUSIC_ACCOUNT_LABEL = 'One Address Riviera';

export function musicContextForFormat(format) {
  return { account: MUSIC_ACCOUNT, account_label: MUSIC_ACCOUNT_LABEL,
    context: /^reel(?:\s|$)/i.test(String(format || '')) ? 'reel' : 'feed' };
}

export function musicIdentity(song) {
  return [song.title, song.artist, song.version].map(value => String(value || '').trim().toLocaleLowerCase('fr')).join('::');
}

export function hydrateMusic(song, scope = musicContextForFormat('Feed 4:5')) {
  const checks = Array.isArray(song.verification_history) ? song.verification_history : song.verification ? [song.verification] : [];
  const verification = checks.filter(check => check.account === scope.account && check.context === scope.context)
    .sort((left, right) => new Date(right.checked_at).getTime() - new Date(left.checked_at).getTime() || Number(right.id || 0) - Number(left.id || 0))[0] || null;
  const valid = verification && scope.account === MUSIC_ACCOUNT && ['feed', 'reel'].includes(scope.context)
    && verification.method === 'manual_instagram' && Boolean(verification.checked_at)
    && Number.isFinite(new Date(verification.checked_at).getTime())
    && verification.title === song.title && verification.artist === song.artist
    && String(verification.version || '') === String(song.version || '');
  const proof = valid ? { ...verification, account_label: MUSIC_ACCOUNT_LABEL } : null;
  // Preserve an existing negative report without inventing its scope or date.
  // Positive legacy flags still never establish Instagram availability.
  const legacyStatus = song.legacy_availability_status || song.availability_status || 'unknown';
  return {
    id: Number(song.id), revision: Number(song.revision), title: song.title, artist: song.artist,
    version: song.version || null, source: song.source || 'legacy_catalogue',
    availability_status: proof?.status === 'confirmed' ? 'available' : proof?.status === 'not_found'
      || (!proof && legacyStatus === 'unavailable') ? 'unavailable' : 'unknown',
    legacy_availability_status: legacyStatus,
    instagram_audio_id: proof?.instagram_audio_id || null,
    instagram_audio_url: proof?.instagram_audio_url || null,
    verification: proof, last_used_at: song.last_used_at, times_used: Number(song.times_used || 0),
  };
}

export function isConfirmedMusic(song, scope = song.verification
  ? { account: MUSIC_ACCOUNT, context: song.verification.context }
  : musicContextForFormat('Feed 4:5')) {
  const hydrated = hydrateMusic(song, scope);
  return hydrated.availability_status === 'available' && hydrated.verification?.status === 'confirmed';
}

export function validatedInstagramAudio(value) {
  if (!value) return null;
  let parsed;
  try { parsed = new URL(value); } catch { throw new TypeError('Lien audio Instagram invalide.'); }
  if (parsed.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(parsed.hostname)
    || parsed.username || parsed.password || parsed.port || !/^\/reels\/audio\/\d+\/?$/.test(parsed.pathname)) throw new TypeError('Lien audio Instagram invalide.');
  return parsed.href;
}
