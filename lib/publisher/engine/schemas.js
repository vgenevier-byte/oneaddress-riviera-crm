import { z } from 'zod';
import { THEMES } from './constants.js';
import { normalizeHashtags } from './rules.js';
import { validateCarContext } from './cars.js';

const FRENCH_MARKERS = new Set([
  'au', 'aux', 'avec', 'ce', 'cette', 'dans', 'de', 'des', 'du', 'en', 'est',
  'et', 'la', 'le', 'les', 'notre', 'nous', 'pour', 'qui', 'que', 'son', 'sur',
  'une', 'votre', 'vous',
]);

const ENGLISH_MARKERS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'for', 'from', 'in', 'is', 'of', 'on',
  'over', 'the', 'this', 'to', 'where', 'with', 'your',
]);

const FICTIONAL_VENUE_PATTERN = /\b(hotel|hôtel|restaurant|villa|property|propriété|estate|residence|résidence|penthouse|apartment|appartement|château|chalet|address|adresse|rue|avenue|boulevard|road|street|suite|resort|palace|beach club|marina|harbour|harbor|port|gallery|boutique|spa|rooftop|venue|maison)\b/iu;
const MusicSuggestionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  artist: z.string().trim().min(1).max(120),
});

const LocationSchema = z.preprocess(
  value => normalizeLocationValue(value),
  z.enum(['Aucun', 'French Riviera', 'Côte d’Azur']),
);

export const CreativePlanSchema = z.object({
  scene_summary: z.string().trim().min(12).max(320),
  visual_signature: z.string().trim().min(8).max(180),
  image_prompt: z.string().trim().min(80).max(1800),
  format: z.enum(['Feed 4:5', 'Reel']),
});

export const EditorialPackageSchema = z.object({
  caption: z.string().trim().min(20).max(500),
  hashtags: z.array(z.string().trim().min(2).max(60)).length(4),
  music: z.array(MusicSuggestionSchema).length(3),
  location: z.string().trim().min(1),
});

export const GeneratedPostSchema = z.object({
  theme: z.enum(THEMES),
  moment: z.string().trim().min(3).max(80),
  scene_summary: z.string().trim().min(12).max(320),
  visual_signature: z.string().trim().min(8).max(180),
  image_prompt: z.string().trim().min(80).max(1800),
  caption: z.string().trim().min(20).max(500),
  hashtags: z.array(z.string().trim().min(2).max(60)).length(4),
  music: z.array(MusicSuggestionSchema).length(3),
  location: LocationSchema,
  format: z.enum(['Feed 4:5', 'Reel']),
});

export const RegeneratedTextSchema = z.object({
  caption: z.string().trim().min(20).max(500),
  hashtags: z.array(z.string().trim().min(2).max(60)).length(4),
});

export const RegeneratedImagePromptSchema = z.object({
  image_prompt: z.string().trim().min(80).max(1800),
  visual_signature: z.string().trim().min(8).max(180),
});

const BOOKING_PATTERN = /\b(?:book|reserve|booking|reservation)\b/iu;
const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[\uFE0F\u200D\u20E3]/gu;

function bookingContext(context) {
  // Only the server-locked catalogue snapshot can supply a vehicle identity.
  // Never resolve a vehicle here: old posts keep their original attribution.
  const subject = normalizedWords([context.theme, context.creative_universe, context.universe].join(' ')).join(' ');
  if (/\b(automobile|voitures|cars)\b/.test(subject)) {
    const car = validateCarContext(context.car_context ?? context.carContext);
    return { kind: 'ride', identity: car ? `${car.manufacturer} ${car.model}` : '', hook: 'Let the coastal road awaken your senses.' };
  }
  if (/\b(yacht|bateaux|boats)\b/.test(subject)) return { kind: 'yacht experience', hook: 'Drift into the quiet rhythm of the Mediterranean.' };
  if (/\b(immobilier|real estate|hotel|stay|villa|sejour)\b/.test(subject)) return { kind: 'stay', hook: 'Imagine slow mornings beneath the Riviera sun.' };
  if (/\b(voyage|voyages|travel|trip)\b/.test(subject)) return { kind: 'trip', hook: 'Let the Riviera inspire your next journey.' };
  return { kind: 'escape', hook: 'Let the Riviera awaken your sense of escape.' };
}

function invitationSubject({ kind, identity }) {
  if (kind !== 'ride' || !identity) return kind;
  // Locked identities begin with the canonical catalogue manufacturer.
  const article = /^[aeiou]/iu.test(identity) ? 'an' : 'a';
  return `ride in ${article} ${identity}`;
}

function fallbackInvitation(context) {
  const { kind } = context;
  const experience = invitationSubject(context);
  return `Book your next ${experience} ${['stay', 'ride', 'yacht experience'].includes(kind) ? 'on' : 'to'} the French Riviera with One Address Riviera.`;
}

function captionWordCount(value) {
  // Retain the existing conservative language-token limit as well as counting
  // numbered model names and other tokens separated by spaces.
  return Math.max(normalizedWords(value).length, value.trim().split(/\s+/u).filter(Boolean).length);
}

