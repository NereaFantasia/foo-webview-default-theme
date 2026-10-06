/**
 * 合辑艺术家的内置名单，比较时不分大小写。合辑不是一位真人：不联网、不出常听与常合作、
 * 不进「需要整理」。用户另标的合辑由调用方并进来。
 */
export const COMPILATION_NAMES: ReadonlySet<string> = new Set([
  'various artists',
  'various',
  'va',
  'v.a.',
  '群星',
  'ヴァリアス・アーティスト',
  'オムニバス',
]);

const NONE: ReadonlySet<string> = new Set();

/** 比较合辑名用的写法：NFC、去首尾空白、小写。用户标的合辑也按这个写法存。 */
export function compilationKey(name: string): string {
  return name.normalize('NFC').trim().toLowerCase();
}

export function isCompilation(name: string, marked: ReadonlySet<string> = NONE): boolean {
  const key = compilationKey(name);
  return COMPILATION_NAMES.has(key) || marked.has(key);
}

/**
 * 「没写艺术家」那一行的主体。宿主折叠专辑时，没有 album artist 也没有 artist 的曲目，专辑艺术家
 * 是空串；它不显示、不进在线查询，也不能改名。
 */
export const UNNAMED_ARTIST = '';

/**
 * 艺人名的排序：按界面语言的规则比，数字按数值；规则判为相同时按 UTF-16 码元定先后，
 * 只差大小写或全半角的两位不会随机换位。
 */
export function artistComparator(locale: string | undefined): (a: string, b: string) => number {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  return (a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}
