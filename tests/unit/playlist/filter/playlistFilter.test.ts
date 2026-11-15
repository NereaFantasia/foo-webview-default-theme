import { createMemoryConfigWriter } from '../../../fixtures/dataWriter.ts';
import type { PlaylistTrack } from 'foo-webview-sdk';
import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import {
  FILTER_DEBOUNCE_MS,
  MATCH_LIMIT,
  NO_FILTER,
  SCAN_PAGE,
  startPlaylistFilter,
} from '../../../../src/playlist/filter/playlistFilter.ts';
import { startPlaylistRows } from '../../../../src/playlist/playlistRows.ts';
import { startPlaylists } from '../../../../src/playback/playlists.ts';
import type { QueryInput } from '../../../../src/track/queryInput.ts';
import type { PresetId } from '../../../../src/track/queryPresets.ts';
import type { TrackCondition } from '../../../../src/track/trackConditions.ts';
import { EMPTY_TRACK_FACETS } from '../../../../src/track/trackFacets.ts';
import { EMPTY_TRACK_FILTER } from '../../../../src/track/trackFilter.ts';
import { FakePlaylists, guidOf, makePlaylist, makeRow } from '../../../fixtures/fakePlaylists.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';

const MAIN = guidOf(0);
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const typed = () => wait(FILTER_DEBOUNCE_MS + 30);
const textInput = (text: string): QueryInput => ({ mode: 'text', text, advancedText: '' });
const advancedInput = (advancedText: string, text = ''): QueryInput => ({
  mode: 'advanced',
  text,
  advancedText,
});
const artistIs = (value: string): TrackCondition => ({
  field: 'artist',
  operator: 'is',
  value,
  end: '',
});

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
  makeRow('Main', 0, { title: 'Blue Moon', artist: 'Someone', genre: 'Jazz', rating: 5 }),
  makeRow('Main', 1, { title: 'Red', artist: 'Moon Band', genre: 'Rock', rating: 2 }),
  makeRow('Main', 2, { title: 'Green', artist: 'Other', genre: 'Pop', date: '1999', rating: 4 }),
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
    null,
  );
  rows.acquire(MAIN);
  const release = filter.acquire(MAIN);
  await Promise.all([playlists.ready, rows.ready, filter.ready]);
  await wait(200);
  // 行服务起步时取的页不算：之后内容不变时行服务不再取，记下的调用都是筛选发的
  host.calls.splice(0);
  const state = () => store.get(filter.stateOf(MAIN));
  const titles = () => state().hits.map((hit) => hit.row.title);
  return { store, filter, release, state, titles };
}

const matchingCalls = (host: UnitHost) => host.callsTo('playlist.getMatchingRows');
const queries = (host: UnitHost) => matchingCalls(host).map((call) => call['query']);
/** 筛选不再翻页扫描整张列表：宿主求值，只按命中的行号取行 */
const scans = (host: UnitHost) =>
  host.callsTo('playlist.getTracks').filter((call) => call['count'] === SCAN_PAGE);

