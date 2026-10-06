import { createStore } from 'jotai/vanilla';
import { expect, it, onTestFinished, vi } from 'vitest';
import {
  foldersFilterAtom,
  startFoldersFilter,
} from '../../../../../src/library/folders/tree/foldersFilter.ts';
import {
  foldersTreeAtom,
  startFoldersTree,
} from '../../../../../src/library/folders/tree/foldersTree.ts';
import { foldersSubject } from '../../../../../src/library/folders/tree/foldersModel.ts';
import { UnitHost } from '../../../../fixtures/unitHost.ts';
import { foldersAnswers, FOLDER_ROOT, FOLDER_TRACKS } from '../../../../fixtures/foldersLibrary.ts';
import { hostFailure } from '../../../../fixtures/hostAnswers.ts';

const key = (pathId = '') => foldersSubject({ rootId: FOLDER_ROOT.id, pathId });
async function setup() {
  const host = new UnitHost({ answers: foldersAnswers() });
  const store = createStore();
  const tree = startFoldersTree(store, host.fb);
  const filter = startFoldersFilter(store, tree, host.fb);
  onTestFinished(() => {
    filter.dispose();
    tree.dispose();
    host.dispose();
  });
  tree.want();
  await vi.waitFor(() => expect(store.get(foldersTreeAtom).status).toBe('ready'));
  return { host, store, tree, filter, state: () => store.get(foldersFilterAtom) };
}
it('命中只展开祖先目录；清词恢复原展开，不把过滤词用于预览取曲目', async () => {
  const env = await setup();
  await env.tree.expand(key());
  env.filter.setText('Amber');
  env.filter.flush();
  await vi.waitFor(() => expect(env.state().status).toBe('ready'));
  expect([...(env.state().allowed ?? [])]).toEqual([key('Alpha/Disc'), key('Alpha'), key()]);
  expect(env.store.get(foldersTreeAtom).expanded.has(key('Alpha'))).toBe(true);
  env.filter.setText('');
  await vi.waitFor(() => expect(env.state().allowed).toBe(null));
  expect([...env.store.get(foldersTreeAtom).expanded]).toEqual([key()]);
});
it('清词后迟到搜索不重新过滤；失败明确降为根及一级目录名', async () => {
  const env = await setup();
  const held = env.host.hold('library.search');
  env.filter.setText('Amber');
  env.filter.flush();
  env.filter.setText('');
  held.respond(0, {
    success: true,
    total: 1,
    tracks: [FOLDER_TRACKS[1]!],
    offset: 0,
    limit: 5000,
    hasMore: false,
  });
  held.release();
  await vi.waitFor(() => expect(env.state().status).toBe('idle'));
  expect(env.state().allowed).toBe(null);
  env.host.answer('library.search', hostFailure('OPERATION_FAILED'));
  env.filter.setText('Alpha');
  env.filter.flush();
  await vi.waitFor(() => expect(env.state().status).toBe('fallback'));
  expect(env.state().allowed).toEqual(new Set([key('Alpha'), key()]));
});
