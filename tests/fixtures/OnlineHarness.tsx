import { Provider, useAtomValue } from 'jotai/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppServices } from '../../src/app/services.ts';
import { startupOverlay } from '../../src/app/startupOverlay.ts';
import { bindService } from '../../src/kit/serviceKey.ts';
import { ServicesContext, serviceMap } from '../../src/kit/useService.ts';
import { ncmSetupKey, startNcmSetup } from '../../src/library/search/online/ncmSetup.ts';
import {
  OnlineResults,
  type OnlineResume,
} from '../../src/library/search/online/OnlineResults.tsx';
import { onlinePlayKey, type OnlinePlay } from '../../src/library/search/online/onlinePlay.ts';
import {
  startOnlineSearch,
  type OnlineCategory,
} from '../../src/library/search/online/onlineSearch.ts';
import {
  artistAlbumSearchKey,
  startArtistAlbumSearch,
} from '../../src/library/online/artistAlbumSearch.ts';
import { artistAlbumsKey, startArtistAlbums } from '../../src/library/online/artistAlbums.ts';
import { OnlineAlbumsPage } from '../../src/library/online/OnlineAlbumsPage.tsx';
import { OnlineListPage } from '../../src/library/online/OnlineListPage.tsx';
import { historyAtom } from '../../src/nav/navHistory.ts';
import { onlineListSubject } from '../../src/nav/places.ts';
import { CommandsContext } from '../../src/nav/useCommand.ts';
import { PageEntryContext } from '../../src/nav/usePageSnapshot.ts';
import { onlineListsKey, startOnlineLists } from '../../src/playback/onlineLists.ts';
import { OnlineMusicSection } from '../../src/settings/OnlineMusicSection.tsx';
import {
  MusicClientError,
  musicClientKey,
  type MusicClient,
} from '../../src/playback/musicClient.ts';
import { musicStatusKey, startMusicStatus } from '../../src/playback/musicStatus.ts';
import type {
  MusicFailureCode,
  MusicListKind,
  MusicSearchItems,
  MusicSearchKind,
  MusicSearchResult,
  MusicStatus,
} from '../../src/server/musicProtocol.ts';
import type { MusicLxHealth, MusicLxSource } from '../../src/server/musicLxSources.ts';
import type { MusicAlbum, MusicPlatform } from '../../src/server/musicObjects.ts';
import {
  onlineSourcesKey,
  startOnlineSources,
} from '../../src/library/search/online/onlineSources.ts';
import type { NcmComponentState } from '../../src/server/ncmComponent.ts';
import { ThemeRoot } from '../../src/theme/ThemeRoot.tsx';
import { artistAlbumCatalog } from './artistAlbums.ts';
import { musicAlbum, musicArtist, musicPlaylist, musicTrack } from './music.ts';

// 浏览器测试用的在线结果试验页：搜索结果页的在线音乐范围单独挂出来，音乐客户端换成页面里的替身。
// 地址栏参数：`ncm=missing` 时组件未装，搜索答 not-installed，开始安装后每问一次进度涨一截，涨满即装好；
// `results=empty` 时各类都没有结果；`results=fail` 时每一类的第一次搜索答超时，重试就好；`category` 是起始分类。
// `view=settings` 时挂设置里「在线音乐」一组：`account=signed-in` 起始已登录，扫码后第二次查状态即登录成功；
// `status=pending` 时服务状态一直不答；`unblock=fail` 时改解灰答超时。
// 单击结果里的专辑、艺人、歌单图块进在线列表页；`list=<种类>:<ID>` 时直接从那张列表起，`window.__onlineBack()` 后退，`window.__onlineGo()` 离开列表页（试验页显示结果）。
// 在线列表：ID 404 答不存在；`lists=fail` 时每张的第一次答限流，重试就好；歌单每页 20 首，其余一次给完。
// 艺人专辑：ID 404 答不存在；每页 20 张，一位艺人 30 张，各种类、版本类别都有；`albums=empty` 时没有专辑，
// `albums=bare` 时上游不给种类与曲数，`albums=fail` 时每位艺人的第一次答限流，重试就好，`albums=failmore` 时第二页的第一次答限流，
// `albums=hang` 时第二页一直不答（专辑取不完），`albums=many` 时有 1500 张，每页 200 张。搜索词是「Nujabes 关键词」的专辑搜索答这位艺人的专辑加一张别人的同名专辑，
// 记进 `window.__onlineLog` 的 `artist-album-search`。
// `list=album:5100` 的专辑署名有 12 位艺术家，`list=playlist:6100` 的歌单简介有六段。
// `lx=hosted` 时 lxserver 装好，可选来源有其他平台；`lxsources=none` 时托管的 lxserver 里没有音源，`lxsources=checked`
// 时启用着的音源已有检测结果；`lxcheck=hold` 时检测一直不答，`lxcheck=fail` 时检测请求失败；
// `platformfail=<平台>` 时那个平台的搜索一律答上游不可用。其他平台的搜索只答曲目，别的类别答不支持。
// 起播、入队、取列表、取艺人专辑、登录与设置的请求记进 `window.__onlineLog`。

