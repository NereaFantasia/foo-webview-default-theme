import { atom, type Atom } from 'jotai/vanilla';
import type { MessageKey } from './en.ts';
import { localeAtom } from './locale.ts';

// 语言包成对声明 `xxxOne` 与 `xxx`，按当前语言的复数规则匹配。不区分单复数的语言回退至 `xxx`

export type PluralPick = <K extends MessageKey>(count: number, one: K, other: K) => K;

const RULES = new Map<string, Intl.PluralRules>();

/** 根据语言标签与数量匹配单复数键名。标签无法识别时回退至 `other` 键 */
export function pluralKey<K extends MessageKey>(tag: string, count: number, one: K, other: K): K {
  let rules = RULES.get(tag);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(tag);
    } catch {
      return other;
    }
    RULES.set(tag, rules);
  }
  return rules.select(count) === 'one' ? one : other;
}

/** 随当前语言更新的单复数选择函数 */
export const pluralAtom: Atom<PluralPick> = atom((get) => {
  const tag = get(localeAtom).active;
  return (count, one, other) => pluralKey(tag, count, one, other);
});
