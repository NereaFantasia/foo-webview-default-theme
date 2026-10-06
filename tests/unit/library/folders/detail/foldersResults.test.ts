import { createStore } from 'jotai/vanilla';
import { expect, it, onTestFinished, vi } from 'vitest';
import { startFoldersPreview } from '../../../../../src/library/folders/detail/foldersPreview.ts';
import {
  foldersResultsAtom,
  foldersConditionsAtom,
  foldersScopeTracksAtom,
  startFoldersResults,
} from '../../../../../src/library/folders/detail/foldersResults.ts';
import { startFoldersPrefs } from '../../../../../src/library/folders/foldersPrefs.ts';
import { QUERY_DEBOUNCE_MS } from '../../../../../src/track/queryInput.ts';
import { foldersDirectory } from '../../../../../src/library/folders/tree/foldersModel.ts';
import {
  FOLDER_TRACKS,
  folderDirectory,
  foldersAnswers,
} from '../../../../fixtures/foldersLibrary.ts';
import { hostFailure } from '../../../../fixtures/hostAnswers.ts';
import { UnitHost } from '../../../../fixtures/unitHost.ts';

async function setup() {
  const host = new UnitHost({ answers: foldersAnswers() });
  const store = createStore();
  const prefs = startFoldersPrefs(store);
  const preview = startFoldersPreview(store, () => 0, host.fb);
  const results = startFoldersResults(store, host.fb);
  const state = () => store.get(foldersResultsAtom);
  preview.select(foldersDirectory(folderDirectory('Alpha', 2, true)));
  onTestFinished(() => {
    results.dispose();
    preview.dispose();
    host.dispose();
  });
  await vi.waitFor(() => expect(state().status).toBe('ready'));
  return { host, store, prefs, preview, results, state };
}
it('分页搜索只取当前目录完整句柄的交集，完整集提供分面计数', async () => {
  const env = await setup();
  env.host.answer('library.search', (params) => ({
    success: true,
    tracks: [params.offset === 0 ? FOLDER_TRACKS[2] : FOLDER_TRACKS[1]],
    offset: typeof params.offset === 'number' ? params.offset : 0,
    limit: 1,
    total: 2,
    hasMore: params.offset === 0,
  }));
  env.results.setText('Amber');
  env.results.flush();
  await vi.waitFor(() => expect(env.state().status).toBe('ready'));
  expect(env.state().tracks.map((track) => track.title)).toEqual(['Amber']);
  expect(env.state().total).toBe(2);
  expect(env.store.get(foldersScopeTracksAtom)).toHaveLength(2);
});
it('新查询与切目录作废旧应答，失败不会把旧结果标成成功', async () => {
  const env = await setup();
  const held = env.host.hold('library.search');
  env.results.setText('Amber');
  env.results.flush();
  await vi.waitFor(() => expect(env.host.callsTo('library.search')).toHaveLength(1));
  env.preview.select(foldersDirectory(folderDirectory('Beta')));
  await vi.waitFor(() => expect(env.host.callsTo('library.search')).toHaveLength(2));
  held.respond(1, {
    success: true,
    tracks: [FOLDER_TRACKS[2]],
    total: 1,
    offset: 0,
    limit: 1000,
    hasMore: false,
  });
  await vi.waitFor(() => expect(env.state().status).toBe('ready'));
  held.respond(0, {
    success: true,
    tracks: [FOLDER_TRACKS[1]],
    total: 1,
    offset: 0,
    limit: 1000,
    hasMore: false,
  });
  await Promise.resolve();
  expect(env.state().tracks.map((track) => track.title)).toEqual(['Blue']);
  env.results.setText('invalid');
  env.results.flush();
  await vi.waitFor(() => expect(env.host.callsTo('library.search')).toHaveLength(3));
  held.respond(0, hostFailure('INVALID_PARAMS'));
  await vi.waitFor(() => expect(env.state().status).toBe('failed'));
  expect(env.state().invalid).toBe(true);
  expect(env.state().tracks.map((track) => track.title)).toEqual(['Blue']);
});
it('仅本层改变范围与分面全集，不能绕过大目录保护', async () => {
  const env = await setup();
  env.prefs.change({ recursive: false });
  await vi.waitFor(() => expect(env.state().status).toBe('ready'));
  expect(env.state().tracks.map((track) => track.title)).toEqual(['Zebra']);
  expect(env.store.get(foldersScopeTracksAtom)).toHaveLength(1);
  env.preview.select(foldersDirectory(folderDirectory('Huge', 6001)));
  expect(env.state().status).toBe('idle');
  expect(env.state().tracks).toEqual([]);
});
it('释放后在途结果不再写回', async () => {
  const env = await setup();
  const held = env.host.hold('library.search');
  env.results.setText('Amber');
  env.results.flush();
  await vi.waitFor(() => expect(env.host.callsTo('library.search')).toHaveLength(1));
  env.results.dispose();
  const before = env.state();
  held.respond(0, {
    success: true,
    tracks: [FOLDER_TRACKS[1]],
    total: 1,
    offset: 0,
    limit: 1000,
    hasMore: false,
  });
  await Promise.resolve();
  expect(env.state()).toBe(before);
});

it('两种模式独立保存，普通输入去抖 300ms，切换模式不等待', async () => {
  const env = await setup();
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  env.results.setText('Amber');
  await vi.advanceTimersByTimeAsync(QUERY_DEBOUNCE_MS - 1);
  expect(env.host.callsTo('library.search')).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(env.state().answered).toContain('HAS "amber"');
  env.results.setQuery({
    mode: 'advanced',
    text: 'Amber',
    advancedText: 'title IS Zebra',
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(env.state().answered).toBe('title IS Zebra');
  env.results.setText('');
  env.results.flush();
  await vi.advanceTimersByTimeAsync(0);
  expect(env.state().answered).toBe('ALL');
  expect(env.store.get(foldersConditionsAtom).text).toBe('Amber');
  env.results.setQuery({ ...env.store.get(foldersConditionsAtom), mode: 'text' });
  await vi.advanceTimersByTimeAsync(0);
  expect(env.state().answered).toContain('HAS "amber"');
});
