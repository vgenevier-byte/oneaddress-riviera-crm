import {
  CONTENT_COOLDOWN_DAYS,
  CONTEXTUAL_HASHTAGS,
  CREATIVE_MOMENTS,
  CREATIVE_STYLES,
  CREATIVE_UNIVERSES,
  GENERATION_LEASE_MINUTES,
  THEMES,
} from './constants.js';

export function normalizeCreativeDirection(value) {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Direction créative incomplète.');
  }
  const universeKey = value.universeKey || value.universe;
  const momentKey = value.momentKey || value.moment;
  const styleKey = value.styleKey || value.style;
  const universe = CREATIVE_UNIVERSES[universeKey];
  const moment = CREATIVE_MOMENTS[momentKey];
  const style = CREATIVE_STYLES[styleKey];
  if (!universe || !moment || !style) {
    throw new TypeError('Direction créative invalide.');
  }
  return {
    universeKey,
    universe: universe.label,
    theme: universe.theme,
    universeGuidance: universe.guidance,
    momentKey,
    moment: moment.label,
    momentGuidance: moment.guidance,
    styleKey,
    style: style.label,
    styleGuidance: style.guidance,
  };
}

export function normalizeMusicKey(title, artist) {
  return `${String(title || '').trim().toLocaleLowerCase('fr')}::${String(
    artist || '',
  )
    .trim()
    .toLocaleLowerCase('fr')}`;
}

export function isRecent(value, now = new Date(), days = CONTENT_COOLDOWN_DAYS) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return now.getTime() - timestamp < days * 24 * 60 * 60 * 1000;
}

export function eligibleMusic(music, recentMusicIds = [], now = new Date()) {
  const recent = new Set(recentMusicIds.map(Number));
  return music
    .filter(song => song.availability_status !== 'unavailable')
    .filter(song => !recent.has(Number(song.id)))
    .filter(song => !isRecent(song.last_used_at, now))
    .sort((left, right) => {
      const priority = { available: 0, unknown: 1 };
      const statusDifference =
        (priority[left.availability_status] ?? 2) -
        (priority[right.availability_status] ?? 2);
      if (statusDifference !== 0) return statusDifference;
      const leftTime = left.last_used_at
        ? new Date(left.last_used_at).getTime()
        : 0;
      const rightTime = right.last_used_at
        ? new Date(right.last_used_at).getTime()
        : 0;
      return leftTime - rightTime;
    });
}

export function chooseMusic(eligible, suggested, count = 3) {
  const suggestionOrder = new Map(
    suggested.map((song, index) => [normalizeMusicKey(song.title, song.artist), index]),
  );
  const ordered = [...eligible].sort((left, right) => {
    const leftAvailable = left.availability_status === 'available' ? 0 : 1;
    const rightAvailable = right.availability_status === 'available' ? 0 : 1;
    if (leftAvailable !== rightAvailable) return leftAvailable - rightAvailable;
    const leftSuggested =
      suggestionOrder.get(normalizeMusicKey(left.title, left.artist)) ?? 10_000;
    const rightSuggested =
      suggestionOrder.get(normalizeMusicKey(right.title, right.artist)) ?? 10_000;
    return leftSuggested - rightSuggested;
  });

  const seen = new Set();
  return ordered.filter(song => {
    const key = normalizeMusicKey(song.title, song.artist);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, count);
}

export function chooseTheme(history, dateKey) {
  const recentlyUsed = new Set(history.slice(0, 7).map(post => post.theme));
  const available = THEMES.filter(theme => !recentlyUsed.has(theme));
  const pool = available.length ? available : THEMES;
  const dayNumber = Math.floor(new Date(`${dateKey}T12:00:00Z`).getTime() / 86_400_000);
  return pool[Math.abs(dayNumber) % pool.length];
}

export function normalizeHashtags(values) {
  const normalized = [];
  const seen = new Set();
  const candidates = [...values, ...CONTEXTUAL_HASHTAGS];

  for (const raw of candidates) {
    const compact = String(raw || '').replace(/[^\p{L}\p{N}_]/gu, '');
    if (!compact) continue;
    const hashtag = `#${compact}`;
    const key = hashtag.toLocaleLowerCase('fr');
    if (key === '#oneaddressriviera' || seen.has(key)) continue;
    seen.add(key);
    normalized.push(hashtag);
    if (normalized.length === 4) break;
  }

  return ['#OneAddressRiviera', ...normalized];
}

export function generationClaimDecision(post, now = new Date()) {
  if (!post) return 'claim';
  if (post.generation_status === 'ready') return 'ready';
  if (post.generation_status === 'error') return 'claim';
  if (post.generation_status !== 'generating') return 'claim';

  const startedAt = new Date(post.generation_started_at).getTime();
  const lease = GENERATION_LEASE_MINUTES * 60 * 1000;
  return now.getTime() - startedAt >= lease ? 'claim' : 'wait';
}

export function todayInTimezone(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function normalizeDateKey(value) {
  let dateKey;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new TypeError('Date Publisher invalide.');
    }
    dateKey = value.toISOString().slice(0, 10);
  } else if (typeof value === 'string') {
    const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
    dateKey = match?.[1];
  }

  if (!dateKey) throw new TypeError('Date Publisher invalide.');
  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== dateKey
  ) {
    throw new TypeError('Date Publisher invalide.');
  }
  return dateKey;
}

