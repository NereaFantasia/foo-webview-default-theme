import { createMemoryConfigWriter } from '../../../fixtures/dataWriter.ts';
import type { AlbumInfo } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  albumBrowseAtom,
  facetOptionsAtom,
  startAlbumBrowse,
  visibleAlbumsAtom,
} from '../../../../src/library/albums/albumBrowse.ts';
import { HIT_DEBOUNCE_MS, HIT_LIMIT } from '../../../../src/library/albums/albumSearchHits.ts';
import { ALBUM_LIMIT } from '../../../../src/library/albums.ts';
import { startBrowserPrefs } from '../../../../src/library/albums/browserPrefs.ts';
import { hostFailure, type ConfigValue } from '../../../fixtures/hostAnswers.ts';
import { albumRow } from '../../../fixtures/libraryRows.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

const ALBUMS = [
  albumRow('Kind of Blue', 'Miles Davis', { genre: 'Jazz', year: '1959' }),
  albumRow('Abbey Road', 'The Beatles', { genre: 'Rock', year: '1969' }),
  albumRow('Blue Train', 'John Coltrane', { genre: 'Jazz', year: '1957' }),
];

function albumsAnswer(albums: AlbumInfo[]) {
  return {
    success: true as const,
    albums,
    total: albums.length,
    offset: 0,
    limit: ALBUM_LIMIT,
    hasMore: false,
    includeCover: false,
    fromCache: false,
  };
}

function hostWith(albums: AlbumInfo[], config: Record<string, ConfigValue> = {}) {
  const host = installFakeHost({ config });
  host.answer('library.getAlbums', albumsAnswer(albums));
  return host;
}

async function setup(host: UnitHost) {
  const store = createStore();
  const prefs = startBrowserPrefs(store, host.fb, createMemoryConfigWriter(host.fb));
  const browse = startAlbumBrowse(store, host.fb, createMemoryConfigWriter(host.fb));
  await Promise.all([prefs.ready, browse.ready]);
  const state = () => store.get(albumBrowseAtom);
  const sectionNames = () =>
    state().sections.map((section) => [section.key, section.albums.map((album) => album.name)]);
  return { store, prefs, browse, state, sectionNames };
}

describe('分节与排序', () => {
  it('平铺档一节、不画节头，按偏好的排序', async () => {
    const { prefs, state, sectionNames } = await setup(hostWith(ALBUMS));
    expect(state()).toMatchObject({ phase: 'ready', headers: false, repeats: false, shown: 3 });
    expect(sectionNames()).toEqual([[null, ['Abbey Road', 'Blue Train', 'Kind of Blue']]]);
    prefs.setSort('year');
    expect(sectionNames()).toEqual([[null, ['Abbey Road', 'Kind of Blue', 'Blue Train']]]);
  });

  it('读回存档里的分节依据，按流派出节头', async () => {
    const host = hostWith(ALBUMS, { 'defaultTheme.browser.dimension': 'genre' });
    const { state, sectionNames } = await setup(host);
    expect(state().headers).toBe(true);
    expect(sectionNames()).toEqual([
      ['Jazz', ['Blue Train', 'Kind of Blue']],
      ['Rock', ['Abbey Road']],
    ]);
  });

  it('折叠的节不进阅读顺序，再点一次展开', async () => {
    const host = hostWith(ALBUMS, { 'defaultTheme.browser.dimension': 'genre' });
    const { store, browse } = await setup(host);
    browse.toggleSection('Jazz');
    expect(store.get(visibleAlbumsAtom).map((album) => album.name)).toEqual(['Abbey Road']);
    browse.toggleSection('Jazz');
    expect(store.get(visibleAlbumsAtom)).toHaveLength(3);
  });

  it('艺术家档等署名表到了才分节，之前画骨架', async () => {
    const host = hostWith(ALBUMS);
    const held = host.hold('library.getArtists');
    const { prefs, state, sectionNames } = await setup(host);
    prefs.setDimension('artist');
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    expect(state()).toMatchObject({ phase: 'loading', sections: [], repeats: true });
    held.respond(0, {
      success: true,
      items: [
        {
          name: 'Miles Davis',
          albumCount: 1,
          trackCount: 9,
          totalDuration: 0,
          albums: [{ name: 'Kind of Blue', artist: 'Miles Davis' }],
        },
      ],
      count: 1,
    });
    await vi.waitFor(() => expect(state().phase).toBe('ready'));
    expect(sectionNames()).toEqual([
      ['Miles Davis', ['Kind of Blue']],
      [null, ['Abbey Road', 'Blue Train']],
    ]);
  });
});

