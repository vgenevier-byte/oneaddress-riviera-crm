/** Local comparison keys only. Never use these keys to assign, merge or rewrite records. */
export function normalizeSearch(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase("fr")
    .replace(/[’‘]/gu, "'").replace(/[‐‑‒–—]/gu, "-")
    .replace(/[,;()[\]{}!?]+/gu, " ").trim().replace(/\s+/gu, " ");
}

type Field = string | number | null | undefined;
type Score = { edits: number; relative: number; prefixes: number; interior: number };
type IndexedEntry<T> = {
  readonly item: T;
  readonly id: string;
  readonly text: string;
  readonly fields: readonly string[];
  readonly words: readonly number[];
  readonly wordSet: ReadonlySet<string>;
  readonly label: string;
};
export type SearchIndex<T> = {
  readonly entries: readonly IndexedEntry<T>[];
  readonly words: readonly string[];
};
export type SearchHit<T> = { item: T; approximate: boolean; score: number };

/** Common punctuation in personal/business names is a separator; coordinates stay literal. */
function tokensOf(value: string): string[] {
  const chunks = normalizeSearch(value).split(" ").filter(Boolean);
  const tokens: string[] = [];
  for (let position = 0; position < chunks.length; position += 1) {
    const token = chunks[position];
    if (/^[\d+()./_-]+$/u.test(token) && /\d/u.test(token)) {
      let number = token;
      while (position + 1 < chunks.length && /^[\d+()./_-]+$/u.test(chunks[position + 1]) && /\d/u.test(chunks[position + 1])) {
        number += chunks[++position];
      }
      tokens.push(number.replace(/[\s+()./_-]/gu, ""));
    } else tokens.push(...(/^\p{L}+(?:[-']\p{L}+)+$/u.test(token) ? token.split(/[-']/u) : [token]));
  }
  return [...new Set(tokens)];
}

/** Index only the caller's current authorized, business-filtered projection. Reuse until it changes. */
export function createSearchIndex<T>(
  items: readonly T[],
  getFields: (item: T) => readonly Field[],
  options: { getId?: (item: T) => string; getLabel?: (item: T) => string } = {}
): SearchIndex<T> {
  const entries: IndexedEntry<T>[] = [];
  const words: string[] = [];
  const dictionary = new Map<string, number>();
  const seen = new Set<string>();
  for (const [position, item] of items.entries()) {
    const id = options.getId?.(item) ?? String(position);
    if (seen.has(id)) continue;
    seen.add(id);
    const fields = getFields(item).filter(value => value !== null && value !== undefined && String(value).trim())
      .map(value => normalizeSearch(String(value)));
    const text = fields.join(" ");
    const wordSet = new Set(fields.flatMap(tokensOf).filter(token => /^\p{L}+$/u.test(token)));
    const wordIds = [...wordSet].map(word => {
      let wordId = dictionary.get(word);
      if (wordId === undefined) { wordId = words.length; words.push(word); dictionary.set(word, wordId); }
      return wordId;
    });
    entries.push({ item, id, text, fields, words: wordIds, wordSet, label: normalizeSearch(options.getLabel?.(item) ?? fields[0] ?? "") });
  }
  return { entries, words };
}

/** Bounded restricted Damerau distance, including adjacent transpositions. */
function distance(left: string, right: string, maximum: number): number | null {
  if (Math.abs(left.length - right.length) > maximum) return null;
  const outside = maximum + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, column) => Math.min(column, outside));
  let beforePrevious = previous;
  for (let row = 1; row <= left.length; row += 1) {
    const current = Array<number>(right.length + 1).fill(outside);
    current[0] = Math.min(row, outside);
    let minimum = current[0];
    for (let column = Math.max(1, row - maximum); column <= Math.min(right.length, row + maximum); column += 1) {
      let edits = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
      if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) {
        edits = Math.min(edits, beforePrevious[column - 2] + 1);
      }
      current[column] = Math.min(edits, outside);
      minimum = Math.min(minimum, edits);
    }
    if (minimum > maximum) return null;
    beforePrevious = previous;
    previous = current;
  }
  return previous[right.length] <= maximum ? previous[right.length] : null;
}

function compareScore(left: Score, right: Score): number {
  return left.edits - right.edits || left.relative - right.relative || left.interior - right.interior || left.prefixes - right.prefixes;
}

