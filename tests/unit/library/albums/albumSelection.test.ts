import { createMemoryConfigWriter } from '../../../fixtures/dataWriter.ts';
import type { AlbumInfo } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import { startAlbumBrowse } from '../../../../src/library/albums/albumBrowse.ts';
import { ALBUM_LIMIT } from '../../../../src/library/albums.ts';
import {
  albumSelectionAtom,
  startAlbumSelection,
} from '../../../../src/library/albums/albumSelection.ts';
import { startBrowserPrefs } from '../../../../src/library/albums/browserPrefs.ts';
import { albumKeyOf } from '../../../../src/host/libraryContract.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { albumRow } from '../../../fixtures/libraryRows.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';

const ALBUMS = ['A', 'B', 'C', 'D'].map((name) =>
  albumRow(name, 'X', { genre: name < 'C' ? 'Jazz' : 'Rock' }),
);
const PLAIN = { ctrl: false, shift: false };
const CTRL = { ctrl: true, shift: false };

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

async function setup(dimension: 'album' | 'genre' = 'album', prepare?: (host: UnitHost) => void) {
  const host = installFakeHost({ config: { 'defaultTheme.browser.dimension': dimension } });
  host.answer('library.getAlbums', albumsAnswer(ALBUMS));
  prepare?.(host);
  const store = createStore();
  const prefs = startBrowserPrefs(store, host.fb, createMemoryConfigWriter(host.fb));
  const browse = startAlbumBrowse(store, host.fb, createMemoryConfigWriter(host.fb));
  await Promise.all([prefs.ready, browse.ready]);
  const selection = startAlbumSelection(store);
  const names = () => [...store.get(albumSelectionAtom)].map((key) => key.split('\0')[0]).sort();
  return { store, host, prefs, browse, selection, names };
}

const [a, b, c, d] = ALBUMS;

describe('菜单作用对象', () => {
  it('封面在选择里：作用于整个选择，按阅读顺序，选择不变', async () => {
    const { selection, names } = await setup();
    selection.activate(d!, PLAIN);
    selection.activate(b!, CTRL);
    selection.activate(a!, CTRL);
    const targets = selection.menuTargets(b!);
    expect(targets.map((album) => album.name)).toEqual(['A', 'B', 'D']);
    expect(names()).toEqual(['A', 'B', 'D']);
  });

  it('封面不在选择里：选择改为只有它，只作用于它', async () => {
    const { selection, names } = await setup();
    selection.activate(a!, PLAIN);
    selection.activate(b!, CTRL);
    const targets = selection.menuTargets(c!);
    expect(targets.map((album) => album.name)).toEqual(['C']);
    expect(names()).toEqual(['C']);
  });

  it('右键的专辑不在看得见的顺序里：只作用于它，不带上别的已选专辑', async () => {
    const { browse, selection, names } = await setup();
    selection.activate(a!, PLAIN);
    selection.activate(b!, CTRL);
    browse.setTerm('a');
    expect(names()).toEqual(['A']);
    expect(selection.menuTargets(c!).map((album) => album.name)).toEqual(['C']);
  });

  it('拖动带上的专辑与菜单同一口径，但不改选中', async () => {
    const { selection, names } = await setup();
    selection.activate(a!, PLAIN);
    selection.activate(c!, CTRL);
    expect(selection.targetsOf(c!).map((album) => album.name)).toEqual(['A', 'C']);
    expect(selection.targetsOf(b!).map((album) => album.name)).toEqual(['B']);
    expect(names()).toEqual(['A', 'C']);
  });

  it('什么都没选时右键就是只选它', async () => {
    const { selection, names } = await setup();
    expect(selection.menuTargets(d!).map((album) => album.name)).toEqual(['D']);
    expect(names()).toEqual(['D']);
  });
});

describe('选择随看得见的专辑变', () => {
  it('折叠一节，节里的选中去掉；Ctrl+A 只选看得见的', async () => {
    const { browse, selection, names } = await setup('genre');
    selection.selectAll();
    expect(names()).toEqual(['A', 'B', 'C', 'D']);
    browse.toggleSection('Jazz');
    expect(names()).toEqual(['C', 'D']);
    selection.clear();
    selection.selectAll();
    expect(names()).toEqual(['C', 'D']);
  });

  it('过滤掉的去掉，换排序保留', async () => {
    const { store, browse, selection } = await setup();
    selection.selectAll();
    browse.setTerm('b');
    expect([...store.get(albumSelectionAtom)]).toEqual([albumKeyOf(b!)]);
  });

  it('释放后不再跟着变', async () => {
    const { store, browse, selection } = await setup();
    selection.selectAll();
    selection.dispose();
    browse.setTerm('b');
    expect(store.get(albumSelectionAtom).size).toBe(4);
  });
});

describe('分节数据还没就绪时不清选中', () => {
  const credits = {
    success: true as const,
    items: [
      {
        name: 'X',
        albumCount: 4,
        trackCount: 40,
        totalDuration: 0,
        albums: ALBUMS.map((album) => ({ name: album.name, artist: 'X' })),
      },
    ],
    count: 1,
  };

  it('第一次切到艺术家档、署名表还没到手时选中留着，到了之后照新分节保留', async () => {
    let held: ReturnType<UnitHost['hold']> | undefined;
    const { prefs, selection, names } = await setup('album', (host) => {
      held = host.hold('library.getArtists');
    });
    selection.selectAll();
    prefs.setDimension('artist');
    expect(names()).toEqual(['A', 'B', 'C', 'D']);
    await vi.waitFor(() => expect(held?.pending).toHaveLength(1));
    held?.respond(0, credits);
    await vi.waitFor(() => expect(names()).toEqual(['A', 'B', 'C', 'D']));
  });

  it('署名表读失败时选中也留着', async () => {
    const { host, prefs, selection, names } = await setup('album', (fake) => {
      fake.answer('library.getArtists', hostFailure('LIBRARY_DISABLED'));
    });
    selection.selectAll();
    prefs.setDimension('artist');
    await vi.waitFor(() => expect(host.callsTo('library.getArtists')).toHaveLength(1));
    await Promise.resolve();
    expect(names()).toEqual(['A', 'B', 'C', 'D']);
  });
});
