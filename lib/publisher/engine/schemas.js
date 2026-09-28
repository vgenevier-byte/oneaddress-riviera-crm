import { z } from 'zod';
import { THEMES } from './constants.js';
import { normalizeHashtags } from './rules.js';

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

export function cleanCaption(value) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  return sentences.slice(0, 2).map(sentence => sentence.trim()).join(' ').slice(0, 500);
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

export function assertEnglishShortCaption(value) {
  const words = normalizedWords(value);
  const frenchScore = words.filter(word => FRENCH_MARKERS.has(word)).length;
  const englishScore = words.filter(word => ENGLISH_MARKERS.has(word)).length;
  if (frenchScore >= 2 && frenchScore >= englishScore) {
    throw new Error('La légende générée doit être en anglais, jamais en français.');
  }
  if (words.length > 6 && englishScore === 0) {
    throw new Error('La légende générée doit être en anglais.');
  }
  if (words.length > 36) {
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

export function normalizeGeneratedPost(value) {
  const parsed = GeneratedPostSchema.parse(value);
  const caption = assertEnglishShortCaption(cleanCaption(parsed.caption));
  return {
    ...parsed,
    caption,
    hashtags: normalizeHashtags(parsed.hashtags),
    location: normalizeGeneratedLocation(parsed),
  };
}

export function normalizeRegeneratedText(value) {
  const parsed = RegeneratedTextSchema.parse(value);
  return {
    caption: assertEnglishShortCaption(cleanCaption(parsed.caption)),
    hashtags: normalizeHashtags(parsed.hashtags),
  };
}
