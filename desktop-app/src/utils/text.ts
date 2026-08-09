export function countNovelCharacters(content: string): number {
  return [...content.replace(/[\s\u200B-\u200D\uFEFF]/gu, '')].length;
}
