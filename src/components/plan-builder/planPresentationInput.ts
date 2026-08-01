export const FIRST_VISIT_NOTE_LIMIT = 500;

export function sanitizeFirstVisitNote(value: string): string {
  const normalized = value.normalize('NFKC');
  const withoutControlCharacters = Array.from(normalized, (character) => ({
    character,
    codePoint: character.codePointAt(0) ?? 0,
  }))
    .filter(({ codePoint }) => codePoint === 9 || codePoint === 10 || codePoint === 13 || (codePoint >= 32 && codePoint !== 127))
    .map(({ character }) => character)
    .join('');

  return withoutControlCharacters.slice(0, FIRST_VISIT_NOTE_LIMIT);
}
