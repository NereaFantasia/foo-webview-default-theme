import { createMemoryConfigWriter } from '../../../fixtures/dataWriter.ts';
import type { PlaylistTrack } from 'foo-webview-sdk';
import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  FILTER_DEBOUNCE_MS,
  MATCH_LIMIT,
  SCAN_PAGE,
  startPlaylistFilter,
} from '../../../../src/playlist/filter/playlistFilter.ts';
import { ROW_FIELDS } from '../../../../src/playlist/playlistRow.ts';
import { startPlaylistRows } from '../../../../src/playlist/playlistRows.ts';
import { startPlaylists } from '../../../../src/playback/playlists.ts';
import { FakePlaylists, guidOf, makePlaylist, makeRow } from '../../../fixtures/fakePlaylists.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';

const MAIN = guidOf(0);
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const typed = () => wait(FILTER_DEBOUNCE_MS + 30);

function lists(host: UnitHost, tracks: readonly PlaylistTrack[]) {
  const fake = new FakePlaylists(
    host,
    [makePlaylist(0, 'Main', { isActive: true })],
    (event, payload) => host.emit(event, payload),
  );
  fake.setTracks(MAIN, tracks);
  return fake;
}

const songs = () => [
  makeRow('Main', 0, { title: 'Blue Moon', artist: 'Someone', genre: 'Jazz' }),
  makeRow('Main', 1, { title: 'Red', artist: 'Moon Band', genre: 'Rock' }),
  makeRow('Main', 2, { title: 'Green', artist: 'Other', genre: 'Pop', date: '1999' }),
  makeRow('Main', 3, { title: 'Moonlight', artist: 'Other', album: 'Night' }),
];

async function start(host: UnitHost, config: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(config)) host.config.set(key, value);
  const store = createStore();
  const playlists = startPlaylists(store, host.fb);
  const rows = startPlaylistRows(store, { stamp: () => 0, refetch: atom(0) }, host.fb);
  let stamps = 0;
  const filter = startPlaylistFilter(
    store,
    { rows, stamp: () => (stamps += 1) },
    host.fb,
    createMemoryConfigWriter(host.fb),
  );
  rows.acquire(MAIN);
  const release = filter.acquire(MAIN);
  await Promise.all([playlists.ready, rows.ready, filter.ready]);
  await wait(200);
  // 行服务起步时取的页不算：之后内容不变时行服务不再取，记下的取行都是过滤扫的。
  host.calls.splice(0);
  const state = () => store.get(filter.stateOf(MAIN));
  const titles = () => state().hits.map((hit) => hit.row.title);
  return { store, filter, release, state, titles };
}

const scans = (host: UnitHost) =>
  host.callsTo('playlist.getTracks').filter((call) => call['count'] === SCAN_PAGE);

