import { TS_CHARACTER_PAIRS } from './tsCharacters.ts';

let table: Map<string, string> | null = null;

/** 按 OpenCC 的单字表把繁体字换成简体字，只用来比较，不用来显示；表里没有的字原样保留 */
export function simplifyChars(text: string): string {
  if (!table) {
    const chars = [...TS_CHARACTER_PAIRS];
    table = new Map();
    for (let index = 0; index + 1 < chars.length; index += 2) {
      table.set(chars[index] ?? '', chars[index + 1] ?? '');
    }
  }
  let result = '';
  for (const char of text) result += table.get(char) ?? char;
  return result;
}
