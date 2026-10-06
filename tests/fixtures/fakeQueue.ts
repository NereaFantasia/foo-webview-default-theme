import type { Track } from 'foo-webview-sdk';
import { listParam, numberParam } from './hostAnswers.ts';
import type { FakeHost, HostEvent, HostEventPayload, HostParams } from './fakeHost.ts';
import { makeTrack } from './tracks.ts';
import { guidOf } from './fakePlaylists.ts';

/** 装队列的宿主替身：单测的推事件是同步的，浏览器测试的是异步的，这里不等它。 */
export type FakeQueueHost = Pick<FakeHost, 'answerAll'> & {
  emit<K extends HostEvent>(event: K, payload: HostEventPayload<K>): unknown;
};

/** 替身队列里的一条：曲目加上它入队时带的列表位置。 */
export interface FakeQueueItem {
  readonly track: Track;
  readonly playlist: number | null;
  readonly playlistGuid: string | null;
  readonly playlistItem: number | null;
}

export interface FakeQueue {
  /** 此刻队列里的曲目，按播放顺序。 */
  readonly items: FakeQueueItem[];
  titles(): string[];
  /** 换掉整份队列，不发事件。 */
  set(tracks: readonly Track[]): void;
  /** 核心取走队首：先发换曲，再发 `playback_advance`。 */
  advance(): void;
}

const plain = (track: Track): FakeQueueItem => ({
  track,
  playlist: null,
  playlistGuid: null,
  playlistItem: null,
});

/**
 * 在单测的宿主替身上装一份会变的播放队列，照宿主的规则答 `queue.*`：按下标移除、清空、移到队首、整份重排、
 * 按路径插入（已在队列里的同一首挪过来）、立即播放（挪到队首再取走）。每次改动发一条 `playback:queueChanged`。
 * 按路径插入时路径按句柄从 `known` 里认曲目，认不出的现造一首。
 */
export function installFakeQueue(
  host: FakeQueueHost,
  initial: readonly Track[] = [],
  known: readonly Track[] = [],
): FakeQueue {
  const items: FakeQueueItem[] = initial.map(plain);
  const byHandle = new Map([...initial, ...known].map((track) => [track.handle, track]));
  const changed = (origin: 'user_added' | 'user_removed' | 'playback_advance' | 'unknown') =>
    host.emit('playback:queueChanged', { origin, count: items.length });
  const wire = () =>
    items.map((item, queueIndex) => ({
      ...item.track,
      queueIndex,
      playlist: item.playlist,
      playlistGuid: item.playlistGuid,
      playlistItem: item.playlistItem,
    }));
  const replace = (next: readonly FakeQueueItem[]) => items.splice(0, items.length, ...next);

  host.answerAll({
    queue: {
      get: () => ({ success: true, items: wire(), count: items.length }),
      getCount: () => ({ success: true, count: items.length, hasItems: items.length > 0 }),
      remove: (params: HostParams) => {
        const single = numberParam(params, 'index');
        const indices = single === undefined ? listParam(params, 'indices') : [single];
        const gone = new Set(indices.filter((index) => typeof index === 'number'));
        replace(items.filter((_, index) => !gone.has(index)));
        changed('user_removed');
        return { success: true, removedCount: gone.size, queueCount: items.length };
      },
      clear: () => {
        const clearedCount = items.length;
        replace([]);
        changed('user_removed');
        return { success: true, clearedCount };
      },
      moveToTop: (params: HostParams) => {
        const index = numberParam(params, 'index') ?? 0;
        const [moved] = items.splice(index, 1);
        if (moved) items.unshift(moved);
        changed('unknown');
        return { success: true, movedIndex: index, queueCount: items.length };
      },
      setContents: (params: HostParams) => {
        const refs = listParam(params, 'items');
        const next = refs.flatMap((ref) => {
          const index = typeof ref === 'object' && ref ? Reflect.get(ref, 'queueIndex') : undefined;
          const item = typeof index === 'number' ? items[index] : undefined;
          return item ? [item] : [];
        });
        replace(next);
        changed('unknown');
        return { success: true, queueCount: items.length };
      },
      insertNext: (params: HostParams) => {
        const paths = listParam(params, 'paths').filter((path) => typeof path === 'string');
        const coords = listParam(params, 'items');
        const fresh = [
          ...coords.map((ref, at) => ({
            track: makeTrack({ path: `file://row-${at}.flac`, title: `row ${at}` }),
            playlist: typeof ref === 'object' && ref ? Number(Reflect.get(ref, 'playlist')) : 0,
            playlistGuid:
              typeof ref === 'object' && ref && typeof Reflect.get(ref, 'playlistGuid') === 'string'
                ? String(Reflect.get(ref, 'playlistGuid'))
                : guidOf(typeof ref === 'object' && ref ? Number(Reflect.get(ref, 'playlist')) : 0),
            playlistItem: typeof ref === 'object' && ref ? Number(Reflect.get(ref, 'item')) : 0,
          })),
          ...paths.map((path) =>
            plain(byHandle.get(path) ?? makeTrack({ path: `file://${path}` })),
          ),
        ];
        const handles = new Set(fresh.map((item) => item.track.handle));
        const movedCount = items.filter((item) => handles.has(item.track.handle)).length;
        const rest = items.filter((item) => !handles.has(item.track.handle));
        const position = Math.min(numberParam(params, 'position') ?? 0, rest.length);
        replace([...rest.slice(0, position), ...fresh, ...rest.slice(position)]);
        changed('user_added');
        return {
          success: true,
          insertedCount: fresh.length - movedCount,
          movedCount,
          queueCount: items.length,
          invalidCount: 0,
        };
      },
      playNow: (params: HostParams) => {
        const index = numberParam(params, 'index') ?? 0;
        const [played] = items.splice(index, 1);
        if (played) host.emit('playback:trackChanged', played.track);
        changed('playback_advance');
        return { success: true, playedIndex: index, queueCount: items.length };
      },
    },
  });

  return {
    items,
    titles: () => items.map((item) => item.track.title),
    set(tracks) {
      replace(tracks.map(plain));
      for (const track of tracks) byHandle.set(track.handle, track);
    },
    advance() {
      const played = items.shift();
      if (played) host.emit('playback:trackChanged', played.track);
      changed('playback_advance');
    },
  };
}

/** 一组标题不同、路径不同的曲目，按标题认。 */
export function queueTracks(...titles: string[]): Track[] {
  return titles.map((title) => makeTrack({ path: `file://E:/Music/${title}.flac`, title }));
}