function validInvitation(value, context) {
  if (!/^(?:book|reserve|don['’]t forget to book)\b/iu.test(value)
    || (value.match(/\b(?:book|reserve)\b/giu) || []).length !== 1
    || !/\b(?:with|through) One Address Riviera\b/u.test(value)
    || !value.includes('French Riviera')) return false;
  const subject = invitationSubject(context);
  if (!value.includes(subject)) return false;
  // A model may vary the invitation naturally using this bounded vocabulary.
  // Anything else (prices, dates, availability, ownership, partnerships or an
  // untrusted vehicle name) is replaced by the contextual invitation above.
  const remainder = value.replace(context.identity || /$^/, '').replace('One Address Riviera', '').replace('French Riviera', '').replace(subject, '');
  const safeWords = new Set(['book', 'reserve', 'don', 't', 'forget', 'to', 'your', 'next', 'a', 'an', 'on', 'the', 'with', 'through', 'in', 'stay', 'escape', 'trip', 'ride', 'yacht', 'experience']);
  return !/\d/u.test(remainder) && normalizedWords(remainder).every(word => safeWords.has(word));
}

export function cleanCaption(value, context = {}) {
  const normalized = String(value || '').replace(EMOJI_PATTERN, '').replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim();
  // A space after terminal punctuation marks a sentence even before a number.
  // Decimal model names such as Veyron 16.4 retain their internal full stop.
  const sentences = normalized.split(/(?<=[.!?])(?:\s+|(?=[A-Za-z]))/u).filter(Boolean);
  const booking = bookingContext(context);
  const ambience = sentences.find(sentence => !BOOKING_PATTERN.test(sentence));
  // Check the hook independently: adding an English CTA must not hide French.
  if (ambience) assertEnglishCaption(ambience);
  // A legacy car has no reliable identity at all, including in its old hook.
  let hook = booking.kind === 'ride' && !booking.identity ? booking.hook : ambience || booking.hook;
  hook = hook.replace(/[.!?]+$/u, '').trim() + '.';
  const candidate = sentences.findLast(sentence => BOOKING_PATTERN.test(sentence));
  let invitation = candidate && validInvitation(candidate, booking)
    ? candidate.replace(/[.!?]+$/u, '').trim() + '.' : fallbackInvitation(booking);
  // Keep the invitation intact. A long mood sentence gives way to a compact,
  // grammatical hook rather than truncating the commercial sentence.
  if (captionWordCount(`${hook} ${invitation}`) > 36 || `${hook} ${invitation}`.length > 500) hook = booking.hook;
  if (captionWordCount(`${hook} ${invitation}`) > 36 || `${hook} ${invitation}`.length > 500) invitation = fallbackInvitation(booking);
  const caption = `${hook} ${invitation}`;
  assertEnglishShortCaption(caption);
  if (captionWordCount(caption) > 36 || caption.length > 500) throw new Error('La légende générée doit rester courte.');
  return caption;
}

function normalizedWords(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .match(/[a-z]+/g) || [];
}

export function normalizeLocationValue(value) {
  const normalized = normalizedWords(value).join(' ');
  if (normalized === 'french riviera') return 'French Riviera';
  if (normalized === 'cote d azur') return 'Côte d’Azur';
  return 'Aucun';
}

function assertEnglishCaption(value) {
  const words = normalizedWords(value);
  const frenchScore = words.filter(word => FRENCH_MARKERS.has(word)).length;
  const englishScore = words.filter(word => ENGLISH_MARKERS.has(word)).length;
  if (frenchScore >= 2 && frenchScore >= englishScore) {
    throw new Error('La légende générée doit être en anglais, jamais en français.');
  }
  if (words.length > 6 && englishScore === 0) {
    throw new Error('La légende générée doit être en anglais.');
  }
  return value;
}

export function assertEnglishShortCaption(value) {
  assertEnglishCaption(value);
  if (captionWordCount(value) > 36) {
    throw new Error('La légende générée doit rester courte.');
  }
  return value;
}

export function normalizeGeneratedLocation(post) {
  const context = [
    post.theme,
    post.scene_summary,
    post.visual_signature,
    post.image_prompt,
  ].join(' ');
  const isFictionalVenue = ['immobilier', 'hôtel'].includes(post.theme)
    || FICTIONAL_VENUE_PATTERN.test(context);
  return isFictionalVenue ? 'Aucun' : normalizeLocationValue(post.location);
}

export function normalizeGeneratedPost(value, context = {}) {
  const parsed = GeneratedPostSchema.parse(value);
  const caption = cleanCaption(parsed.caption, { ...parsed, ...context });
  return {
    ...parsed,
    caption,
    hashtags: normalizeHashtags(parsed.hashtags),
    location: normalizeGeneratedLocation(parsed),
  };
}

export function normalizeRegeneratedText(value, context = {}) {
  const parsed = RegeneratedTextSchema.parse(value);
  return {
    caption: cleanCaption(parsed.caption, context),
    hashtags: normalizeHashtags(parsed.hashtags),
  };
}
