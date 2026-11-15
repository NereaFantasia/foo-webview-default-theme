import { useAtomValueRawSync } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import { useService } from '../kit/useService.ts';
import { onlineFavoritesKey } from '../playback/onlineFavorites.ts';
import { canFavorite, type FavoriteItems, type FavoriteKind } from '../server/musicFavorites.ts';
import type { MusicRef } from '../server/musicObjects.ts';

const NEVER = atom(false);

export interface FavoriteControl {
  /** 收藏已读到且支持收藏：渲染操作键。在收藏状态就绪前保持占位，避免状态跳变；不支持的平台不渲染 */
  readonly available: boolean;
  readonly on: boolean;
  /** 已收藏的随时能取消；没收藏的要有快照（展示信息）才能收 */
  readonly enabled: boolean;
  toggle(): void;
}

/**
 * 一个在线对象此刻的收藏状态与开关。`ref` 是它的身份，`item` 是收藏时存下的快照；曲目的展示信息还没取到、
 * 艺人署名没有引用时，对应给 null
 */
export function useFavorite<K extends FavoriteKind>(
  kind: K,
  ref: MusicRef | null,
  item: FavoriteItems[K] | null,
): FavoriteControl {
  const favorites = useService(onlineFavoritesKey);
  const ready = useAtomValueRawSync(favorites.state).phase === 'ready';
  const on = useAtomValueRawSync(ref ? favorites.has(kind, ref) : NEVER);
  return {
    available: ready && ref !== null && canFavorite(ref),
    on,
    enabled: on || item !== null,
    toggle() {
      if (!ref) return;
      if (on) void favorites.remove(kind, [ref]);
      else if (item) void favorites.add(kind, [item]);
    },
  };
}
