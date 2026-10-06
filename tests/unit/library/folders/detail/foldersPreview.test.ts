import { createStore } from 'jotai/vanilla';
import { expect, it, onTestFinished, vi } from 'vitest';
import {
  foldersPreviewAtom,
  startFoldersPreview,
} from '../../../../../src/library/folders/detail/foldersPreview.ts';
import {
  FOLDERS_LIMIT,
  foldersDirectory,
} from '../../../../../src/library/folders/tree/foldersModel.ts';
import {
  folderDirectory,
  foldersAnswers,
  foldersBrowseAnswer,
} from '../../../../fixtures/foldersLibrary.ts';
import { UnitHost } from '../../../../fixtures/unitHost.ts';

function setup() {
  const host = new UnitHost({ answers: foldersAnswers() });
  const store = createStore();
  const preview = startFoldersPreview(store, () => 7, host.fb);
  onTestFinished(() => {
    preview.dispose();
    host.dispose();
  });
  return { host, store, preview, state: () => store.get(foldersPreviewAtom) };
}
it('切目录立即清旧行，只接新应答；评分戳取自请求开始', async () => {
  const env = setup();
  const held = env.host.hold('library.browseTree');
  env.preview.select(foldersDirectory(folderDirectory('Alpha', 2)));
  env.preview.select(foldersDirectory(folderDirectory('Beta')));
  expect(env.state().tracks).toEqual([]);
  held.respond(1, foldersBrowseAnswer('Beta', true));
  await vi.waitFor(() => expect(env.state().status).toBe('ready'));
  held.respond(0, foldersBrowseAnswer('Alpha', true));
  await Promise.resolve();
  expect(env.state().tracks.map((track) => track.title)).toEqual(['Blue']);
  expect(env.state().stamp).toBe(7);
});
it('超限节点不发递归取曲目，空目录与超限状态不同', async () => {
  const env = setup();
  env.preview.select(foldersDirectory(folderDirectory('Huge', FOLDERS_LIMIT + 1)));
  expect(env.state().status).toBe('limited');
  expect(
    env.host
      .callsTo('library.browseTree')
      .every((call) => !call.includeFiles && !call.recursiveFiles),
  ).toBe(true);
  env.preview.select(foldersDirectory(folderDirectory('Empty', 0)));
  await vi.waitFor(() => expect(env.state().status).toBe('ready'));
  expect(env.state().tracks).toEqual([]);
});
it('释放和延迟切换都作废旧预览', async () => {
  const env = setup();
  const held = env.host.hold('library.browseTree');
  env.preview.select(foldersDirectory(folderDirectory('Alpha', 2)));
  env.preview.select(null);
  held.respond(0, foldersBrowseAnswer('Alpha', true));
  await Promise.resolve();
  expect(env.state().status).toBe('idle');
  env.preview.dispose();
  env.preview.select(foldersDirectory(folderDirectory('Beta')));
  expect(env.state().status).toBe('idle');
});
