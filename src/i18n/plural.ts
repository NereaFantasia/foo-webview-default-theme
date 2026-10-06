import { atom, type Atom } from 'jotai/vanilla';
import type { MessageKey } from './en.ts';
import { localeAtom } from './locale.ts';

// 数量文案的单复数：一个量在语言包里写两条，`xxxOne` 给「一」这一类，`xxx` 给其余，
// 按正在显示的语言的复数规则挑。只分这两类；中文这类不分单复数的语言总是落到后一条。

export type PluralPick = <K extends MessageKey>(count: number, one: K, other: K) => K;

const RULES = new Map<string, Intl.PluralRules>();

/** `tag` 的语言里 `count` 该用哪一条。标签认不出来时按不分单复数处理。 */
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

/** 按正在显示的语言挑的函数；语言一换就是一个新函数。 */
export const pluralAtom: Atom<PluralPick> = atom((get) => {
  const tag = get(localeAtom).active;
  return (count, one, other) => pluralKey(tag, count, one, other);
});
