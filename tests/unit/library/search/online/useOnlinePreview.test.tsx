// @vitest-environment jsdom
import { Provider } from 'jotai/react';
import { atom, createStore } from 'jotai/vanilla';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindService } from '../../../../../src/kit/serviceKey.ts';
import { ServicesContext, serviceMap } from '../../../../../src/kit/useService.ts';
import {
  startOnlineSearch,
  type OnlineSearch,
} from '../../../../../src/library/search/online/onlineSearch.ts';
import {
  useOnlinePreview,
  type OnlinePreviewHandle,
} from '../../../../../src/library/search/online/useOnlinePreview.ts';
import {
  MusicClientError,
  type MusicClient,
  type MusicClientFailureCode,
} from '../../../../../src/playback/musicClient.ts';
import { musicStatusKey, type MusicStatusRead } from '../../../../../src/playback/musicStatus.ts';
import { startSearchOnlinePref } from '../../../../../src/playback/searchOnlinePref.ts';
import type {
  MusicSearchItems,
  MusicSearchKind,
  MusicSearchResult,
} from '../../../../../src/server/musicProtocol.ts';
import { createMemoryConfigWriter } from '../../../../fixtures/dataWriter.ts';
import { musicAlbum, musicArtist, musicPlaylist, musicTrack } from '../../../../fixtures/music.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const ITEMS: { readonly [K in MusicSearchKind]: readonly MusicSearchItems[K][] } = {
  artist: [musicArtist('a1')],
  album: [musicAlbum('b1')],
  track: [musicTrack('t1')],
  playlist: [musicPlaylist('p1')],
};

interface Pending {
  readonly kind: MusicSearchKind;
  answer(): void;
  fail(code: MusicClientFailureCode): void;
}

const flush = () =>
  act(async () => {
    for (let round = 0; round < 5; round += 1) await Promise.resolve();
  });

describe('下拉里在线音乐一区的取数', () => {
  let environment: ActEnvironment;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    environment = globalThis as ActEnvironment;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot(document.createElement('div'));
  });
  afterEach(() => {
    act(() => root.unmount());
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.useRealTimers();
  });

  function setup(read: MusicStatusRead = { status: 'unknown' }) {
    const host = installFakeHost();
    const store = createStore();
    const pending: Pending[] = [];
    const client: Pick<MusicClient, 'search'> = {
      search: <K extends MusicSearchKind>(input: { readonly kind: K }) =>
        new Promise<MusicSearchResult<K>>((resolve, reject) => {
          pending.push({
            kind: input.kind,
            answer: () =>
              resolve({ items: ITEMS[input.kind], nextCursor: null, total: 9, discardedCount: 0 }),
            fail: (code) => reject(new MusicClientError(code)),
          });
        }),
    };
    const search: OnlineSearch = startOnlineSearch(store, client);
    const reconnect = vi.fn(async () => {});
    const status = { state: atom(read), refresh() {}, apply() {}, reconnect, dispose() {} };
    const prefs = startSearchOnlinePref(store, createMemoryConfigWriter(host.fb), host.fb);
    const seen: { current: OnlinePreviewHandle | null } = { current: null };
    function Probe({ draft }: { readonly draft: string }) {
      seen.current = useOnlinePreview(search, draft);
      return null;
    }
    const render = (draft: string) =>
      act(() =>
        root.render(
          createElement(
            Provider,
            { store },
            createElement(
              ServicesContext,
              { value: serviceMap([bindService(musicStatusKey, status)]) },
              createElement(Probe, { draft }),
            ),
          ),
        ),
      );
    const view = () => {
      if (!seen.current) throw new Error('还没渲染');
      return seen.current.view;
    };
    const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
    return { pending, prefs, reconnect, render, view, advance, seen };
  }

  it('停顿后一起取艺人、专辑、曲目，三类都答回才交出', async () => {
    const { pending, render, view, advance } = setup();
    render('Nujabes');
    expect(view().phase).toBe('waiting');
    advance(799);
    expect(pending).toHaveLength(0);
    advance(1);
    expect(pending.map((call) => call.kind)).toEqual(['artist', 'album', 'track']);
    pending[0]?.answer();
    pending[1]?.answer();
    await flush();
    expect(view().phase).toBe('waiting');
    pending[2]?.answer();
    await flush();
    expect(view()).toMatchObject({
      phase: 'ready',
      artists: ITEMS.artist,
      albums: ITEMS.album,
      tracks: ITEMS.track,
    });
  });

  it('等满 5 秒还没答回的类别不画，之后到了也不插进来', async () => {
    const { pending, render, view, advance } = setup();
    render('Nujabes');
    advance(800);
    pending[0]?.answer();
    pending[1]?.answer();
    await flush();
    advance(5000);
    expect(view()).toMatchObject({ phase: 'ready', artists: ITEMS.artist, tracks: [] });
    pending[2]?.answer();
    await flush();
    expect(view()).toMatchObject({ phase: 'ready', tracks: [] });
  });

  it('关掉「搜索时包含在线音乐」时不发请求，整区不出', () => {
    const { pending, prefs, render, view, advance } = setup();
    void prefs.set(false);
    render('Nujabes');
    advance(6000);
    expect(view().phase).toBe('off');
    expect(pending).toHaveLength(0);
  });

  it('网易云组件没下载时不问；问了才知道没下载时整区也不出', async () => {
    const missing = setup({
      status: 'ready',
      music: {
        platforms: [],
        ncm: 'missing',
        lx: 'unconfigured',
        lxServer: null,
        lxHosted: false,
        account: null,
        unblock: false,
      },
    });
    missing.render('Nujabes');
    missing.advance(6000);
    expect(missing.view().phase).toBe('off');
    expect(missing.pending).toHaveLength(0);
    act(() => root.unmount());
    root = createRoot(document.createElement('div'));

    const unknown = setup();
    unknown.render('Nujabes');
    unknown.advance(800);
    for (const call of unknown.pending) call.fail('not-installed');
    await flush();
    expect(unknown.view().phase).toBe('off');
  });

  it('三类都失败时交出失败；重试立即再取，后端连不上时先重连', async () => {
    const { pending, reconnect, render, view, advance, seen } = setup();
    render('Nujabes');
    advance(800);
    for (const call of pending.splice(0)) call.fail('backend-unavailable');
    await flush();
    expect(view()).toMatchObject({ phase: 'failed', failure: 'backend-unavailable' });
    await act(async () => {
      seen.current?.retry();
      await Promise.resolve();
    });
    expect(reconnect).toHaveBeenCalledTimes(1);
    advance(0);
    expect(pending.map((call) => call.kind)).toEqual(['artist', 'album', 'track']);
  });
});
