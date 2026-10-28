import type { KindOpeners } from '../../src/nav/objectOpener.ts';

const ready = { availability: () => 'ready' as const };

/** 每个种类都答「能打开」、直接进页的打开表；测试把关心的几种换掉。加种类时只在这里补一项 */
export const READY_KINDS: KindOpeners = {
  album: ready,
  artist: ready,
  folder: ready,
  genre: ready,
  playlist: ready,
  onlineList: ready,
  onlineAlbums: ready,
};
