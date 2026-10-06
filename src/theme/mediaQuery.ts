import type { PrimitiveAtom } from 'jotai/vanilla';
import type { Store } from '../kit/store.ts';

/** 跟随一条媒体查询只用到这几项；浏览器的 `MediaQueryList` 满足它。 */
export interface MediaQuerySource {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

export type MatchMedia = (query: string) => MediaQuerySource;

/** 浏览器的 `matchMedia`；没有这个全局的环境（比如 node）给 null。 */
export function browserMatchMedia(): MatchMedia | null {
  return typeof matchMedia === 'function' ? (query) => matchMedia(query) : null;
}

/**
 * 把一条媒体查询的结果写进原子：立即写一次，之后随系统设置变化，返回停止跟随的函数。
 * `source` 为 null 时原子保持原值，返回的函数什么也不做。
 */
export function syncMediaQuery(
  store: Store,
  target: PrimitiveAtom<boolean>,
  query: string,
  source: MatchMedia | null,
): () => void {
  if (!source) return () => {};
  const media = source(query);
  const update = () => store.set(target, media.matches);
  update();
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}
