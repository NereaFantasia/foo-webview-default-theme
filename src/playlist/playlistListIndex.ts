import type { fb } from 'foo-webview-sdk/bridge';
import type { Store } from '../kit/store.ts';
import { playlistsAtom } from '../playback/playlists.ts';

export interface ListIndexFace {
  on: typeof fb.on;
}

export interface ListIndex {
  /**
   * 事件里的列表序号此刻是哪一张：答 GUID；清单里没有这个序号答 undefined；建、删、重排列表之后到清单
   * 读回之前序号对不上，答 null，调用方当作可能是任何一张。
   */
  guidAt(index: number): string | null | undefined;
  dispose(): void;
}

/**
 * 宿主的列表内容事件只带序号，按此刻的清单换回 GUID。结构事件（建、删、重排）推来时记下清单的版本，
 * 清单读回一版新的之前，序号一律不可信。要在订阅内容事件之前建好，结构事件才不会漏。
 */
export function startListIndex(store: Store, host: ListIndexFace): ListIndex {
  // 清单读到这一版为止序号不可信：还没读过（版本 0），或读完之后又建、删、重排过列表。
  let untrustedUpTo = 0;
  const mark = () => {
    untrustedUpTo = store.get(playlistsAtom).revision;
  };
  const offs = [
    host.on('playlist:created', mark),
    host.on('playlist:removed', mark),
    host.on('playlist:reordered', mark),
  ];
  return {
    guidAt(index) {
      const lists = store.get(playlistsAtom);
      if (lists.revision <= untrustedUpTo) return null;
      return lists.items.find((item) => item.index === index)?.guid;
    },
    dispose() {
      for (const off of offs.splice(0)) off();
    },
  };
}
