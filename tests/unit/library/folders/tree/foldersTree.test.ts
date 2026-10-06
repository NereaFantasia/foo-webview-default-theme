import { createStore } from 'jotai/vanilla';
import { expect, it, onTestFinished, vi } from 'vitest';
import {
  startFoldersTree,
  foldersTreeAtom,
} from '../../../../../src/library/folders/tree/foldersTree.ts';
import {
  foldersSubject,
  foldersVisible,
} from '../../../../../src/library/folders/tree/foldersModel.ts';
import { UnitHost } from '../../../../fixtures/unitHost.ts';
import {
  foldersAnswers,
  foldersBrowseAnswer,
  FOLDER_ROOT,
} from '../../../../fixtures/foldersLibrary.ts';
import { hostFailure } from '../../../../fixtures/hostAnswers.ts';

const key = (pathId = '') => foldersSubject({ rootId: FOLDER_ROOT.id, pathId });
async function setup(available = true) {
  const host = new UnitHost({ answers: foldersAnswers(), available });
  const store = createStore();
  const service = startFoldersTree(store, host.fb);
  onTestFinished(() => {
    service.dispose();
    host.dispose();
  });
  return { host, store, service, state: () => store.get(foldersTreeAtom) };
}
it('递归展开加载后代；普通收起保留后代状态，递归收起只清除指定子树', async () => {
  const env = await setup();
  env.service.want();
  await vi.waitFor(() => expect(env.state().status).toBe('ready'));
  await env.service.expandRecursive([key()], true);
  expect(env.state().expanded).toEqual(new Set([key(), key('Alpha')]));
  expect(env.state().nodes.has(key('Alpha/Disc'))).toBe(true);
  await env.service.expand(key(), false);
  expect(env.state().expanded.has(key('Alpha'))).toBe(true);
  await env.service.expandRecursive([key('Alpha')], false);
  expect(env.state().expanded.size).toBe(0);
  await env.service.expandRecursive([key()], true);
  await env.service.expandRecursive([key('Alpha')], false);
  expect(env.state().expanded).toEqual(new Set([key()]));
});
it('递归展开等待子目录时收起，迟到结果不能重新展开后代', async () => {
  const env = await setup();
  env.service.want();
  await vi.waitFor(() => expect(env.state().status).toBe('ready'));
  const held = env.host.hold('library.browseTree');
  const expanding = env.service.expandRecursive([key()], true);
  await vi.waitFor(() => expect(held.pending.length).toBe(1));
  await env.service.expandRecursive([key()], false);
  held.release();
  await expanding;
  expect(env.state().expanded.size).toBe(0);
  expect(env.state().nodes.has(key('Alpha/Disc'))).toBe(false);
});
it('首次进页才读取；宿主迟到时先订阅再初读，展开按需加载且折叠保留缓存', async () => {
  const env = await setup(false);
  expect(env.host.callsTo('library.getRoots')).toEqual([]);
  env.service.want();
  env.host.answer('library.browseTree', (params) => {
    expect(env.host.listenerCount('library:itemsAdded')).toBe(1);
    return foldersBrowseAnswer(String(params.pathId ?? ''));
  });
  env.host.connect();
  await vi.waitFor(() => expect(env.state().status).toBe('ready'));
  await env.service.expand(key(), true);
  expect(env.state().children.get(key())).toHaveLength(3);
  await env.service.expand(key(), false);
  env.host.answer('library.browseTree', hostFailure('OPERATION_FAILED'));
  await env.service.expand(key(), true);
  expect(env.state().children.get(key())).toHaveLength(3);
  expect(env.state().failed.size).toBe(0);
});
it('节点读取失败可重试；库刷新补齐展开链后才发布新树', async () => {
  const env = await setup();
  env.service.want();
  await vi.waitFor(() => expect(env.state().status).toBe('ready'));
  env.host.answer('library.browseTree', hostFailure('OPERATION_FAILED'));
  await env.service.expand(key(), true);
  expect(env.state().failed.has(key())).toBe(true);
  env.host.answerAll(foldersAnswers());
  await env.service.expand(key(), true);
  await env.service.expand(key('Alpha'), true);
  const held = env.host.hold('library.browseTree');
  const refresh = env.service.retry();
  await vi.waitFor(() => expect(held.pending.length).toBeGreaterThan(0));
  expect(env.state().status).toBe('loading');
  expect(env.state().nodes.has(key('Alpha/Disc'))).toBe(true);
  held.release();
  await refresh;
  expect(env.state().status).toBe('ready');
  expect(env.state().expanded.has(key('Alpha'))).toBe(true);
  const state = env.state();
  expect(
    foldersVisible(state.roots, state.nodes, state.children, state.expanded).map(
      (row) => row.node.name,
    ),
  ).toEqual(['Music', 'Alpha', 'Disc', 'Beta', 'Huge']);
});
it('离页后的旧目录应答不改树；再次进页读取新代次', async () => {
  const env = await setup();
  const release = env.service.want();
  await vi.waitFor(() => expect(env.state().status).toBe('ready'));
  const held = env.host.hold('library.browseTree');
  const opening = env.service.expand(key(), true);
  release();
  held.respond(0, foldersBrowseAnswer(''));
  await opening;
  expect(env.state().children.has(key())).toBe(false);
  env.service.want();
  held.release();
  await vi.waitFor(() => expect(env.state().status).toBe('ready'));
  expect(env.state().children.get(key())).toHaveLength(3);
});
it('一秒内库事件合并重读，释放摘掉订阅', async () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const env = await setup();
  env.service.want();
  await vi.advanceTimersByTimeAsync(0);
  const before = env.state().generation;
  env.host.emit('library:itemsAdded', { count: 1, timestamp: 1 });
  env.host.emit('library:itemsRemoved', { count: 1, timestamp: 2 });
  await vi.advanceTimersByTimeAsync(999);
  expect(env.state().generation).toBe(before);
  await vi.advanceTimersByTimeAsync(1);
  expect(env.state().generation).toBe(before + 1);
  env.service.dispose();
  expect(env.host.listenerCount('library:itemsAdded')).toBe(0);
});