describe('startPlaylistFilter', () => {
  it('键入后静默一阵才问宿主；词交宿主求值、不翻页扫整张列表，行上带真实行号', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { filter, state, titles } = await start(host);
    filter.setInput(MAIN, textInput('  mOOn '));
    expect(state()).toMatchObject({ query: '  mOOn ', term: '' });
    expect(matchingCalls(host)).toHaveLength(0);
    await typed();
    expect(titles()).toStrictEqual(['Blue Moon', 'Red', 'Moonlight']);
    expect(state().hits.map((hit) => hit.index)).toStrictEqual([0, 1, 3]);
    expect(state()).toMatchObject({ term: 'mOOn', scanning: false, truncated: false, stamp: 1 });
    expect(queries(host)).toHaveLength(1);
    expect(String(queries(host)[0])).toContain('title HAS "moon"');
    expect(host.callsTo('playlist.getTracksAt').map((call) => call['rows'])).toStrictEqual([
      [0, 1, 3],
    ]);
    expect(scans(host)).toHaveLength(0);
  });

  it('连着键入只问最后那个词；flush 不等静默期', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { filter, titles } = await start(host);
    filter.setInput(MAIN, textInput('r'));
    filter.setInput(MAIN, textInput('re'));
    filter.setInput(MAIN, textInput('red'));
    await typed();
    expect(matchingCalls(host)).toHaveLength(1);
    expect(titles()).toStrictEqual(['Red']);
    filter.setInput(MAIN, textInput('1999'));
    filter.flush(MAIN);
    await wait(20);
    expect(titles()).toStrictEqual(['Green']);
  });

  it('逐字键入时词间的空格留在原文里；只多了首尾空白不重问', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { filter, state, titles } = await start(host);
    for (const text of ['b', 'bl', 'blu', 'blue']) filter.setInput(MAIN, textInput(text));
    await typed();
    expect(matchingCalls(host)).toHaveLength(1);
    filter.setInput(MAIN, textInput('blue '));
    expect(state().query).toBe('blue ');
    await typed();
    expect(matchingCalls(host)).toHaveLength(1);
    expect(state().term).toBe('blue');
    filter.setInput(MAIN, textInput('blue m'));
    await typed();
    expect(state()).toMatchObject({ query: 'blue m', term: 'blue m' });
    expect(titles()).toStrictEqual(['Blue Moon']);
  });

  it('限定字段后只比那一个字段；字段范围记进 config，换了按新范围重算', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { store, filter, titles } = await start(host, { 'defaultTheme.searchScope': 'title' });
    expect(store.get(filter.scopeAtom)).toBe('title');
    filter.setInput(MAIN, textInput('moon'));
    await typed();
    expect(titles()).toStrictEqual(['Blue Moon', 'Moonlight']);
    expect(queries(host)).toStrictEqual(['title HAS "moon"']);
    filter.setScope('artist');
    await wait(20);
    expect(titles()).toStrictEqual(['Red']);
    expect(host.config.get('defaultTheme.searchScope')).toBe('artist');
  });

  it('空词马上退出过滤、不问宿主；clear 之后列表再变也不重算', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { filter, state } = await start(host);
    filter.setInput(MAIN, textInput('moon'));
    await typed();
    const asked = matchingCalls(host).length;
    filter.setInput(MAIN, textInput('   '));
    expect(state()).toMatchObject({ query: '   ', term: '', hits: [] });
    expect(matchingCalls(host)).toHaveLength(asked);
    filter.setInput(MAIN, textInput('moon'));
    await typed();
    filter.clear(MAIN);
    await host.fb.playlist.reverse(MAIN);
    await wait(400);
    expect(state()).toMatchObject({ query: '', term: '', scanning: false, hits: [] });
  });

  it('命中多时按页取行；到了上限就停并标截断', async () => {
    const host = installFakeHost();
    const total = MATCH_LIMIT + SCAN_PAGE * 2;
    lists(
      host,
      Array.from({ length: total }, (_, row) => makeRow('Main', row, { title: `hit ${row}` })),
    );
    const { filter, state } = await start(host);
    filter.setInput(MAIN, textInput('hit'));
    filter.flush(MAIN);
    await wait(300);
    expect(state().hits).toHaveLength(MATCH_LIMIT);
    expect(state().truncated).toBe(true);
    const pages = host.callsTo('playlist.getTracksAt');
    expect(pages.length).toBeLessThan(total / SCAN_PAGE);
    expect(
      pages.map((call) => Array.isArray(call['rows']) && call['rows'][0]).slice(0, 2),
    ).toStrictEqual([0, SCAN_PAGE]);
    expect(scans(host)).toHaveLength(0);
  });

  it('取行途中内容变了：旧结果不落地，按新内容重算；落地之后再变，过滤态不退、换成新命中', async () => {
    const host = installFakeHost();
    const fake = lists(host, songs());
    const { filter, state, titles } = await start(host);
    const held = host.hold('playlist.getTracksAt');
    filter.setInput(MAIN, textInput('moon'));
    filter.flush(MAIN);
    await vi.waitFor(() => expect(host.callsTo('playlist.getTracksAt')).toHaveLength(1));
    await host.fb.playlist.removeTracks(MAIN, [0]);
    held.release();
    await wait(400);
    expect(titles()).toStrictEqual(['Red', 'Moonlight']);
    const current = fake.items[0];
    if (!current) throw new Error('清单里没有 Main');
    fake.setTracks(MAIN, [...fake.tracksOf(current), makeRow('Main', 9, { title: 'New Moon' })]);
    host.emit('playlist:itemsAdded', {
      playlistGuid: guidOf(0),
      playlist: 0,
      start: 3,
      count: 1,
      contentVersion: '1',
    });
    await wait(200);
    expect(state().term).toBe('moon');
    await wait(200);
    expect(titles()).toStrictEqual(['Red', 'Moonlight', 'New Moon']);
  });

  it('求值失败按没有结果：快照清掉、词留着；放手后状态回到空、晚到的结果不写', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { filter, state, release } = await start(host);
    host.answer('playlist.getMatchingRows', hostFailure('INTERNAL_ERROR'));
    filter.setInput(MAIN, textInput('moon'));
    filter.flush(MAIN);
    await wait(20);
    expect(state()).toMatchObject({
      query: 'moon',
      active: false,
      term: '',
      scanning: false,
      hits: [],
      invalid: false,
    });
    host.answer('playlist.getMatchingRows', () => ({
      success: true,
      playlist: 0,
      playlistGuid: MAIN,
      total: 0,
      items: [],
      count: 0,
      contentVersion: '0',
    }));
    const held = host.hold('playlist.getMatchingRows');
    filter.flush(MAIN);
    release();
    await wait();
    held.release();
    await wait(20);
    expect(state()).toStrictEqual(NO_FILTER);
  });

  it('预设、条件与词同时生效；清掉词条件还在，清掉条件词还在，都清掉退出过滤', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { filter, state, titles } = await start(host);
    filter.addCondition(MAIN, artistIs('other'));
    await wait(20);
    expect(state()).toMatchObject({ active: true, term: '' });
    expect(titles()).toStrictEqual(['Green', 'Moonlight']);
    filter.addCondition(MAIN, artistIs('other'));
    expect(state().conditions).toHaveLength(1);
    filter.setInput(MAIN, textInput('moon'));
    await typed();
    expect(titles()).toStrictEqual(['Moonlight']);
    filter.setInput(MAIN, textInput(''));
    await wait(20);
    expect(state()).toMatchObject({ query: '', active: true });
    expect(titles()).toStrictEqual(['Green', 'Moonlight']);
    filter.togglePreset(MAIN, 'highRated');
    await wait(20);
    expect(titles()).toStrictEqual(['Green']);
    filter.setInput(MAIN, textInput('green'));
    await typed();
    filter.clearConditions(MAIN);
    await wait(20);
    expect(state()).toMatchObject({ query: 'green', conditions: [], active: true });
    expect(state().presets.size).toBe(0);
    expect(titles()).toStrictEqual(['Green']);
    filter.togglePreset(MAIN, 'highRated');
    await wait(20);
    filter.clear(MAIN);
    expect(state()).toMatchObject({ query: '', conditions: [], active: false, hits: [] });
    expect(state().presets.size).toBe(0);
  });

  it('预设是宿主查询：勾上收窄到命中，再勾一次取消；冲突的预设勾上时互相取消', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { filter, state, titles } = await start(host);
    filter.togglePreset(MAIN, 'highRated');
    await wait(20);
    expect(queries(host)).toStrictEqual(['%rating% GREATER 3']);
    expect(titles()).toStrictEqual(['Blue Moon', 'Green']);
    filter.togglePreset(MAIN, 'unrated');
    await wait(20);
    expect([...state().presets]).toStrictEqual(['unrated']);
    expect(titles()).toStrictEqual(['Moonlight']);
    filter.togglePreset(MAIN, 'unrated');
    await wait(20);
    expect(state()).toMatchObject({ active: false, hits: [] });
  });

  it('宿主写不出查询的条件不加；条件与预设拼成一条查询', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { filter, state, titles } = await start(host);
    filter.addCondition(MAIN, artistIs('a"b'));
    filter.addCondition(MAIN, artistIs(''));
    expect(state().conditions).toHaveLength(0);
    filter.addCondition(MAIN, artistIs('other'));
    filter.togglePreset(MAIN, 'highRated');
    await wait(20);
    expect(titles()).toStrictEqual(['Green']);
    expect(queries(host).at(-1)).toBe('(%rating% GREATER 3) AND (artist IS "other")');
  });

  it('分面：勾选拼成 IS 查询；流派与艺人两栏之间取与；清除条件一并清掉分面', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { filter, state, titles } = await start(host);
    filter.toggleFacet(MAIN, 'genre', 'Jazz');
    filter.toggleFacet(MAIN, 'genre', 'Rock');
    await wait(20);
    expect(titles()).toStrictEqual(['Blue Moon', 'Red']);
    expect(queries(host).at(-1)).toBe('(genre IS "Jazz" OR genre IS "Rock")');
    filter.toggleFacet(MAIN, 'artist', 'Moon Band');
    await wait(20);
    expect(titles()).toStrictEqual(['Red']);
    filter.toggleFacet(MAIN, 'genre', 'Rock');
    filter.toggleFacet(MAIN, 'genre', 'Jazz');
    await wait(20);
    expect([...state().facets.genre]).toStrictEqual([]);
    filter.clearConditions(MAIN);
    await wait(20);
    expect(state()).toMatchObject({ active: false, facets: EMPTY_TRACK_FACETS });
  });

  it('restore 把输入、预设、分面与条件整份换成快照里的那一份，只问一次宿主', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { filter, state, titles } = await start(host);
    filter.restore(MAIN, {
      ...EMPTY_TRACK_FILTER,
      text: 'moon',
      presets: new Set<PresetId>(['highRated']),
      facets: { ...EMPTY_TRACK_FACETS, genre: new Set(['Jazz']) },
    });
    await wait(20);
    expect(matchingCalls(host)).toHaveLength(1);
    expect(titles()).toStrictEqual(['Blue Moon']);
    expect(state()).toMatchObject({ query: 'moon', term: 'moon' });
  });
});