const PAGE = 20;
const ALBUM_PAGE = 20;
/** 1×1 的透明 PNG，当二维码。 */
const QR_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const SIZE = 17_465_672;

const DATA: { readonly [K in MusicSearchKind]: readonly MusicSearchItems[K][] } = {
  track: Array.from({ length: 45 }, (_, index) =>
    musicTrack(String(1000 + index), {
      title: `Track ${String(index + 1).padStart(2, '0')}`,
      access: index === 1 ? 'vip' : index === 2 ? 'unavailable' : 'free',
      qualities: index % 3 === 0 ? ['128k', '320k', 'flac'] : ['128k', '320k'],
    }),
  ),
  album: Array.from({ length: 12 }, (_, index) => musicAlbum(String(2000 + index))),
  artist: [
    musicArtist('3000', { name: 'Nujabes' }),
    ...Array.from({ length: 11 }, (_, index) => musicArtist(String(3001 + index))),
  ],
  playlist: Array.from({ length: 9 }, (_, index) => musicPlaylist(String(4000 + index))),
};

/**
 * 其他平台（经 lxserver）的曲目：25 首，没有会员与无版权标记，署名与专辑没有平台 ID，
 * 平台不给总数；标题带平台名，好和网易云的结果区分
 */
const otherData = (
  platform: MusicPlatform,
): { readonly [K in MusicSearchKind]: readonly MusicSearchItems[K][] } => ({
  track: Array.from({ length: 25 }, (_, index) =>
    musicTrack(`${platform}${index + 1}`, {
      ref: { platform, id: `${platform}${index + 1}` },
      title: `${platform.toUpperCase()} Track ${String(index + 1).padStart(2, '0')}`,
      artists: [{ ref: null, name: 'Nujabes' }],
      album: { ref: null, title: 'Modal Soul' },
      access: null,
    }),
  ),
  album: [],
  artist: [],
  playlist: [],
});

/** `albums=many`：一位艺人 1500 张专辑，每页 200 张，页面自动取到 1000 张，往下滚才续取 */
const MANY_ALBUMS = Array.from({ length: 1500 }, (_, index) =>
  musicAlbum(String(8000 + index), {
    title: `Many ${String(index + 1).padStart(4, '0')}`,
    releaseDate: `${2024 - Math.floor(index / 100)}-05-20`,
    trackCount: 12,
    artists: [{ ref: { platform: 'wy', id: '3000' }, name: 'Nujabes' }],
  }),
);

/** 试验页里艺人的名字：联网搜专辑的搜索词以它开头 */
const ARTIST_NAME = 'Nujabes';

/** 搜索词是「艺人名 关键词」时答这位艺人标题含关键词的专辑，混一张别人的同名专辑；其余搜索词不管 */
function artistScopedAlbums(query: string): readonly MusicAlbum[] | null {
  if (!query.startsWith(`${ARTIST_NAME} `)) return null;
  const text = query.slice(ARTIST_NAME.length + 1).toLowerCase();
  const mine = artistAlbumCatalog('3000').filter((album) =>
    album.title.toLowerCase().includes(text),
  );
  const other = musicAlbum('9100', {
    title: `${text} (Other)`,
    artists: [{ ref: { platform: 'wy', id: '9' }, name: 'Other' }],
  });
  return [other, ...mine];
}

