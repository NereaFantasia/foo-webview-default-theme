/** 判断「需要整理」要的那一点：名字与他署名的曲目数（合并目标取曲目多的那位）。 */
export interface TidyArtist {
  readonly name: string;
  readonly trackCount: number;
}

export type TidyIssue =
  /** 与 `others` 统一写法后相同；`target` 是缺省的合并目标，可能就是他自己。 */
  | {
      readonly kind: 'duplicate';
      readonly others: readonly string[];
      readonly target: string;
    }
  /** 一个值里写了几位，`parts` 是拆出来的名字。 */
  | { readonly kind: 'multiple'; readonly parts: readonly string[] };

/**
 * 判断重复用的键：去掉变音符号、统一全半角与大小写，再去掉空白与各种连字符。只做这几样：
 * 别的标点（如 AC/DC 的斜杠）是名字的一部分。简繁统一要一张对照表，这里不做。
 */
export function tidyKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-‐‑‒–—―_]+/g, '');
}

/** 不管两边是谁都算写了几位的分隔：feat.、ft.、featuring、×。 */
const ALWAYS = /\s+(?:feat\.?|ft\.?|featuring)\s+|\s*×\s*/i;
/** 两边的名字都单独出现在库里才算写了几位的分隔：&、/、、、逗号。 */
const MAYBE = /\s*[&/、,，]\s*/;

function partsOf(name: string, pattern: RegExp): readonly string[] {
  return name
    .split(new RegExp(pattern.source, `${pattern.flags}g`))
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * 整份清单里每位的整理提示。`ignored` 是用户点过「忽略」的名字，合辑艺术家由调用方先剔掉。
 * 写了几位：带 feat.、ft.、× 的直接算；带 &、/、、 的要拆出来的每一位都单独在库里，
 * Simon & Garfunkel、AC/DC 这样拆开后库里没有的不算。
 */
export function findTidyIssues(
  artists: readonly TidyArtist[],
  ignored: ReadonlySet<string> = new Set(),
): ReadonlyMap<string, readonly TidyIssue[]> {
  const byKey = new Map<string, TidyArtist[]>();
  const known = new Set<string>();
  for (const artist of artists) {
    const key = tidyKey(artist.name);
    if (!key) continue;
    known.add(key);
    byKey.set(key, [...(byKey.get(key) ?? []), artist]);
  }
  const issues = new Map<string, TidyIssue[]>();
  const add = (name: string, issue: TidyIssue) => {
    if (!ignored.has(name)) issues.set(name, [...(issues.get(name) ?? []), issue]);
  };
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const target = group.reduce((best, item) => (item.trackCount > best.trackCount ? item : best));
    for (const artist of group) {
      const others = group.filter((item) => item !== artist).map((item) => item.name);
      add(artist.name, { kind: 'duplicate', others, target: target.name });
    }
  }
  for (const artist of artists) {
    const always = partsOf(artist.name, ALWAYS);
    if (always.length > 1) {
      add(artist.name, { kind: 'multiple', parts: always });
      continue;
    }
    const maybe = partsOf(artist.name, MAYBE);
    if (maybe.length > 1 && maybe.every((part) => known.has(tidyKey(part))))
      add(artist.name, { kind: 'multiple', parts: maybe });
  }
  return issues;
}