it('标签与播放统计更新会刷新过滤快照', async () => {
  const host = installFakeHost();
  const track = makeRow('Main', 0, {
    title: 'Blue',
    playCount: 1,
    lastPlayed: '2024-01-01 00:00:00',
  });
  const fake = lists(host, [track]);
  const { filter, state } = await start(host);
  filter.setInput(MAIN, textInput('Blue'));
  filter.flush(MAIN);
  await vi.waitFor(() => expect(state().hits[0]?.row.playCount).toBe(1));
  fake.setTracks(MAIN, [{ ...track, playCount: 2, lastPlayed: '2024-02-01 00:00:00' }]);
  host.emit('metadb:changed', changed(track));
  await vi.waitFor(() => expect(state().hits[0]?.row.playCount).toBe(2));
  expect(state().hits[0]?.row.lastPlayed).toBe('2024-02-01 00:00:00');
});

const longList = () =>
  Array.from({ length: 900 }, (_, row) =>
    makeRow('Main', row, row === 850 ? { title: 'Target', playCount: 1 } : {}),
  );
const changed = (...tracks: readonly PlaylistTrack[]) => ({
  count: tracks.length,
  fromHook: false,
  handles: tracks.map((track) => track.handle),
  truncated: false,
  timestamp: Date.now(),
  tracks: tracks.map(({ handle, path, subsong }) => ({ handle, path, subsong })),
});

