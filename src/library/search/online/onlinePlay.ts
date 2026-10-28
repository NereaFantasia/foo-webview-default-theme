import type { Atom } from 'jotai/vanilla';
import { serviceKey } from '../../../kit/serviceKey.ts';
import { onlineListSubject, type OnlineListSubject } from '../../../nav/places.ts';
import type { RecordedSource } from '../../../playback/playbackSource.ts';
import type { Store } from '../../../kit/store.ts';
import { onlineAddress } from '../../../server/onlineAddress.ts';
import type { OnlineTracksService } from '../../../playback/onlineTracks.ts';
import type { MusicQuality, MusicTrack } from '../../../server/musicObjects.ts';
import type { TrackActionsService } from '../../../track/trackActions.ts';

/** 一次起播或入队最多带的在线曲目数：入队时 fb2k 逐首打开地址，每首都要后端取一次地址 */
export const ONLINE_PLAY_LIMIT = 2000;

export interface OnlinePlayDeps {
  /** 后端监听的端口，没连上时为 null */
  readonly port: Atom<number | null>;
  /** 后端已判停：端口还留着，但交给 fb2k 的地址打不开 */
  readonly failed: Atom<boolean>;
  /** 加入时的档位；已在队列里的保持加入时的档位 */
  readonly quality: Atom<MusicQuality>;
  readonly actions: Pick<TrackActionsService, 'playPaths' | 'queuePaths'>;
  readonly tracks: Pick<OnlineTracksService, 'remember'>;
}

/** 在线搜索起播的来源：回到那次查询 */
export const onlineSearchSource = (query: string): RecordedSource => ({
  kind: 'online',
  subject: query,
  name: query,
});

const LIST_SOURCES = {
  album: 'onlineAlbum',
  playlist: 'onlinePlaylist',
  artist: 'onlineArtist',
} as const satisfies Record<OnlineListSubject['kind'], RecordedSource['kind']>;

/** 在线列表起播的来源：写「专辑 · 名字」这类，单击回到这张列表 */
export const onlineListSource = (list: OnlineListSubject): RecordedSource => ({
  kind: LIST_SOURCES[list.kind],
  subject: onlineListSubject(list),
  name: list.title,
});

export interface OnlinePlay {
  /**
   * 已加载的曲目换进专用列表，从第 `index` 首起播，来源记成 `source`。超过上限时只带上含所点那首的
   * 一段；ID 放不进占位地址的曲目跳过。后端没连上、已判停或所点那首没有地址时答 false
   */
  play(tracks: readonly MusicTrack[], index: number, source: RecordedSource): Promise<boolean>;
  /** `next` 插到队首，否则接在队尾 */
  queue(tracks: readonly MusicTrack[], next: boolean): Promise<boolean>;
}

export function createOnlinePlay(store: Store, deps: OnlinePlayDeps): OnlinePlay {
  /** 能放进占位地址的曲目与它们的地址，顺序不变；后端没连上或已判停时为 null */
  function addresses(tracks: readonly MusicTrack[]) {
    const port = store.get(deps.port);
    if (port === null || store.get(deps.failed)) return null;
    const quality = store.get(deps.quality);
    const kept: { readonly track: MusicTrack; readonly path: string }[] = [];
    for (const track of tracks) {
      const path = onlineAddress(port, track.ref, quality);
      if (path) kept.push({ track, path });
    }
    return kept;
  }

  return {
    async play(tracks, index, source) {
      const start = Math.max(0, Math.min(index, tracks.length - ONLINE_PLAY_LIMIT));
      const picked = tracks.slice(start, start + ONLINE_PLAY_LIMIT);
      const clicked = tracks[index];
      const kept = addresses(picked);
      const at = kept?.findIndex((item) => item.track === clicked) ?? -1;
      if (!kept || at < 0) return false;
      deps.tracks.remember(kept.map((item) => item.track));
      return deps.actions.playPaths(
        kept.map((item) => item.path),
        at,
        source,
      );
    },
    async queue(tracks, next) {
      const kept = addresses(tracks.slice(0, ONLINE_PLAY_LIMIT));
      if (!kept?.length) return false;
      deps.tracks.remember(kept.map((item) => item.track));
      return deps.actions.queuePaths(
        kept.map((item) => item.path),
        next,
      );
    },
  };
}

export const onlinePlayKey = serviceKey<OnlinePlay>('onlinePlay');
