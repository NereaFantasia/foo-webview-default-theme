import type { ArtistInfo } from 'foo-webview-sdk';
import { atom, createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  albumArtistRows,
  CREDITED_LIMIT,
  creditedRows,
  startCreditedArtists,
} from '../../../../src/library/artists/artistIndex.ts';
import { albumKeyOf, LIBRARY_COALESCE_MS } from '../../../../src/host/libraryContract.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { albumRow } from '../../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

afterEach(() => vi.useRealTimers());

function info(name: string, albums: [string, string][], trackCount = 10): ArtistInfo {
  return {
    name,
    albumCount: 1,
    trackCount,
    totalDuration: trackCount * 200,
    albums: albums.map(([album, by]) => ({ name: album, artist: by })),
  };
}

describe('艺人清单', () => {
  it('专辑艺术家口径按专辑行归人，曲目数与时长累加，空专辑艺术家归到「没写艺术家」', () => {
    const rows = albumArtistRows([
      albumRow('Modal Soul', 'Nujabes', { trackCount: 14, duration: 3600 }),
      albumRow('Metaphorical Music', 'Nujabes', { trackCount: 16, duration: 3900 }),
      albumRow('Untitled', '', { trackCount: 3, duration: 600 }),
    ]);
    expect(rows).toEqual([
      {
        name: 'Nujabes',
        albumCount: 2,
        trackCount: 30,
        duration: 7500,
        albums: [
          albumKeyOf({ name: 'Modal Soul', albumArtist: 'Nujabes' }),
          albumKeyOf({ name: 'Metaphorical Music', albumArtist: 'Nujabes' }),
        ],
      },
      {
        name: '',
        albumCount: 1,
        trackCount: 3,
        duration: 600,
        albums: [albumKeyOf({ name: 'Untitled', albumArtist: '' })],
      },
    ]);
  });

  it('署名口径的专辑数按专辑引用数：同名不同人的两张算两张；没名字的条目丢掉', () => {
    const rows = creditedRows([
      info('Shing02', [
        ['Luv(sic)', 'Nujabes'],
        ['Luv(sic)', 'Shing02'],
      ]),
      info('', [['X', 'Y']]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Shing02',
      albumCount: 2,
      trackCount: 10,
      duration: 2000,
    });
  });

  it('只在需要时取；库变更合并一阵再重取，失败留着旧清单', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    host.answer('library.getArtists', { success: true, items: [info('A', [])], count: 1 });
    const store = createStore();
    const needed = atom(false);
    const service = startCreditedArtists(store, needed, host.fb);
    onTestFinished(() => service.dispose());
    await service.ready;
    expect(host.callsTo('library.getArtists')).toHaveLength(0);
    store.set(needed, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(host.callsTo('library.getArtists')).toEqual([
      { limit: CREDITED_LIMIT, includeAlbums: true },
    ]);
    expect(store.get(service.state)).toMatchObject({ status: 'ready', truncated: false });
    host.answer('library.getArtists', hostFailure('OPERATION_FAILED'));
    host.emit('library:itemsAdded', { count: 1, timestamp: 1 });
    host.emit('library:itemsModified', { count: 1, timestamp: 2 });
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    expect(host.callsTo('library.getArtists')).toHaveLength(2);
    expect(store.get(service.state)).toMatchObject({ status: 'failed', rows: [{ name: 'A' }] });
    store.set(needed, false);
    host.emit('library:itemsRemoved', { count: 1, timestamp: 3 });
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    expect(host.callsTo('library.getArtists')).toHaveLength(2);
    host.answer('library.getArtists', {
      success: true,
      items: Array.from({ length: 2 }, (_, at) => info(`N${at}`, [])),
      count: 2,
    });
    store.set(needed, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(host.callsTo('library.getArtists')).toHaveLength(3);
    expect(store.get(service.state).rows).toHaveLength(2);
  });
});