const LIST_SIZES: Readonly<Record<MusicListKind, number>> = { album: 14, playlist: 45, artist: 12 };
/** 合辑：署名有 12 位艺术家，一行放不下 */
const CROWD_ALBUM = '5100';
/** 简介很长的歌单：两行放不下 */
const LONG_PLAYLIST = '6100';
const LONG_DESCRIPTION = Array.from(
  { length: 6 },
  (_, index) =>
    `第 ${index + 1} 段：适合深夜一个人听的 Jazzy Hip Hop，从 Nujabes 到 Uyama Hiroto，再到 Fat Jon 和 Emancipator。`,
).join('\n');

const OWNERS: { readonly [K in MusicListKind]: (id: string) => MusicSearchItems[K] } = {
  album: (id) =>
    DATA.album.find((item) => item.ref.id === id) ??
    musicAlbum(id, {
      title: id === CROWD_ALBUM ? 'Various Hits' : 'Modal Soul',
      trackCount: LIST_SIZES.album,
      ...(id === CROWD_ALBUM
        ? {
            artists: Array.from({ length: 12 }, (_, index) => ({
              ref: { platform: 'wy' as const, id: String(7001 + index) },
              name: `Artist ${String(index + 1).padStart(2, '0')}`,
            })),
          }
        : {}),
    }),
  playlist: (id) =>
    DATA.playlist.find((item) => item.ref.id === id) ??
    musicPlaylist(id, {
      title: '深夜 Jazzy Hip Hop',
      trackCount: LIST_SIZES.playlist,
      ...(id === LONG_PLAYLIST ? { description: LONG_DESCRIPTION } : {}),
    }),
  artist: (id) =>
    DATA.artist.find((item) => item.ref.id === id) ?? musicArtist(id, { name: 'Nujabes' }),
};
/** 第 6 首无版权；时长各不相同，好核对排序。 */
const listTracks = (kind: MusicListKind, id: string) =>
  Array.from({ length: LIST_SIZES[kind] }, (_, index) =>
    // 专辑署名里的艺人 ID 可以不是数字（如 `a1`）：只取其中的数字，免得整张列表的曲目 ID 都成了 NaN
    musicTrack(String(Number(id.replace(/\D/g, '') || 0) * 100 + index + 1), {
      title: `${kind} ${String(index + 1).padStart(2, '0')}`,
      durationMs: 180_000 + ((index * 7) % 13) * 10_000,
      access: index === 5 ? 'unavailable' : 'free',
    }),
  );

/** 检测各平台得到的结果：酷我可用、酷狗地址打不开、咪咕脚本没给地址、QQ 音乐没有可检测的曲目。 */
const LX_CHECKS: Record<MusicPlatform, MusicLxHealth> = {
  wy: { status: 'unknown', reason: 'no-sample', message: null, ms: 0, at: 0 },
  tx: { status: 'unknown', reason: 'no-sample', message: null, ms: 0, at: 0 },
  kw: { status: 'ok', reason: null, message: null, ms: 215, at: 0 },
  kg: { status: 'failed', reason: 'unreachable', message: 'HTTP 404', ms: 80, at: 0 },
  mg: { status: 'failed', reason: 'script', message: '咪咕找不到', ms: 3100, at: 0 },
};

/** 托管 lxserver 里先有的两份音源：一份启用着，一份加载失败、停用着。 */
const LX_SOURCES: readonly MusicLxSource[] = [
  {
    id: '星海音乐源.js',
    name: '星海音乐源',
    version: 'v3.2.15',
    author: '万去了了',
    description: null,
    platforms: ['tx', 'kw', 'kg', 'mg'],
    enabled: true,
    failed: false,
    error: null,
    health: {},
  },
  {
    id: 'old.js',
    name: 'old.js',
    version: null,
    author: null,
    description: null,
    platforms: ['kw'],
    enabled: false,
    failed: true,
    error: 'SyntaxError: Unexpected token',
    health: {},
  },
];

function log(entry: unknown): void {
  const list: unknown = Reflect.get(window, '__onlineLog');
  Reflect.set(window, '__onlineLog', [...(Array.isArray(list) ? list : []), entry]);
}