it('行缓存之外的命中也随标签更新，原来没命中的改完变成命中', async () => {
  const host = installFakeHost();
  const tracks = longList();
  const fake = lists(host, tracks);
  const { filter, state, titles } = await start(host);
  filter.setInput(MAIN, textInput('Target'));
  filter.flush(MAIN);
  await vi.waitFor(() => expect(state().hits.map((hit) => hit.index)).toStrictEqual([850]));
  const [target, other] = [tracks[850]!, tracks[860]!];
  fake.setTracks(
    MAIN,
    tracks.map((track) =>
      track === target
        ? { ...track, playCount: 2 }
        : track === other
          ? { ...track, title: 'Target 2' }
          : track,
    ),
  );
  host.emit('metadb:changed', changed(target, other));
  await vi.waitFor(() => expect(titles()).toStrictEqual(['Target', 'Target 2']));
  expect(state().hits[0]?.row.playCount).toBe(2);
});

it('标签更新只重算一轮：连着几次合并成一次，重算期间旧命中留着', async () => {
  const host = installFakeHost();
  const tracks = longList();
  lists(host, tracks);
  const { filter, state, titles } = await start(host);
  filter.setInput(MAIN, textInput('Target'));
  filter.flush(MAIN);
  await vi.waitFor(() => expect(titles()).toStrictEqual(['Target']));
  const before = matchingCalls(host).length;
  const held = host.hold('playlist.getMatchingRows');
  host.emit('metadb:changed', changed(tracks[1]!));
  host.emit('metadb:changed', changed(tracks[2]!));
  await vi.waitFor(() => expect(state().scanning).toBe(true));
  expect(titles()).toStrictEqual(['Target']);
  held.release();
  await vi.waitFor(() => expect(state().scanning).toBe(false));
  await wait(400);
  expect(matchingCalls(host)).toHaveLength(before + 1);
});

