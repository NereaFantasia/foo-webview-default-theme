import type { PlaylistGroupRun } from 'foo-webview-sdk';
import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  FACETS_COALESCE_MS,
  MAX_FACET_ROWS,
  startPlaylistFacets,
} from '../../../../src/playlist/filter/playlistFacets.ts';
import { startPlaylistRows } from '../../../../src/playlist/playlistRows.ts';
import { startPlaylists } from '../../../../src/playback/playlists.ts';
import { FakePlaylists, guidOf, makePlaylist, makeRow } from '../../../fixtures/fakePlaylists.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';

const MAIN = guidOf(0);
const SEP = '\u001f';
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
/** 等过行服务与分面两道合并窗口，外加应答 */
const settled = () => wait(FACETS_COALESCE_MS + 400);

const run = (start: number, count: number, key: string): PlaylistGroupRun => ({
  start,
  count,
  key,
});

/** 三栏各答各的游程，按发来的键认是哪一栏 */
function answerRuns(host: UnitHost) {
  const runs = {
    genre: [run(0, 3, `Rock${SEP}Pop`), run(3, 2, 'Jazz'), run(5, 2, 'Rock'), run(7, 3, '')],
    artist: [run(0, 5, `Chia${SEP}Triodust`), run(5, 5, 'Nujabes')],
    year: [run(0, 4, '1998'), run(4, 2, '2003'), run(6, 2, ''), run(8, 2, 'May ')],
  };
  host.answer('playlist.getGroupRuns', (params) => {
    const pattern = String(Array.isArray(params['patterns']) ? params['patterns'][0] : '');
    const answered = pattern.includes('genre')
      ? runs.genre
      : pattern.includes('artist')
        ? runs.artist
        : runs.year;
    return {
      success: true,
      playlist: 0,
      playlistGuid: MAIN,
      total: 10,
      runs: answered,
      contentVersion: '0',
    };
  });
}

function setup(host: UnitHost, length = 10) {
  const lists = new FakePlaylists(
    host,
    [makePlaylist(0, 'Main', { isActive: true, trackCount: length })],
    (event, payload) => host.emit(event, payload),
  );
  lists.setTracks(
    MAIN,
    Array.from({ length }, (_, row) => makeRow('Main', row)),
  );
  return lists;
}

async function start(host: UnitHost) {
  const store = createStore();
  const playlists = startPlaylists(store, host.fb);
  const rows = startPlaylistRows(store, { stamp: () => 0, refetch: atom(0) }, host.fb);
  const facets = startPlaylistFacets(store, { rows }, host.fb);
  rows.acquire(MAIN);
  await Promise.all([playlists.ready, rows.ready]);
  const release = facets.acquire(MAIN);
  const state = () => store.get(facets.stateOf(MAIN));
  return { facets, release, state };
}

const asked = (host: UnitHost) => host.callsTo('playlist.getGroupRuns');

describe('startPlaylistFacets', () => {
  it('流派与艺人取全部标签值，同一个值的各段首数相加；年代按年份归档', async () => {
    const host = installFakeHost();
    setup(host);
    answerRuns(host);
    const { state } = await start(host);
    await settled();
    expect(state().status).toBe('ready');
    const options = state().options;
    expect(options?.genre).toStrictEqual([
      { name: 'Rock', count: 5 },
      { name: 'Pop', count: 3 },
      { name: 'Jazz', count: 2 },
    ]);
    // 同数的按名字排
    expect(options?.artist).toStrictEqual([
      { name: 'Chia', count: 5 },
      { name: 'Nujabes', count: 5 },
      { name: 'Triodust', count: 5 },
    ]);
    // 新的年代在前，没写日期的「未知」垫底，不以四位数字开头的日期不归任何一档
    expect(options?.decade).toStrictEqual([
      { name: '2000s', count: 2 },
      { name: '1990s', count: 4 },
      { name: 'unknown', count: 2 },
    ]);
  });

  it('流派与艺人按全部标签值取，年代按日期的前四个字取：每栏各问一次', async () => {
    const host = installFakeHost();
    setup(host);
    answerRuns(host);
    await start(host);
    await settled();
    const patterns = asked(host).map((call) => (call['patterns'] as string[])[0]);
    expect(patterns).toStrictEqual([
      '$if($meta_num(genre),$meta_sep(genre,$char(31)),)',
      '$left(%date%,4)',
      '$if($meta_num(artist),$meta_sep(artist,$char(31)),)',
    ]);
  });

  it('宿主取不到时不给取值', async () => {
    const host = installFakeHost();
    setup(host);
    host.answer('playlist.getGroupRuns', hostFailure('OPERATION_FAILED'));
    const { state } = await start(host);
    await settled();
    expect(state()).toStrictEqual({ status: 'unavailable', options: null });
  });

  it('列表太大不取：游程只认相邻的行，不按这一栏排时回包随行数长', async () => {
    const host = installFakeHost();
    setup(host, MAX_FACET_ROWS + 1);
    answerRuns(host);
    const { state } = await start(host);
    await wait(FACETS_COALESCE_MS + 1500);
    expect(state()).toStrictEqual({ status: 'unavailable', options: null });
    expect(asked(host)).toHaveLength(0);
  });

  it('列表内容变了合并一个窗口后重取；放手后回到空，也不再取', async () => {
    const host = installFakeHost();
    setup(host);
    answerRuns(host);
    const { state, release } = await start(host);
    await settled();
    expect(asked(host)).toHaveLength(3);
    await host.fb.playlist.removeTracks(MAIN, [0]);
    await settled();
    expect(asked(host)).toHaveLength(6);
    release();
    await wait();
    expect(state()).toStrictEqual({ status: 'idle', options: null });
    await host.fb.playlist.removeTracks(MAIN, [0]);
    await settled();
    expect(asked(host)).toHaveLength(6);
  });
});