function fuzzyWordScore(query: string, word: string): Score | null {
  if (word.length < 4) return null;
  const maximum = query.length >= 8 && word.length >= 10 && query.slice(0, 2) === word.slice(0, 2) ? 2 : 1;
  const edits = distance(query, word, maximum);
  let best: Score | null = edits !== null && (edits <= 1 || edits / Math.max(query.length, word.length) <= 0.2)
    ? { edits, relative: edits / Math.max(query.length, word.length), prefixes: 0, interior: 0 } : null;
  for (let length = Math.max(1, query.length - 1); length <= Math.min(word.length - 1, query.length + 1); length += 1) {
    const prefixEdits = distance(query, word.slice(0, length), 1);
    if (prefixEdits === null) continue;
    const prefix = { edits: prefixEdits, relative: prefixEdits / Math.max(query.length, length), prefixes: 1, interior: 0 };
    if (!best || compareScore(prefix, best) < 0) best = prefix;
  }
  return best;
}

function directScore<T>(entry: IndexedEntry<T>, token: string): Score | null {
  if (entry.wordSet.has(token)) return { edits: 0, relative: 0, prefixes: 0, interior: 0 };
  for (const word of entry.wordSet) {
    if (word.startsWith(token)) return { edits: 0, relative: 0, prefixes: 1, interior: 0 };
  }
  if (entry.text.includes(token)) return { edits: 0, relative: 0, prefixes: 0, interior: 1 };
  // Phone numbers and references accept their usual separators, never digit substitutions.
  if (/\d/u.test(token) && !/[@:]/u.test(token)) {
    const compact = token.replace(/[\s+()./_-]/gu, "");
    if (compact && entry.fields.some(field => field.replace(/[\s+()./_-]/gu, "").includes(compact))) {
      return { edits: 0, relative: 0, prefixes: 0, interior: 1 };
    }
  }
  return null;
}

/** Rank the complete eligible index before applying the display cap. Fuzzy matches are suggestions only. */
export function searchIndex<T>(
  index: SearchIndex<T>, query: string,
  options: { limit?: number; includeFuzzy?: boolean } = {}
): SearchHit<T>[] {
  const tokens = tokensOf(query);
  const scoresByToken = new Map<string, Map<number, Score>>();
  const candidates: { entry: IndexedEntry<T>; score: Score; exactLabel: number }[] = [];
  const normalizedQuery = normalizeSearch(query);
  for (const entry of index.entries) {
    const total: Score = { edits: 0, relative: 0, prefixes: 0, interior: 0 };
    let eligible = true;
    for (const token of tokens) {
      let best = directScore(entry, token);
      if (!best && options.includeFuzzy !== false && token.length >= 4 && /^\p{L}+$/u.test(token)) {
        let wordScores = scoresByToken.get(token);
        if (!wordScores) {
          wordScores = new Map<number, Score>();
          for (const [id, word] of index.words.entries()) {
            const score = fuzzyWordScore(token, word);
            if (score) wordScores.set(id, score);
          }
          scoresByToken.set(token, wordScores);
        }
        for (const id of entry.words) {
          const score = wordScores.get(id);
          if (score && (!best || compareScore(score, best) < 0)) best = score;
        }
      }
      if (!best || total.edits + best.edits > 2) { eligible = false; break; }
      total.edits += best.edits;
      total.relative += best.relative;
      total.prefixes += best.prefixes;
      total.interior += best.interior;
    }
    if (eligible) candidates.push({ entry, score: total, exactLabel: entry.label === normalizedQuery ? 0 : 1 });
  }
  candidates.sort((left, right) => left.score.edits - right.score.edits || left.exactLabel - right.exactLabel
    || compareScore(left.score, right.score) || left.entry.label.localeCompare(right.entry.label, "fr")
    || left.entry.id.localeCompare(right.entry.id, "fr"));
  const selected = options.limit === undefined ? candidates : candidates.slice(0, Math.max(0, options.limit));
  return selected.map(({ entry, score }) => ({ item: entry.item, approximate: score.edits > 0,
    score: score.edits * 100000 + score.relative * 1000 + score.interior * 100 + score.prefixes * 10 }));
}

/** For individual rows. Repeated list searches should use a memoized index instead. */
export function matchesSearchFields(query: string, fields: readonly Field[], options: { includeFuzzy?: boolean } = {}): boolean {
  return searchIndex(createSearchIndex([fields], item => item), query, { ...options, limit: 1 }).length > 0;
}
