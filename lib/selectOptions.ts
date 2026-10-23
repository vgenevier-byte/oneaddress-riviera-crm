/** Presentation-only ordering. Never infer a placeholder/complement from an ID. */
export type SelectOptionPositions<T> = {
  first?: (option: T) => boolean;
  last?: (option: T) => boolean;
};

const collators = new Map<string, Intl.Collator>();

export function selectOptionCollator(language: string): Intl.Collator {
  let collator = collators.get(language);
  if (!collator) {
    collator = new Intl.Collator(language, { sensitivity: "base", numeric: true });
    collators.set(language, collator);
  }
  return collator;
}

/** Sort a copy by the exact visible label; equal labels retain their source order. */
export function sortSelectOptions<T>(
  options: readonly T[],
  getLabel: (option: T) => string,
  language: string,
  positions: SelectOptionPositions<T> = {},
): T[] {
  const collator = selectOptionCollator(language);
  const position = (option: T) => positions.first?.(option) ? -1 : positions.last?.(option) ? 1 : 0;
  return [...options].sort((first, second) => {
    const firstPosition = position(first), secondPosition = position(second);
    if (firstPosition !== secondPosition) return firstPosition - secondPosition;
    // Preserve declared placeholder/complement order if a field has several.
    if (firstPosition !== 0) return 0;
    return collator.compare(getLabel(first), getLabel(second));
  });
}
