import { expect, it, onTestFinished, vi } from 'vitest';
import { genresRowsAtom, startGenresRows } from '../../../../src/library/genres/genresRows.ts';
import { GENRES_SORT } from '../../../../src/library/genres/genresGroups.ts';
import { GENRE_TRACKS, genresLibrary } from '../../../fixtures/genresLibrary.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { trackRow } from '../../../fixtures/libraryRows.ts';
import { trackSortPattern } from '../../../../src/track/trackSort.ts';

const answer = (handles: readonly string[]) => ({
  success: true as const,
  total: handles.length,
  tracks: handles.map((handle, index) => ({ handle, index })),
});
async function setup() {
  const env = genresLibrary();
  await env.ready();
  const rows = startGenresRows(env.store, env.host.fb);
  onTestFinished(() => rows.dispose());
  return { ...env, rows, rowState: () => env.store.get(genresRowsAtom) };
}

it('按宿主句柄顺序取完整曲目；切流派立即撤旧表，旧应答晚到不串页', async () => {
  const env = await setup();
  env.host.answer('library.query', answer([]));
  const held = env.host.hold('library.query');
  env.rows.select('Rock', 'albumDisc');
  env.rows.select('Jazz', 'none');
  expect(env.rowState()).toMatchObject({ key: 'Jazz', tracks: [], status: 'loading' });
  await vi.waitFor(() => expect(held.pending).toHaveLength(2));
  held.respond(1, answer([GENRE_TRACKS[2]!.handle]));
  await vi.waitFor(() => expect(env.rowState().status).toBe('ready'));
  held.respond(0, answer([GENRE_TRACKS[1]!.handle, GENRE_TRACKS[0]!.handle]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(env.rowState().tracks.map((track) => track.title)).toEqual(['Three']);
  expect(env.rowState().fill).toEqual({
    query: 'genre IS "Jazz"',
    sort: GENRES_SORT.none,
    descending: false,
  });
});
it('同主体重取失败保留旧行，重试成功恢复；库里不认识的句柄不拼到旧数据上', async () => {
  const env = await setup();
  env.host.answer('library.query', answer([GENRE_TRACKS[1]!.handle, GENRE_TRACKS[0]!.handle]));
  env.rows.select('Rock', 'album');
  await vi.waitFor(() => expect(env.rowState().status).toBe('ready'));
  expect(env.rowState().tracks.map((track) => track.title)).toEqual(['Two', 'One']);
  env.host.answer('library.query', hostFailure('OPERATION_FAILED'));
  await env.rows.retry();
  expect(env.rowState()).toMatchObject({
    status: 'failed',
    tracks: [GENRE_TRACKS[1], GENRE_TRACKS[0]],
  });
  env.host.answer('library.query', answer(['unknown']));
  await env.rows.retry();
  expect(env.rowState().status).toBe('failed');
  env.host.answer('library.query', answer([GENRE_TRACKS[0]!.handle]));
  await env.rows.retry();
  expect(env.rowState()).toMatchObject({ status: 'ready', tracks: [GENRE_TRACKS[0]] });
});
it('不可精确查询的流派不套条件与排序，仍可浏览整份，禁止按错误查询播放', async () => {
  const track = trackRow('', 'Quoted', { genre: 'A"B' });
  const env = genresLibrary([track]);
  await env.ready();
  const rows = startGenresRows(env.store, env.host.fb);
  onTestFinished(() => rows.dispose());
  rows.select(track.genre, 'album', '%rating% GREATER 3', { column: 'title', descending: true });
  expect(env.store.get(genresRowsAtom)).toMatchObject({
    status: 'ready',
    tracks: [track],
    fill: null,
  });
  expect(env.host.callsTo('library.query')).toEqual([]);
});
it('条件并进流派查询；自选列排序先按分组排，降序在组内倒主键不同的段', async () => {
  const env = await setup();
  env.host.answer('library.query', answer([GENRE_TRACKS[0]!.handle, GENRE_TRACKS[1]!.handle]));
  const sort = { column: 'title' as const, descending: true };
  env.rows.select('Rock', 'album', '%rating% GREATER 3', sort);
  await vi.waitFor(() => expect(env.rowState().status).toBe('ready'));
  const fill = {
    query: '(genre IS "Rock") AND (%rating% GREATER 3)',
    sort: `%album% | %album artist% | %date% | ${trackSortPattern('title')}`,
    descending: false,
  };
  expect(env.host.callsTo('library.query')).toMatchObject([{ query: fill.query, sort: fill.sort }]);
  expect(env.rowState().fill).toMatchObject(fill);
  expect(env.rowState().fill?.arrange).toBeTypeOf('function');
  expect(env.rowState().tracks.map((track) => track.title)).toEqual(['Two', 'One']);
  expect(
    env.rowState().fill?.arrange?.([GENRE_TRACKS[0]!.handle, GENRE_TRACKS[1]!.handle]),
  ).toEqual([GENRE_TRACKS[1]!.handle, GENRE_TRACKS[0]!.handle]);
});
it('专辑与碟号分组的降序不越过碟；只改组序时重取并带上整理函数', async () => {
  const env = await setup();
  env.host.answer('library.query', answer([GENRE_TRACKS[0]!.handle, GENRE_TRACKS[1]!.handle]));
  const sort = { column: 'title' as const, descending: true };
  env.rows.select('Rock', 'albumDisc', 'ALL', sort);
  await vi.waitFor(() => expect(env.rowState().status).toBe('ready'));
  expect(env.rowState().tracks.map((track) => track.title)).toEqual(['One', 'Two']);
  env.rows.select('Rock', 'albumDisc', 'ALL', null, 0, true);
  await vi.waitFor(() => expect(env.rowState().fill?.arrange).toBeTypeOf('function'));
  expect(env.rowState().tracks.map((track) => track.title)).toEqual(['One', 'Two']);
});
it('同一流派改条件：旧表留到新结果到达，去抖期间不发请求，旧条件晚到的应答不覆盖', async () => {
  const env = await setup();
  env.host.answer('library.query', answer([GENRE_TRACKS[0]!.handle, GENRE_TRACKS[1]!.handle]));
  env.rows.select('Rock', 'album');
  await vi.waitFor(() => expect(env.rowState().status).toBe('ready'));
  const shown = env.rowState().tracks;
  const held = env.host.hold('library.query');
  env.rows.select('Rock', 'album', '%title% HAS O', null, 20);
  expect(env.rowState()).toMatchObject({ status: 'loading', tracks: shown, fill: null });
  env.rows.select('Rock', 'album', '%title% HAS On', null, 20);
  await vi.waitFor(() => expect(held.pending).toHaveLength(1));
  env.rows.select('Rock', 'album', '%title% HAS Tw');
  await vi.waitFor(() => expect(held.pending).toHaveLength(2));
  expect(env.host.callsTo('library.query').map((call) => call['query'])).toEqual([
    'genre IS "Rock"',
    '(genre IS "Rock") AND (%title% HAS On)',
    '(genre IS "Rock") AND (%title% HAS Tw)',
  ]);
  held.respond(1, answer([GENRE_TRACKS[1]!.handle]));
  await vi.waitFor(() => expect(env.rowState().status).toBe('ready'));
  held.respond(0, answer([GENRE_TRACKS[0]!.handle]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(env.rowState().tracks.map((track) => track.title)).toEqual(['Two']);
});
