import { contactSearchText, normalizeContactSearch } from "./contactSearch";
import type { Contact } from "./types";

type SearchContact = Partial<Contact> & { id: string };
type Word = { readonly letters: readonly string[] };
type IndexedContact<T> = {
  readonly contact: T;
  readonly directText: string;
  readonly wordIds: readonly number[];
  readonly sortName: string;
};

export type ContactSearchIndex<T extends SearchContact> = {
  readonly entries: readonly IndexedContact<T>[];
  readonly words: readonly Word[];
};

type Score = { edits: number; relative: number; prefixes: number };
type Candidate<T> = Score & { entry: IndexedContact<T> };
const MAX_SUGGESTIONS = 5;

/** Index only the already authorized, category-filtered projection; rebuild when it changes. */
export function createContactSearchIndex<T extends SearchContact>(contacts: readonly T[]): ContactSearchIndex<T> {
  const seenIds = new Set<string>();
  const wordIds = new Map<string, number>();
  const words: Word[] = [];
  const entries: IndexedContact<T>[] = [];
  for (const contact of contacts) {
    if (seenIds.has(contact.id)) continue;
    seenIds.add(contact.id);
    const name = normalizeContactSearch([contact.firstName, contact.name, contact.companyName].filter(value => value?.trim()).join(" "));
    const contactWordIds = new Set<number>();
    for (const word of name.match(/[\p{L}\p{N}]+/gu) ?? []) {
      let id = wordIds.get(word);
      if (id === undefined) {
        id = words.length;
        wordIds.set(word, id);
        words.push({ letters: Array.from(word) });
      }
      contactWordIds.add(id);
    }
    entries.push({ contact, directText: contactSearchText(contact), wordIds: [...contactWordIds], sortName: name });
  }
  return { entries, words };
}

/** Bounded restricted Damerau distance: insert, delete, substitute, or transpose adjacent letters. */
function editDistance(left: readonly string[], right: readonly string[], maximum: number): number | null {
  if (Math.abs(left.length - right.length) > maximum) return null;
  const outside = maximum + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, column) => Math.min(column, outside));
  let beforePrevious = previous;
  for (let row = 1; row <= left.length; row += 1) {
    const current = Array<number>(right.length + 1).fill(outside);
    current[0] = Math.min(row, outside);
    const firstColumn = Math.max(1, row - maximum);
    const lastColumn = Math.min(right.length, row + maximum);
    let minimum = current[0];
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const replacement = left[row - 1] === right[column - 1] ? 0 : 1;
      let distance = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + replacement);
      if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) {
        distance = Math.min(distance, beforePrevious[column - 2] + 1);
      }
      current[column] = Math.min(distance, outside);
      minimum = Math.min(minimum, distance);
    }
    if (minimum > maximum) return null;
    beforePrevious = previous;
    previous = current;
  }
  return previous[right.length] <= maximum ? previous[right.length] : null;
}

function compareScore(left: Score, right: Score): number {
  return left.edits - right.edits || left.relative - right.relative || left.prefixes - right.prefixes;
}

function wordScore(query: readonly string[], word: readonly string[]): Score | null {
  if (word.length < 4) return null;
  // Two edits are reserved for long whole words with a matching beginning and <=20% error.
  const allowTwo = query.length >= 8 && word.length >= 10 && query[0] === word[0] && query[1] === word[1];
  const maximum = allowTwo ? 2 : 1;
  const wholeEdits = editDistance(query, word, maximum);
  let best: Score | null = wholeEdits !== null && (wholeEdits <= 1 || wholeEdits / Math.max(query.length, word.length) <= 0.2)
    ? { edits: wholeEdits, relative: wholeEdits / Math.max(query.length, word.length), prefixes: 0 }
    : null;

  // A typo in a fragment compares only with the start of a name/company word, never an arbitrary interior.
  for (let length = Math.max(1, query.length - 1); length <= Math.min(word.length - 1, query.length + 1); length += 1) {
    const edits = editDistance(query, word.slice(0, length), 1);
    if (edits === null) continue;
    const prefix = { edits, relative: edits / Math.max(query.length, length), prefixes: 1 };
    if (!best || compareScore(prefix, best) < 0) best = prefix;
  }
  return best;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function searchTokens(query: string): string[] {
  return [...new Set(normalizeContactSearch(query).split(" ").filter(Boolean))];
}

function suggestionTokens(tokens: readonly string[]): string[] {
  // Split only unmistakable compound-name punctuation; never clean email, URL, or telephone tokens.
  return [...new Set(tokens.flatMap(token => /^\p{L}+(?:[-'’]\p{L}+)+$/u.test(token) ? token.split(/[-'’]/u) : [token]))];
}

function directMatch(text: string, tokens: readonly string[]): boolean {
  return tokens.every(token => text.includes(token));
}

/** Exact-only search for existing category summaries; no fuzzy work or suggestion cap. */
export function searchDirectContacts<T extends SearchContact>(index: ContactSearchIndex<T>, query: string): T[] {
  const tokens = searchTokens(query);
  return index.entries.filter(entry => directMatch(entry.directText, tokens)).map(entry => entry.contact);
}

/** Suggestions only: no assignment, mutation, implicit selection, or identity matching. */
export function searchContactSuggestions<T extends SearchContact>(index: ContactSearchIndex<T>, query: string): { direct: T[]; close: T[] } {
  const tokens = searchTokens(query);
  const direct: T[] = [];
  const remaining: IndexedContact<T>[] = [];
  for (const entry of index.entries) {
    // This is the unchanged direct-search comparison over its cached authorized text.
    if (directMatch(entry.directText, tokens)) direct.push(entry.contact);
    else remaining.push(entry);
  }
  if (!tokens.length || !remaining.length) return { direct, close: [] };

  const closeTokens = suggestionTokens(tokens);
  const scoresByToken = new Map<string, Map<number, Score>>();
  for (const token of closeTokens) {
    const letters = Array.from(token);
    // Email punctuation, telephone digits and short fragments never receive fuzzy matching.
    if (letters.length < 4 || !/^\p{L}+$/u.test(token)) continue;
    const scores = new Map<number, Score>();
    for (let id = 0; id < index.words.length; id += 1) {
      const score = wordScore(letters, index.words[id].letters);
      if (score) scores.set(id, score);
    }
    scoresByToken.set(token, scores);
  }

  const candidates: Candidate<T>[] = [];
  for (const entry of remaining) {
    const total: Score = { edits: 0, relative: 0, prefixes: 0 };
    let eligible = true;
    for (const token of closeTokens) {
      if (entry.directText.includes(token)) continue;
      const scores = scoresByToken.get(token);
      let best: Score | undefined;
      for (const wordId of entry.wordIds) {
        const score = scores?.get(wordId);
        if (score && (!best || compareScore(score, best) < 0)) best = score;
      }
      if (!best || total.edits + best.edits > 2) {
        eligible = false;
        break;
      }
      total.edits += best.edits;
      total.relative += best.relative;
      total.prefixes += best.prefixes;
    }
    if (eligible && total.edits > 0) candidates.push({ entry, ...total });
  }
  candidates.sort((left, right) => compareScore(left, right)
    || compareText(left.entry.sortName, right.entry.sortName)
    || compareText(left.entry.contact.id, right.entry.contact.id));
  return { direct, close: candidates.slice(0, MAX_SUGGESTIONS).map(candidate => candidate.entry.contact) };
}