describe('过滤与筛选', () => {
  it('过滤词先按专辑字段筛，曲目级命中回来后整张并进来', async () => {
    vi.useFakeTimers();
    const host = hostWith(ALBUMS);
    host.answer('library.search', {
      success: true,
      tracks: [{ album: 'Abbey Road', albumArtist: 'The Beatles', artists: ['The Beatles'] }],
      total: 1,
      offset: 0,
      limit: HIT_LIMIT,
      hasMore: false,
    });
    const { browse, state } = await setup(host);
    browse.setTerm('blue');
    expect(state().shown).toBe(2);
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    expect(state().shown).toBe(3);
  });

  it('没有匹配时等曲目级命中回来才判 noMatch', async () => {
    vi.useFakeTimers();
    const host = hostWith(ALBUMS);
    const { browse, state } = await setup(host);
    browse.setTerm('zzz');
    expect(state()).toMatchObject({ shown: 0, phase: 'ready' });
    await vi.advanceTimersByTimeAsync(HIT_DEBOUNCE_MS);
    expect(state().phase).toBe('noMatch');
    browse.setTerm('');
    expect(state()).toMatchObject({ shown: 3, phase: 'ready' });
  });

  it('筛选的取值来自专辑清单，勾选跨列 AND；清掉恢复', async () => {
    const { store, browse, state } = await setup(hostWith(ALBUMS));
    expect(store.get(facetOptionsAtom).genre.map((value) => value.name)).toEqual(['Jazz', 'Rock']);
    browse.toggleFacet('genre', 'Jazz');
    browse.toggleFacet('decade', '1950s');
    expect(state().shown).toBe(2);
    browse.toggleFacet('decade', '1950s');
    browse.toggleFacet('decade', '1960s');
    expect(state()).toMatchObject({ shown: 0, phase: 'noMatch' });
    browse.clearFacets();
    expect(state().shown).toBe(3);
  });
});

const COLLAPSED = 'defaultTheme.browser.collapsed';
const MIXED = [
  albumRow('Kind of Blue', 'Miles Davis', {
    genre: 'Jazz',
    firstTrackPath: 'file://E:\\Music\\Jazz\\Kind of Blue\\01.flac',
  }),
  albumRow('Untitled', 'Nobody', { genre: '', firstTrackPath: 'file://E:\\Loose\\01.flac' }),
];

describe('折叠', () => {
  it('按分节依据分开记：流派档折叠「未知」后切到文件夹档不受影响，切回来还在', async () => {
    const host = hostWith(MIXED, { 'defaultTheme.browser.dimension': 'genre' });
    const { store, prefs, browse, state } = await setup(host);
    browse.toggleSection(null);
    expect([...state().collapsed]).toEqual([null]);
    prefs.setDimension('folder');
    expect([...state().collapsed]).toEqual([]);
    expect(store.get(visibleAlbumsAtom)).toHaveLength(2);
    prefs.setDimension('genre');
    expect([...state().collapsed]).toEqual([null]);
  });

  it('写进 config，下次启动读回之后浏览才算就绪', async () => {
    const host = hostWith(MIXED, { 'defaultTheme.browser.dimension': 'genre' });
    const first = await setup(host);
    first.browse.toggleSection('Jazz');
    first.browse.toggleSection(null);
    await first.browse.persistence.settled();
    expect(host.config.get(COLLAPSED)).toEqual({ wall: { genre: ['Jazz', null] } });
    first.browse.toggleSection('Jazz');
    await first.browse.persistence.settled();
    expect(host.config.get(COLLAPSED)).toEqual({ wall: { genre: [null] } });
    first.browse.dispose();
    const second = await setup(host);
    expect([...second.state().collapsed]).toEqual([null]);
  });
});

describe('库变更之后的筛选', () => {
  it('勾选里已经不存在的值剔掉，不会筛出 0 张又没法取消', async () => {
    const host = hostWith(ALBUMS);
    const { browse, state } = await setup(host);
    browse.toggleFacet('genre', 'Rock');
    browse.toggleFacet('genre', 'Jazz');
    expect(state().shown).toBe(3);
    host.answer(
      'library.getAlbums',
      albumsAnswer(ALBUMS.filter((album) => album.genre === 'Jazz')),
    );
    await browse.retry();
    expect([...state().facets.genre]).toEqual(['Jazz']);
    host.answer('library.getAlbums', albumsAnswer([albumRow('Other', 'X', { genre: 'Pop' })]));
    await browse.retry();
    expect(state().facets.genre.size).toBe(0);
    expect(state()).toMatchObject({ shown: 1, phase: 'ready' });
  });
});

describe('此刻画哪一态', () => {
  it('库没开先于一切', async () => {
    const host = hostWith([]);
    host.answer('library.isEnabled', { success: true, enabled: false });
    const { state } = await setup(host);
    expect(state().phase).toBe('disabled');
  });

  it('首次读取中是骨架，读回空清单是空库', async () => {
    const host = hostWith([]);
    const held = host.hold('library.getAlbums');
    const store = createStore();
    startBrowserPrefs(store, host.fb, createMemoryConfigWriter(host.fb));
    startAlbumBrowse(store, host.fb, createMemoryConfigWriter(host.fb));
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    expect(store.get(albumBrowseAtom).phase).toBe('loading');
    held.release();
    await vi.waitFor(() => expect(store.get(albumBrowseAtom).phase).toBe('empty'));
  });

  it('读取失败归 ready 并留着旧清单；重试重读清单', async () => {
    const host = hostWith(ALBUMS);
    const { browse, state } = await setup(host);
    host.answer('library.getAlbums', hostFailure('OPERATION_FAILED'));
    await browse.retry();
    expect(state()).toMatchObject({ phase: 'ready', shown: 3 });
    expect(host.callsTo('library.getAlbums')).toHaveLength(2);
    expect(host.callsTo('library.getArtists')).toEqual([]);
  });
});
