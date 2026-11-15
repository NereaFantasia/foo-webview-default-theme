// @vitest-environment jsdom
import { Provider } from 'jotai/react';
import { createStore } from 'jotai/vanilla';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindService } from '../../../src/kit/serviceKey.ts';
import type { MusicClient } from '../../../src/playback/musicClient.ts';
import { ServicesContext, serviceMap } from '../../../src/kit/useService.ts';
import { FavoriteAlbumKey, FollowKey } from '../../../src/library/detail/FavoriteObjectKeys.tsx';
import { FavoriteCell } from '../../../src/library/search/online/FavoriteCell.tsx';
import { onlineFavoritesKey, startOnlineFavorites } from '../../../src/playback/onlineFavorites.ts';
import { startOnlineTracks } from '../../../src/playback/onlineTracks.ts';
import { PlayerFavoriteKey } from '../../../src/shell/player/PlayerFavoriteKey.tsx';
import { onlineAddress } from '../../../src/server/onlineAddress.ts';
import type { FavoriteKeys } from '../../../src/server/musicFavorites.ts';
import { musicAlbum, musicArtist, musicTrack } from '../../fixtures/music.ts';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

let host: HTMLDivElement;
let root: Root;

const EMPTY: FavoriteKeys = { track: [], album: [], artist: [], playlist: [] };
const flush = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));

/** 真的收藏服务配一个记调用的后端替身；`keys` 是后端已经收着的 */
async function mount(
  ui: (path: string) => React.ReactNode,
  options: {
    readonly keys?: FavoriteKeys;
    readonly path?: string;
    readonly offline?: boolean;
  } = {},
) {
  const addFavorites = vi.fn<MusicClient['addFavorites']>(async (input) =>
    input.items.map((item) => ({ ref: item.ref, addedAt: 9 })),
  );
  const removeFavorites = vi.fn<MusicClient['removeFavorites']>(async (input) => input.refs.length);
  const store = createStore();
  const favorites = startOnlineFavorites(store, {
    favoriteKeys: async () => {
      if (options.offline) throw new Error('本地后端尚未连接');
      return options.keys ?? EMPTY;
    },
    favoriteList: async () => ({ items: [], nextCursor: null, total: 0 }),
    addFavorites,
    removeFavorites,
  });
  const tracks = startOnlineTracks(store, { tracks: async () => [] });
  const table = serviceMap([bindService(onlineFavoritesKey, favorites)]);
  act(() =>
    root.render(
      <Provider store={store}>
        <ServicesContext value={table}>{ui(options.path ?? '')}</ServicesContext>
      </Provider>,
    ),
  );
  await flush();
  return { store, favorites, tracks, addFavorites, removeFavorites, table };
}

const button = (selector = 'button') => host.querySelector<HTMLButtonElement>(selector);

describe('收藏键', () => {
  beforeEach(() => {
    (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('播放栏的键：本地曲目与还没读到收藏时只占位，不画键', async () => {
    await mount(() => <PlayerFavoriteKey path="E:\\音乐\\a.flac" className="slot" />);
    expect(button()).toBeNull();
    expect(host.querySelector('.slot[aria-hidden="true"]')).not.toBeNull();
    await mount(
      () => (
        <PlayerFavoriteKey
          path={onlineAddress(50123, musicTrack('7').ref, '320k') ?? ''}
          className="slot"
        />
      ),
      { offline: true },
    );
    expect(button()).toBeNull();
    expect(host.querySelector('.slot[aria-hidden="true"]')).not.toBeNull();
  });

  it('播放栏的键：在线曲目有展示信息就能收，点一下收，已收藏的再点取消', async () => {
    const track = musicTrack('7');
    const path = onlineAddress(50123, track.ref, '320k') ?? '';
    const t = await mount(() => <PlayerFavoriteKey path={path} className="slot" />);
    act(() => t.tracks.remember([track]));
    expect(button()?.disabled).toBe(false);
    expect(button()?.hasAttribute('data-favorite')).toBe(false);
    act(() => button()?.click());
    await flush();
    expect(t.addFavorites).toHaveBeenCalledWith(
      { kind: 'track', items: [track] },
      expect.anything(),
    );
    expect(button()?.hasAttribute('data-favorite')).toBe(true);
    act(() => button()?.click());
    await flush();
    expect(t.removeFavorites).toHaveBeenCalledWith(
      { kind: 'track', refs: [track.ref] },
      expect.anything(),
    );
    expect(button()?.hasAttribute('data-favorite')).toBe(false);
  });

  it('播放栏的键：没取到展示信息的收不了（置灰），已收藏的随时能取消', async () => {
    const track = musicTrack('7');
    const path = onlineAddress(50123, track.ref, '320k') ?? '';
    await mount(() => <PlayerFavoriteKey path={path} className="slot" />);
    expect(button()?.disabled).toBe(true);
    const on = await mount(() => <PlayerFavoriteKey path={path} className="slot" />, {
      keys: { ...EMPTY, track: [['wy', '7', 3]] },
    });
    expect(button()?.disabled).toBe(false);
    act(() => button()?.click());
    await flush();
    expect(on.removeFavorites).toHaveBeenCalledTimes(1);
  });

  it('曲目表里的键：点它只收藏，不带动整行的点击', async () => {
    const track = musicTrack('1000');
    const rowClick = vi.fn();
    const t = await mount(() => (
      <div role="option" aria-selected="false" onClick={rowClick}>
        <FavoriteCell track={track} />
      </div>
    ));
    act(() => button()?.click());
    await flush();
    expect(rowClick).not.toHaveBeenCalled();
    expect(t.addFavorites).toHaveBeenCalledTimes(1);
    expect(button()?.hasAttribute('data-favorite')).toBe(true);
  });

  it('专辑页头的键与艺人名字旁的键：各收各的一类，艺人是加号与勾', async () => {
    const album = musicAlbum('9');
    const artist = musicArtist('3');
    const t = await mount(() => (
      <>
        <FavoriteAlbumKey album={album} className="header" />
        <FollowKey artist={artist} />
      </>
    ));
    const [heart, follow] = host.querySelectorAll('button');
    act(() => heart?.click());
    await flush();
    expect(t.addFavorites).toHaveBeenLastCalledWith(
      { kind: 'album', items: [album] },
      expect.anything(),
    );
    expect(follow?.hasAttribute('data-followed')).toBe(false);
    act(() => follow?.click());
    await flush();
    expect(t.addFavorites).toHaveBeenLastCalledWith(
      { kind: 'artist', items: [artist] },
      expect.anything(),
    );
    expect(host.querySelectorAll('button')[1]?.hasAttribute('data-followed')).toBe(true);
    expect(host.querySelectorAll('button')[0]?.hasAttribute('data-favorite')).toBe(true);
  });
});