function fakeClient(params: URLSearchParams): MusicClient {
  let component: NcmComponentState = {
    package: { version: '4.41.1', size: SIZE, unpackedSize: 36_985_384, licenses: ['ISC', 'MIT'] },
    phase: params.get('ncm') === 'missing' ? 'missing' : 'installed',
    received: 0,
    failure: null,
  };
  const failedOnce = new Set<MusicSearchKind>();
  const listFailed = new Set<string>();
  const albumsFailed = new Set<string>();
  const fail = (code: MusicFailureCode) => Promise.reject(new MusicClientError(code));
  const unsupported = () => Promise.reject(new Error('试验页不提供'));
  let account: MusicStatus['account'] =
    params.get('account') === 'signed-in' ? { nickname: 'Tester' } : null;
  let unblock = false;
  let checks = 0;
  // lx：missing 是组件可下载、还没装；hosted 是装好了、由后端托管；缺省是后端没登记组件。
  let lx: NcmComponentState = {
    package:
      params.get('lx') === null
        ? null
        : { version: '2.1.3', size: 6_089_493, unpackedSize: 20_059_149, licenses: ['Apache-2.0'] },
    phase: params.get('lx') === 'hosted' ? 'installed' : 'missing',
    received: 0,
    failure: null,
  };
  // `lxsources=checked`：启用着的那份已经有十分钟前检测的结果（后端记着的）
  const earlier = Date.now() - 10 * 60_000;
  let sources =
    params.get('lxsources') === 'none'
      ? []
      : LX_SOURCES.map((source) =>
          params.get('lxsources') === 'checked' && source.enabled
            ? {
                ...source,
                health: {
                  kw: { ...LX_CHECKS.kw, at: earlier },
                  kg: { ...LX_CHECKS.kg, at: earlier },
                },
              }
            : source,
        );
  const listed = async (kind: string, detail: unknown, next: () => MusicLxSource[]) => {
    log({ kind, detail });
    sources = next();
    return sources;
  };
  const snapshot = (): MusicStatus => ({
    platforms: lx.phase === 'installed' ? ['wy', 'tx', 'kw', 'kg', 'mg'] : ['wy'],
    ncm: component.phase === 'installed' ? 'installed' : 'missing',
    lx: lx.phase === 'installed' ? 'ready' : 'unconfigured',
    lxServer: null,
    lxHosted: lx.phase === 'installed',
    account,
    unblock,
  });
  return {
    status() {
      return params.get('status') === 'pending'
        ? new Promise<MusicStatus>(() => {})
        : Promise.resolve(snapshot());
    },
    async loginStart() {
      log({ kind: 'login-start' });
      return { key: 'qr', image: QR_IMAGE };
    },
    async loginCheck(key) {
      log({ kind: 'login-check', key });
      checks += 1;
      if (checks < 2) return 'waiting';
      account = { nickname: 'Tester' };
      return 'signed-in';
    },
    async logout() {
      log({ kind: 'logout' });
      account = null;
      return snapshot();
    },
    setUnblock(enabled) {
      log({ kind: 'unblock', enabled });
      if (params.get('unblock') === 'fail') return fail('timeout');
      unblock = enabled;
      return Promise.resolve(snapshot());
    },
    resolve: unsupported,
    tracks: unsupported,
    failures: unsupported,
    configureLx: unsupported,
    testLx: unsupported,
    async lxComponent() {
      return lx;
    },
    // 答下载到一半，下一次读就装好了。
    async installLx() {
      log({ kind: 'lx-install' });
      const half = { ...lx, phase: 'downloading' as const, received: 3_000_000 };
      lx = { ...lx, phase: 'installed' };
      return half;
    },
    async lxSources() {
      return sources;
    },
    addLxSource(input) {
      const name = 'url' in input ? (input.url.split('/').pop() ?? '') : input.name;
      if (('script' in input ? input.script : input.url).includes('REJECT'))
        return fail('source-rejected');
      return listed('lx-add', input, () => [
        ...sources,
        { ...LX_SOURCES[1]!, id: name, name, failed: false, enabled: true, platforms: ['kg'] },
      ]);
    },
    toggleLxSource: (id, enabled) =>
      listed('lx-toggle', { id, enabled }, () =>
        sources.map((source) => (source.id === id ? { ...source, enabled } : source)),
      ),
    removeLxSource: (id) =>
      listed('lx-remove', id, () => sources.filter((source) => source.id !== id)),
    orderLxSources: (ids) =>
      listed('lx-order', ids, () =>
        ids.flatMap((id) => sources.find((source) => source.id === id) ?? []),
      ),
    async checkLxSource(id, platform) {
      log({ kind: 'lx-check', detail: { id, platform } });
      const mode = params.get('lxcheck');
      if (mode === 'fail') throw new MusicClientError('backend-unavailable');
      // 检测中的状态要停得住：一直不答
      if (mode === 'hold') return new Promise<never>(() => {});
      const result = { ...LX_CHECKS[platform], at: Date.now() };
      sources = sources.map((source) =>
        source.id === id ? { ...source, health: { ...source.health, [platform]: result } } : source,
      );
      return result;
    },
    list(input) {
      const key = `${input.kind}:${input.ref.id}`;
      log({ kind: 'list', key, cursor: input.cursor });
      if (input.ref.id === '404') return fail('not-found');
      if (params.get('lists') === 'fail' && !listFailed.has(key)) {
        listFailed.add(key);
        return fail('rate-limited');
      }
      const all = listTracks(input.kind, input.ref.id);
      const start = Number(input.cursor ?? 0);
      const end = input.kind === 'playlist' ? start + PAGE : all.length;
      return Promise.resolve({
        owner: OWNERS[input.kind](input.ref.id),
        items: all.slice(start, end),
        nextCursor: end < all.length ? String(end) : null,
        total: all.length,
        discardedCount: 0,
      });
    },
    artistAlbums(input) {
      const id = input.ref.id;
      const mode = params.get('albums');
      log({ kind: 'artist-albums', key: id, cursor: input.cursor });
      if (id === '404') return fail('not-found');
      const failKey = `${id}:${input.cursor ?? 0}`;
      const failing =
        mode === 'fail' ? input.cursor === null : mode === 'failmore' && input.cursor !== null;
      if (failing && !albumsFailed.has(failKey)) {
        albumsFailed.add(failKey);
        return fail('rate-limited');
      }
      if (mode === 'hang' && input.cursor !== null) return new Promise(() => {});
      const all =
        mode === 'empty'
          ? []
          : mode === 'many'
            ? MANY_ALBUMS
            : artistAlbumCatalog(id, mode === 'bare');
      const pageSize = mode === 'many' ? 200 : ALBUM_PAGE;
      const start = Number(input.cursor ?? 0);
      const end = start + pageSize;
      return Promise.resolve({
        items: all.slice(start, end),
        nextCursor: end < all.length ? String(end) : null,
        total: all.length,
        discardedCount: 0,
      });
    },
    dispose() {},
    async ncm() {
      if (component.phase === 'downloading') {
        const received = Math.min(SIZE, component.received + SIZE / 4);
        component = {
          ...component,
          received,
          phase: received >= SIZE ? 'installed' : 'downloading',
        };
      }
      return component;
    },
    async installNcm() {
      component = { ...component, phase: 'downloading', received: 0 };
      return component;
    },
    search<K extends MusicSearchKind>(input: {
      readonly platform: MusicPlatform;
      readonly kind: K;
      readonly query: string;
      readonly cursor: string | null;
    }): Promise<MusicSearchResult<K>> {
      log({
        kind: 'search',
        type: input.kind,
        cursor: input.cursor,
        platform: input.platform,
      });
      if (input.platform !== 'wy') {
        // lxserver 只搜曲目；`platformfail=<平台>` 时那个平台的搜索一律答上游不可用
        if (input.kind !== 'track') return fail('unsupported');
        if (params.get('platformfail') === input.platform) return fail('upstream-unavailable');
        const everything: readonly MusicSearchItems[K][] = otherData(input.platform)[input.kind];
        const from = Number(input.cursor ?? 0);
        const to = from + PAGE;
        return Promise.resolve({
          items: everything.slice(from, to),
          nextCursor: to < everything.length ? String(to) : null,
          total: null,
          discardedCount: 0,
        });
      }
      if (component.phase !== 'installed') return fail('not-installed');
      if (params.get('results') === 'fail' && !failedOnce.has(input.kind)) {
        failedOnce.add(input.kind);
        return fail('timeout');
      }
      const scoped = input.kind === 'album' ? artistScopedAlbums(input.query) : null;
      if (scoped) log({ kind: 'artist-album-search', query: input.query });
      const source = scoped ? { ...DATA, album: scoped } : DATA;
      const all: readonly MusicSearchItems[K][] =
        params.get('results') === 'empty' ? [] : source[input.kind];
      const start = Number(input.cursor ?? 0);
      const end = start + PAGE;
      return Promise.resolve({
        items: all.slice(start, end),
        nextCursor: end < all.length ? String(end) : null,
        total: all.length,
        discardedCount: 0,
      });
    },
  };
}

