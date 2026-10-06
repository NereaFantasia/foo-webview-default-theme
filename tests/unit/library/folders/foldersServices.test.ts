import { createStore } from 'jotai/vanilla';
import { expect, it, onTestFinished, vi } from 'vitest';
import { startFolders, foldersFocusAtom } from '../../../../src/library/folders/foldersServices.ts';
import { foldersTreeAtom } from '../../../../src/library/folders/tree/foldersTree.ts';
import { foldersPreviewAtom } from '../../../../src/library/folders/detail/foldersPreview.ts';
import {
  foldersDirectory,
  foldersSubjects,
} from '../../../../src/library/folders/tree/foldersModel.ts';
import { UnitHost } from '../../../fixtures/unitHost.ts';
import { foldersAnswers, folderDirectory } from '../../../fixtures/foldersLibrary.ts';
import {
  createSnapshotSlot,
  historyAtom,
  startNavHistory,
} from '../../../../src/nav/navHistory.ts';

function setup() {
  const host = new UnitHost({ answers: foldersAnswers() });
  const store = createStore();
  const history = startNavHistory(store, { id: 'folders' });
  const service = startFolders(
    store,
    {
      history,
      record: vi.fn(),
      openPlaylist: vi.fn(),
      stamp: () => 0,
    },
    host.fb,
  );
  onTestFinished(() => {
    service.dispose();
    host.dispose();
  });
  return { host, store, service, history };
}
it('目录访问共用全局历史，离开快照保存旧主体，连续后退不会用迟到预览改写历史', async () => {
  const env = setup();
  env.service.want();
  await vi.waitFor(() => expect(env.store.get(foldersTreeAtom).status).toBe('ready'));
  const keys = ['Alpha', 'Beta', 'Alpha/Disc'].map(
    (path) => foldersDirectory(folderDirectory(path)).key,
  );
  const [alpha, beta, disc] = keys;
  if (!alpha || !beta || !disc) throw new Error('缺少目录');
  await env.service.visit(alpha);
  const entry = env.store.get(historyAtom).entry;
  const slot = createSnapshotSlot<{ focus: string | null }>();
  env.history.registerSnapshot(entry, slot, {
    capture: () => ({ focus: env.store.get(foldersFocusAtom) }),
    restore: () => {},
  });
  await env.service.visit(beta);
  expect(slot.values.get(entry)).toEqual({ focus: alpha });
  await env.service.visit(disc);
  expect(env.history.back()).toBe(true);
  expect(env.history.back()).toBe(true);
  expect(env.store.get(historyAtom).place).toEqual({ id: 'folders', subject: alpha });
  expect(env.store.get(foldersFocusAtom)).toBe(alpha);
  expect(env.history.forward()).toBe(true);
  expect(env.store.get(historyAtom).place.subject).toBe(beta);
  await env.service.open(beta);
  expect(env.store.get(historyAtom).next?.subject).toBe(disc);
});
it('重复访问不加记录，多选预览和树开合不新增历史', async () => {
  const env = setup();
  env.service.want();
  await vi.waitFor(() => expect(env.store.get(foldersTreeAtom).status).toBe('ready'));
  const nodes = ['Alpha', 'Beta'].map((path) => foldersDirectory(folderDirectory(path)));
  await env.service.visit(nodes[0]!.key);
  const entry = env.store.get(historyAtom).entry;
  await env.service.visit(nodes[0]!.key);
  env.service.selectMany(nodes);
  await env.service.tree.expandRecursive([nodes[0]!.key], true);
  expect(env.store.get(historyAtom).entry).toBe(entry);
  expect(env.store.get(historyAtom).place.subject).toBe(foldersSubjects(nodes));
});
it('首次选目录填入当前空记录，后退直接回到之前的页面', async () => {
  const env = setup();
  env.history.navigate({ id: 'albums' });
  env.history.navigate({ id: 'folders' });
  env.service.want();
  await vi.waitFor(() => expect(env.store.get(foldersTreeAtom).status).toBe('ready'));
  const alpha = foldersDirectory(folderDirectory('Alpha'));
  await env.service.visit(alpha.key);
  expect(env.store.get(historyAtom).place.subject).toBe(alpha.key);
  expect(env.history.back()).toBe(true);
  expect(env.store.get(historyAtom).place.id).toBe('albums');
});
it('两个页面交接时，旧使用者释放不能清掉新页的预览', async () => {
  const env = setup();
  const releaseOld = env.service.want();
  const releaseNew = env.service.want();
  await vi.waitFor(() => expect(env.store.get(foldersTreeAtom).status).toBe('ready'));
  const node = foldersDirectory(folderDirectory('Alpha', 2));
  env.service.select(node);
  await vi.waitFor(() => expect(env.store.get(foldersPreviewAtom).status).toBe('ready'));
  releaseOld();
  expect(env.store.get(foldersPreviewAtom).node?.key).toBe(node.key);
  expect(env.store.get(foldersPreviewAtom).status).toBe('ready');
  releaseNew();
  expect(env.store.get(foldersPreviewAtom).status).toBe('idle');
});
it('目录被移走时明确结束定位，不保留不存在的主体', async () => {
  const env = setup();
  env.service.want();
  await vi.waitFor(() => expect(env.store.get(foldersTreeAtom).status).toBe('ready'));
  const missing = foldersDirectory(folderDirectory('Gone'));
  expect(await env.service.open(missing.key)).toBe(false);
  expect(env.store.get(foldersFocusAtom)).toBeNull();
});
it('多目录主体恢复全部节点，部分目录不存在时不静默缩小选择', async () => {
  const env = setup();
  env.service.want();
  await vi.waitFor(() => expect(env.store.get(foldersTreeAtom).status).toBe('ready'));
  const nodes = ['Alpha/Disc', 'Beta'].map((path) => foldersDirectory(folderDirectory(path)));
  expect(await env.service.open(foldersSubjects(nodes))).toBe(true);
  await vi.waitFor(() => expect(env.store.get(foldersPreviewAtom).status).toBe('ready'));
  expect(env.store.get(foldersPreviewAtom).tracks.map((track) => track.title)).toEqual([
    'Amber',
    'Blue',
  ]);
  expect(
    env.store.get(foldersTreeAtom).expanded.has(foldersDirectory(folderDirectory('Alpha')).key),
  ).toBe(true);
  expect(
    await env.service.open(foldersSubjects([...nodes, foldersDirectory(folderDirectory('Gone'))])),
  ).toBe(false);
  expect(env.store.get(foldersPreviewAtom).tracks).toEqual([]);
});