const CONTENT_STOPWORDS = new Set([
  'a', 'an', 'and', 'at', 'avec', 'dans', 'de', 'des', 'du', 'en', 'et', 'for',
  'from', 'in', 'la', 'le', 'les', 'of', 'on', 'pour', 'sur', 'the', 'to',
  'vertical', 'editorial', 'premium', 'photograph', 'photography', 'photo',
  'riviera', 'french', 'luxury', 'natural',
]);

const CONTENT_SYNONYMS = new Map([
  ['anchored', 'anchor'],
  ['anchoring', 'anchor'],
  ['moored', 'anchor'],
  ['mooring', 'anchor'],
  ['boat', 'yacht'],
  ['vessel', 'yacht'],
  ['evening', 'sunset'],
  ['dusk', 'sunset'],
  ['coastline', 'coast'],
  ['coastal', 'coast'],
  ['cliffs', 'cliff'],
  ['terraces', 'terrace'],
]);

function comparableContent(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function comparableTokens(value) {
  const tokens = comparableContent(value).split(' ').filter(Boolean);
  return new Set(tokens
    .map(token => CONTENT_SYNONYMS.get(token) || token)
    .filter(token => token.length > 2 && !CONTENT_STOPWORDS.has(token)));
}

export function contentSimilarity(left, right) {
  const leftTokens = comparableTokens(left);
  const rightTokens = comparableTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = leftTokens.size + rightTokens.size - intersection;
  const jaccard = intersection / union;
  const containment = intersection / Math.min(leftTokens.size, rightTokens.size);
  return Math.max(jaccard, containment * 0.85);
}

export function hasRecentContentDuplicate(candidate, recentPosts) {
  return recentPosts.some(post => {
    const sceneSimilarity = contentSimilarity(
      candidate.scene_summary,
      post.scene_summary,
    );
    const visualSimilarity = contentSimilarity(
      candidate.visual_signature,
      post.visual_signature,
    );
    const combinedSimilarity = contentSimilarity(
      `${candidate.scene_summary} ${candidate.visual_signature}`,
      `${post.scene_summary} ${post.visual_signature}`,
    );
    const candidateCaption = comparableContent(candidate.caption);
    const previousCaption = comparableContent(post.caption);
    const exactCaption = Boolean(candidateCaption)
      && candidateCaption === previousCaption;
    return (
      exactCaption ||
      sceneSimilarity >= 0.52 ||
      visualSimilarity >= 0.58 ||
      (sceneSimilarity >= 0.38 && visualSimilarity >= 0.38) ||
      combinedSimilarity >= 0.5
    );
  });
}