const recorder: OnlinePlay = {
  async play(tracks, index, source) {
    log({
      kind: 'play',
      ids: tracks.map((track) => track.ref.id),
      index,
      query: source.name,
      source: source.kind,
    });
    return true;
  },
  async queue(tracks, next) {
    log({ kind: 'queue', ids: tracks.map((track) => track.ref.id), next });
    return true;
  },
};

const CATEGORIES: readonly OnlineCategory[] = ['all', 'artists', 'albums', 'tracks', 'playlists'];

export function OnlineHarness({ services }: { readonly services: AppServices }) {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const resume = useRef<OnlineResume | null>(null);
  const [parts] = useState(() => {
    const client = fakeClient(params);
    const status = startMusicStatus(services.store, client, async () => {});
    const sources = startOnlineSources(services.store, { status, client });
    const search = startOnlineSearch(services.store, client, undefined, sources.selected);
    search.setText('Nujabes');
    const [kind, id] = (params.get('list') ?? '').split(':');
    const start = kind === 'album' || kind === 'playlist' || kind === 'artist' ? kind : null;
    if (start && id) {
      const title = start === 'artist' ? 'Nujabes' : start === 'album' ? 'Modal Soul' : '歌单';
      const ref = { platform: 'wy', id } as const;
      services.history.navigate({
        id: 'onlineList',
        subject: onlineListSubject({ kind: start, ref, title }),
      });
    }
    Reflect.set(window, '__onlineBack', () => services.history.back());
    Reflect.set(window, '__onlineGo', () => services.history.navigate({ id: 'home' }));
    return {
      client,
      search,
      sources,
      lists: startOnlineLists(services.store, client),
      albums: startArtistAlbums(services.store, client),
      albumSearch: startArtistAlbumSearch(services.store, client),
      status,
      setup: startNcmSetup(services.store, client),
    };
  });
  useEffect(() => startupOverlay.dismiss(), []);
  const table = useMemo(
    () =>
      serviceMap([
        ...services.bindings,
        bindService(musicClientKey, parts.client),
        bindService(musicStatusKey, parts.status),
        bindService(onlineSourcesKey, parts.sources),
        bindService(ncmSetupKey, parts.setup),
        bindService(onlineListsKey, parts.lists),
        bindService(artistAlbumsKey, parts.albums),
        bindService(artistAlbumSearchKey, parts.albumSearch),
        bindService(onlinePlayKey, recorder),
      ]),
    [services, parts],
  );
  const initial = CATEGORIES.find((value) => value === params.get('category')) ?? 'all';
  const { place, entry } = useAtomValue(historyAtom, { store: services.store });
  return (
    <Provider store={services.store}>
      <ServicesContext value={table}>
        <CommandsContext value={services.commands}>
          <ThemeRoot>
            <div
              data-online-harness
              style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}
            >
              {params.get('view') === 'settings' ? (
                <OnlineMusicSection />
              ) : place.id === 'onlineList' ? (
                <PageEntryContext value={entry}>
                  <OnlineListPage key={place.subject} place={place} />
                </PageEntryContext>
              ) : place.id === 'onlineAlbums' ? (
                <PageEntryContext value={entry}>
                  <OnlineAlbumsPage key={place.subject} place={place} />
                </PageEntryContext>
              ) : (
                <OnlineResults
                  text="Nujabes"
                  search={parts.search}
                  initial={initial}
                  resume={resume}
                />
              )}
            </div>
          </ThemeRoot>
        </CommandsContext>
      </ServicesContext>
    </Provider>
  );
}