describe('startPlaylistFilter', () => {
  it('键入后静默一阵才扫；大小写不敏感，五个字段任一命中，行上带真实行号', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { filter, state, titles } = await start(host);
    filter.setQuery(MAIN, '  mOOn ');
    expect(state()).toMatchObject({ query: '  mOOn ', term: '' });
    expect(scans(host)).toHaveLength(0);
    await typed();
    expect(titles()).toStrictEqual(['Blue Moon', 'Red', 'Moonlight']);
    expect(state().hits.map((hit) => hit.index)).toStrictEqual([0, 1, 3]);
    expect(state()).toMatchObject({ term: 'mOOn', scanning: false, truncated: false, stamp: 1 });
    expect(scans(host)[0]?.['fields']).toStrictEqual([...ROW_FIELDS]);
  });

  it('连着键入只扫最后那个词；flush 不等静默期', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { filter, titles } = await start(host);
    filter.setQuery(MAIN, 'r');
    filter.setQuery(MAIN, 're');
    filter.setQuery(MAIN, 'red');
    await typed();
    expect(scans(host)).toHaveLength(1);
    expect(titles()).toStrictEqual(['Red']);
    filter.setQuery(MAIN, '1999');
    filter.flush(MAIN);
    await wait(20);
    expect(titles()).toStrictEqual(['Green']);
  });

  it('逐字键入时词间的空格留在原文里；只多了首尾空白不重扫', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { filter, state, titles } = await start(host);
    for (const text of ['b', 'bl', 'blu', 'blue']) filter.setQuery(MAIN, text);
    await typed();
    expect(scans(host)).toHaveLength(1);
    filter.setQuery(MAIN, 'blue ');
    expect(state().query).toBe('blue ');
    await typed();
    expect(scans(host)).toHaveLength(1);
    expect(state().term).toBe('blue');
    filter.setQuery(MAIN, 'blue m');
    await typed();
    expect(state()).toMatchObject({ query: 'blue m', term: 'blue m' });
    expect(titles()).toStrictEqual(['Blue Moon']);
  });

  it('限定字段后只比那一个字段；字段范围记进 config，换了按新范围重扫', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { store, filter, titles } = await start(host, { 'defaultTheme.searchScope': 'title' });
    expect(store.get(filter.scopeAtom)).toBe('title');
    filter.setQuery(MAIN, 'moon');
    await typed();
    expect(titles()).toStrictEqual(['Blue Moon', 'Moonlight']);
    filter.setScope('artist');
    await wait(20);
    expect(titles()).toStrictEqual(['Red']);
    expect(host.config.get('defaultTheme.searchScope')).toBe('artist');
  });

  it('空词马上退出过滤、不向宿主要行；clear 之后列表再变也不重扫', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { filter, state } = await start(host);
    filter.setQuery(MAIN, 'moon');
    await typed();
    filter.setQuery(MAIN, '   ');
    expect(state()).toMatchObject({ query: '   ', term: '', hits: [] });
    filter.setQuery(MAIN, 'moon');
    await typed();
    filter.clear(MAIN);
    await host.fb.playlist.reverse(MAIN);
    await wait(400);
    expect(state()).toMatchObject({ query: '', term: '', scanning: false, hits: [] });
  });

  it('跨页扫描；命中到了上限就停并标截断', async () => {
    const host = installFakeHost();
    const total = MATCH_LIMIT + SCAN_PAGE * 2;
    lists(
      host,
      Array.from({ length: total }, (_, row) => makeRow('Main', row, { title: `hit ${row}` })),
    );
    const { filter, state } = await start(host);
    filter.setQuery(MAIN, 'hit');
    filter.flush(MAIN);
    await wait(200);
    expect(state().hits).toHaveLength(MATCH_LIMIT);
    expect(state().truncated).toBe(true);
    expect(scans(host).length).toBeLessThan(total / SCAN_PAGE);
    expect(
      scans(host)
        .map((call) => call['start'])
        .slice(0, 2),
    ).toStrictEqual([0, SCAN_PAGE]);
  });

  it('扫描途中内容变了：旧结果不落地，按新内容重扫；落地之后再变，过滤态不退、换成新命中', async () => {
    const host = installFakeHost();
    const fake = lists(host, songs());
    const { filter, state, titles } = await start(host);
    const held = host.hold('playlist.getTracks');
    filter.setQuery(MAIN, 'moon');
    filter.flush(MAIN);
    await wait();
    await host.fb.playlist.removeTracks(MAIN, [0]);
    held.release();
    await wait(400);
    expect(titles()).toStrictEqual(['Red', 'Moonlight']);
    const current = fake.items[0];
    if (!current) throw new Error('清单里没有 Main');
    fake.setTracks(MAIN, [...fake.tracksOf(current), makeRow('Main', 9, { title: 'New Moon' })]);
    host.emit('playlist:itemsAdded', { playlistGuid: guidOf(0), playlist: 0, start: 3, count: 1 });
    await wait(200);
    expect(state().term).toBe('moon');
    await wait(200);
    expect(titles()).toStrictEqual(['Red', 'Moonlight', 'New Moon']);
  });

  it('读取失败按没有结果：快照清掉、词留着；放手后状态回到空、晚到的结果不写', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { filter, state, release } = await start(host);
    host.answer('playlist.getTracks', hostFailure('INTERNAL_ERROR'));
    filter.setQuery(MAIN, 'moon');
    filter.flush(MAIN);
    await wait(20);
    expect(state()).toMatchObject({
      query: 'moon',
      active: false,
      term: '',
      scanning: false,
      hits: [],
    });
    host.answer('playlist.getTracks', (params) => ({
      success: true,
      playlist: 0,
      start: Number(params['start']),
      count: 0,
      total: 0,
      tracks: [],
    }));
    const held = host.hold('playlist.getTracks');
    filter.flush(MAIN);
    release();
    await wait();
    held.release();
    await wait(20);
    expect(state()).toStrictEqual({
      query: '',
      conditions: [],
      active: false,
      term: '',
      scanning: false,
      truncated: false,
      hits: [],
      stamp: 0,
    });
  });

  it('条件与词同时生效；清掉词条件还在，清掉条件词还在，都清掉退出过滤', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { filter, state, titles } = await start(host);
    const other = { field: 'artist', value: 'other' } as const;
    filter.addCondition(MAIN, other);
    await wait(20);
    expect(state()).toMatchObject({ active: true, term: '' });
    expect(titles()).toStrictEqual(['Green', 'Moonlight']);
    filter.addCondition(MAIN, { field: 'artist', value: 'OTHER' });
    expect(state().conditions).toHaveLength(1);
    filter.setQuery(MAIN, 'moon');
    await typed();
    expect(titles()).toStrictEqual(['Moonlight']);
    filter.clearQuery(MAIN);
    await wait(20);
    expect(state()).toMatchObject({ query: '', active: true });
    expect(titles()).toStrictEqual(['Green', 'Moonlight']);
    filter.setQuery(MAIN, 'green');
    await typed();
    filter.clearConditions(MAIN);
    await wait(20);
    expect(state()).toMatchObject({ query: 'green', conditions: [], active: true });
    expect(titles()).toStrictEqual(['Green']);
    filter.addCondition(MAIN, { field: 'year', value: '1999' });
    await wait(20);
    filter.removeCondition(MAIN, { field: 'year', value: '1999' });
    filter.clear(MAIN);
    expect(state()).toMatchObject({ query: '', conditions: [], active: false, hits: [] });
  });

  it('注释一档才另取注释列，且只在有词时取', async () => {
    const host = installFakeHost();
    lists(host, [
      makeRow('Main', 0, { title: 'A', comment: 'Live at Wembley' }),
      makeRow('Main', 1, { title: 'B', comment: 'Studio' }),
    ]);
    const { filter, titles } = await start(host, { 'defaultTheme.searchScope': 'comment' });
    filter.addCondition(MAIN, { field: 'artist', value: 'Nujabes' });
    await wait(20);
    expect(scans(host).at(-1)?.['formats']).toBeUndefined();
    filter.setQuery(MAIN, 'wembley');
    filter.flush(MAIN);
    await wait(20);
    expect(scans(host).at(-1)?.['formats']).toStrictEqual({ comment: '%comment%' });
    expect(titles()).toStrictEqual(['A']);
    filter.setScope('all');
    await wait(20);
    expect(scans(host).at(-1)?.['formats']).toBeUndefined();
    expect(titles()).toStrictEqual([]);
  });
});