/** 求值函数：查询串就是要在标题里找的字；以 ! 开头的宿主认不出 */
const titleHas = (query: string, row: PlaylistTrack): boolean | 'invalid' =>
  query.startsWith('!') ? 'invalid' : (row.title ?? '').toLowerCase().includes(query);

describe('startPlaylistFilter：高级查询', () => {
  it('交宿主求值，只取命中的行，行上带真实行号', async () => {
    const host = installFakeHost();
    lists(host, songs()).setMatcher(titleHas);
    const { filter, state, titles } = await start(host);
    filter.setInput(MAIN, advancedInput('moon'));
    await typed();
    expect(titles()).toStrictEqual(['Blue Moon', 'Moonlight']);
    expect(state().hits.map((hit) => hit.index)).toStrictEqual([0, 3]);
    expect(state()).toMatchObject({ active: true, term: 'moon', invalid: false, scanning: false });
    expect(queries(host)).toStrictEqual(['moon']);
    expect(host.callsTo('playlist.getTracksAt').map((call) => call['rows'])).toStrictEqual([
      [0, 3],
    ]);
    expect(scans(host)).toHaveLength(0);
  });

  it('宿主认不出这条查询：留着上一份命中、只标出错，改对了撤掉标记', async () => {
    const host = installFakeHost();
    lists(host, songs()).setMatcher(titleHas);
    const { filter, state, titles } = await start(host);
    filter.setInput(MAIN, advancedInput('moon'));
    await typed();
    expect(titles()).toStrictEqual(['Blue Moon', 'Moonlight']);
    filter.setInput(MAIN, advancedInput('!moon'));
    await typed();
    expect(state()).toMatchObject({ invalid: true, active: true, scanning: false });
    expect(titles()).toStrictEqual(['Blue Moon', 'Moonlight']);
    filter.setInput(MAIN, advancedInput('red'));
    await typed();
    expect(state().invalid).toBe(false);
    expect(titles()).toStrictEqual(['Red']);
  });

  it('普通搜索与预设由主题生成，宿主答认不出不是用户写错：不标出错，按没有结果处理', async () => {
    const host = installFakeHost();
    lists(host, songs()).setMatcher(() => 'invalid');
    const { filter, state } = await start(host);
    filter.setInput(MAIN, textInput('moon'));
    await typed();
    expect(state()).toMatchObject({ invalid: false, active: false, hits: [] });
    filter.togglePreset(MAIN, 'highRated');
    await wait(20);
    expect(state()).toMatchObject({ invalid: false, active: false, hits: [] });
  });

  it('预设、条件与高级查询取并且，拼进同一条查询', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { filter, titles } = await start(host);
    filter.addCondition(MAIN, artistIs('other'));
    filter.setInput(MAIN, advancedInput('title HAS "moon"'));
    await typed();
    expect(titles()).toStrictEqual(['Moonlight']);
    expect(queries(host).at(-1)).toBe('(title HAS "moon") AND (artist IS "other")');
  });

  it('两种模式各留一份草稿，只有当前模式的参与过滤；换模式马上重算', async () => {
    const host = installFakeHost();
    lists(host, songs());
    const { filter, state, titles } = await start(host);
    filter.setInput(MAIN, advancedInput('title HAS "red"', 'green'));
    await typed();
    expect(titles()).toStrictEqual(['Red']);
    // 切到普通搜索：两份草稿都留着，过滤改按普通搜索的词
    filter.setInput(MAIN, { mode: 'text', text: 'green', advancedText: 'title HAS "red"' });
    await typed();
    expect(titles()).toStrictEqual(['Green']);
    expect(state()).toMatchObject({
      query: 'green',
      advancedText: 'title HAS "red"',
      mode: 'text',
    });
    // 当前模式清空：退出过滤，不去看另一份草稿
    filter.setInput(MAIN, { mode: 'text', text: '', advancedText: 'title HAS "red"' });
    await wait(20);
    expect(state()).toMatchObject({ active: false, hits: [] });
  });

  it('取行途中列表变了就重问宿主，答复落在新内容上', async () => {
    const host = installFakeHost();
    const fake = lists(host, songs());
    fake.setMatcher(titleHas);
    const { filter, state, titles } = await start(host);
    const held = host.hold('playlist.getTracksAt');
    filter.setInput(MAIN, advancedInput('moon'));
    filter.flush(MAIN);
    await vi.waitFor(() => expect(state().scanning).toBe(true));
    await vi.waitFor(() => expect(host.callsTo('playlist.getTracksAt')).toHaveLength(1));
    fake.setTracks(MAIN, [makeRow('Main', 0, { title: 'Brand New Moon' })]);
    held.release();
    await vi.waitFor(() => expect(titles()).toStrictEqual(['Brand New Moon']));
    expect(matchingCalls(host)).toHaveLength(2);
  });

  it('任何一首的标签变了都重问宿主，原来没命中的改完可能命中', async () => {
    const host = installFakeHost();
    const tracks = songs();
    const fake = lists(host, tracks);
    fake.setMatcher(titleHas);
    const { filter, titles } = await start(host);
    filter.setInput(MAIN, advancedInput('moon'));
    await typed();
    expect(titles()).toStrictEqual(['Blue Moon', 'Moonlight']);
    const green = tracks[2]!;
    fake.setTracks(
      MAIN,
      tracks.map((track) => (track === green ? { ...track, title: 'Green Moon' } : track)),
    );
    host.emit('metadb:changed', changed(green));
    await vi.waitFor(() =>
      expect(titles()).toStrictEqual(['Blue Moon', 'Green Moon', 'Moonlight']),
    );
  });
});
