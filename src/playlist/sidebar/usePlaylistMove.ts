import type { PlaylistInfo } from 'foo-webview-sdk';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { PlaylistActions } from '../playlistActions.ts';
import { isOwnSlot, landingIndex } from './playlistReorder.ts';

/**
 * 把一张挪到插入位，拖动松手与 Alt+↑ / Alt+↓ 共用。焦点跟着被挪的那一行走：各行按 GUID 做 key，React
 * 挪的是原来那个节点，提交后自己把焦点还给它，但同时把滚动区的 scrollTop 恢复成挪动前的值，挪到边上的
 * 那一行可能已在可见范围之外。所以记下它该落在第几位，读回的清单里它到了那儿，就把它滚进可见范围。
 *
 * 上一次挪动的结果读回之前不接下一次：插入位按手上的清单算，清单还是旧的；被拒的那一下也不能把上一次
 * 记下的落点冲掉。
 */
export function usePlaylistMove(
  scroller: RefObject<HTMLElement | null>,
  items: readonly PlaylistInfo[],
  actions: Pick<PlaylistActions, 'reorder'>,
): (guid: string, slot: number) => void {
  const reveal = useRef<{ readonly guid: string; readonly index: number } | null>(null);
  const moving = useRef(false);

  useLayoutEffect(() => {
    const target = reveal.current;
    if (!target || items[target.index]?.guid !== target.guid) return;
    reveal.current = null;
    scroller.current
      ?.querySelector<HTMLElement>(`[data-playlist-entry="${CSS.escape(target.guid)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [items, scroller]);

  return (guid, slot) => {
    const from = items.findIndex((item) => item.guid === guid);
    if (moving.current || from < 0 || isOwnSlot(from, slot)) return;
    moving.current = true;
    reveal.current = { guid, index: landingIndex(from, slot) };
    void actions.reorder(guid, slot).then((ok) => {
      moving.current = false;
      if (!ok) reveal.current = null;
    });
  };
}
