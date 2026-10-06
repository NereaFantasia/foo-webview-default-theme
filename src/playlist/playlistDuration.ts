import { fb } from 'foo-webview-sdk/bridge';
import type { Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import type { Store } from '../kit/store.ts';
import { createHolds, createSlots } from './playlistHolds.ts';
import type { PlaylistRowsService } from './playlistRows.ts';
import { playlistsAtom } from '../playback/playlists.ts';

export interface PlaylistDurationFace {
  playlist: Pick<typeof fb.playlist, 'getActive'>;
}

export interface PlaylistDurationDeps {
  readonly rows: Pick<PlaylistRowsService, 'stateOf'>;
}

export interface PlaylistDurationService {
  /** 这张列表的总时长，秒；还没读到、读不到时为 null。 */
  stateOf(guid: string): Atom<number | null>;
  /** 页面挂上时调；返回的函数在卸下时调。 */
  acquire(guid: string): () => void;
  dispose(): void;
}

interface Entry {
  generation: number;
  /** 按行服务哪一版内容与标签读过；还没读过是 null。 */
  readAt: { readonly content: number; readonly tags: number } | null;
  wasActive: boolean;
  offs: (() => void)[];
}

/**
 * 播放列表页页头的总时长。宿主只在 `getActive` 里报时长，清单与取行都不带，所以只有这张是活动列表时才读：
 * 进页时它就是活动的；行增删、替换过（内容版本变了），曲目标签变过（换了文件、重新载入信息），或它重新
 * 成了活动列表，再读一次。读回的不是这张就不写；后发的读压过先发的。
 */
export function startPlaylistDuration(
  store: Store,
  deps: PlaylistDurationDeps,
  host: PlaylistDurationFace = fb,
): PlaylistDurationService {
  const slots = createSlots<number | null>(null);

  async function read(guid: string, entry: Entry): Promise<void> {
    const mine = ++entry.generation;
    const answer = await settle(() => host.playlist.getActive());
    if (mine !== entry.generation || !answer || answer.success === false) return;
    if (!answer.found || answer.guid !== guid || typeof answer.duration !== 'number') return;
    store.set(slots.own(guid), answer.duration);
  }

  function check(guid: string, entry: Entry): void {
    const rows = store.get(deps.rows.stateOf(guid));
    const active = store.get(playlistsAtom).activeGuid === guid;
    const becameActive = active && !entry.wasActive;
    entry.wasActive = active;
    if (!active || rows.status !== 'ready') return;
    const { readAt } = entry;
    const unchanged =
      readAt !== null && readAt.content === rows.contentVersion && readAt.tags === rows.tagVersion;
    if (!becameActive && unchanged) return;
    entry.readAt = { content: rows.contentVersion, tags: rows.tagVersion };
    void read(guid, entry);
  }

  const holds = createHolds<Entry>(
    (guid) => {
      const entry: Entry = { generation: 0, readAt: null, wasActive: false, offs: [] };
      const recheck = () => check(guid, entry);
      entry.offs.push(
        store.sub(deps.rows.stateOf(guid), recheck),
        store.sub(playlistsAtom, recheck),
      );
      recheck();
      return entry;
    },
    (entry, guid) => {
      entry.generation += 1;
      for (const off of entry.offs.splice(0)) off();
      store.set(slots.own(guid), null);
    },
  );

  return {
    stateOf: slots.view,
    acquire: (guid) => holds.acquire(guid),
    dispose: () => holds.dispose(),
  };
}
