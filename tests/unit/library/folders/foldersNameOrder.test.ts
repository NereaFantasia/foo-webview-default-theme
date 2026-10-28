import { createStore } from 'jotai/vanilla';
import { expect, it, onTestFinished, vi } from 'vitest';
import {
  foldersTreeAtom,
  startFoldersTree,
} from '../../../../src/library/folders/tree/foldersTree.ts';
import {
  FOLDERS_LIMIT,
  foldersDirectory,
  foldersRoot,
  foldersSubject,
} from '../../../../src/library/folders/tree/foldersModel.ts';
import {
  foldersPreviewAtom,
  startFoldersPreview,
} from '../../../../src/library/folders/detail/foldersPreview.ts';
import { foldersStructure } from '../../../../src/library/folders/detail/foldersStructure.ts';
import {
  FOLDER_ROOT,
  folderDirectory,
  foldersAnswers,
  foldersBrowseAnswer,
  foldersRootsAnswer,
} from '../../../fixtures/foldersLibrary.ts';
import { trackRow } from '../../../fixtures/libraryRows.ts';
import { UnitHost } from '../../../fixtures/unitHost.ts';

const NAMES = [
  'あいう',
  'アイウ',
  '专辑',
  '音乐',
  'Beta',
  'alpha',
  'Disc 10',
  'Disc 2',
  'Disc 02',
  'Café',
  'Cafe',
];

function setup() {
  const host = new UnitHost({ answers: foldersAnswers() });
  const store = createStore();
  const tree = startFoldersTree(store, host.fb);
  const preview = startFoldersPreview(store, () => 0, host.fb);
  onTestFinished(() => {
    preview.dispose();
    tree.dispose();
    host.dispose();
  });
  return { host, store, tree, preview };
}

it.each(['', 'Alpha'])('目录 %s 的中英日名称在树、列表分组与封面目录中保持同序', async (pathId) => {
  const { host, store, tree, preview } = setup();
  const paths = NAMES.map((name) => [pathId, name].filter(Boolean).join('/'));
  const directories = paths.map((path) => folderDirectory(path));
  const tracks = [...paths]
    .reverse()
    .map((path) =>
      trackRow('', 'Song', { path: `file://E:\\Music\\${path.replaceAll('/', '\\')}\\01.flac` }),
    );
  host.answer('library.browseTree', (params) =>
    params.pathId === pathId
      ? { ...foldersBrowseAnswer(pathId), directories, files: params.includeFiles ? tracks : [] }
      : foldersBrowseAnswer(String(params.pathId ?? '')),
  );
  tree.want();
  await vi.waitFor(() => expect(store.get(foldersTreeAtom).status).toBe('ready'));
  const key = foldersSubject({ rootId: FOLDER_ROOT.id, pathId });
  const node = await tree.locate(key);
  if (!node) throw new Error('缺少目标目录');
  await tree.expand(key);
  preview.select(node);
  await vi.waitFor(() => expect(store.get(foldersPreviewAtom).status).toBe('ready'));

  const state = store.get(foldersTreeAtom);
  const left = state.children.get(key)?.map((child) => state.nodes.get(child)?.name);
  const current = store.get(foldersPreviewAtom);
  const structure = foldersStructure(current.nodes, current.tracks, null);
  const right = structure.groups[0]?.children.map((group) => group.node.name);
  expect(left).toEqual(right);
  expect(current.directories.map((child) => child.name)).toEqual(right);
  expect(right).toHaveLength(NAMES.length);
  expect(right?.indexOf('Disc 2')).toBeLessThan(right?.indexOf('Disc 10') ?? -1);
  expect(right?.indexOf('alpha')).toBeLessThan(right?.indexOf('Beta') ?? -1);
  expect(directories.map((child) => child.displayName)).toEqual(NAMES);
  expect(
    foldersStructure(current.nodes, [...current.tracks].reverse(), {
      column: 'title',
      descending: true,
    }).groups[0]?.children.map((group) => group.node.name),
  ).toEqual(right);
});

it('超限目录卡片与正常分组同序，不依赖宿主的目录返回顺序', async () => {
  const { host, store, preview } = setup();
  const node = foldersDirectory(folderDirectory('Huge', FOLDERS_LIMIT + 1));
  const directories = NAMES.map((name) => folderDirectory(`Huge/${name}`));
  const tracks = [...NAMES]
    .reverse()
    .map((name) => trackRow('', 'Song', { path: `file://E:\\Music\\Huge\\${name}\\01.flac` }));
  host.answer('library.browseTree', { ...foldersBrowseAnswer('Huge'), directories });
  preview.select(node);
  await vi.waitFor(() =>
    expect(store.get(foldersPreviewAtom).directories).toHaveLength(NAMES.length),
  );
  const current = store.get(foldersPreviewAtom);
  expect(current.status).toBe('limited');
  expect(current.tracks).toEqual([]);
  expect(current.directories.map((child) => child.name)).toEqual(
    foldersStructure([node], tracks, null).groups[0]?.children.map((group) => group.node.name),
  );
});

it('多个选中目录保留选择顺序，各自的子目录按自然顺序排列', async () => {
  const { host, store, preview } = setup();
  const nodes = ['Beta', 'Alpha'].map((name) => foldersDirectory(folderDirectory(name)));
  host.answer('library.browseTree', (params) => {
    const pathId = String(params.pathId ?? '');
    return {
      ...foldersBrowseAnswer(pathId),
      directories: ['Disc 10', 'Disc 2'].map((name) => folderDirectory(`${pathId}/${name}`)),
    };
  });
  preview.selectMany(nodes);
  await vi.waitFor(() => expect(store.get(foldersPreviewAtom).status).toBe('ready'));
  const current = store.get(foldersPreviewAtom);
  expect(current.nodes).toEqual(nodes);
  expect(current.directories.map((child) => child.pathId)).toEqual([
    'Beta/Disc 2',
    'Beta/Disc 10',
    'Alpha/Disc 2',
    'Alpha/Disc 10',
  ]);
});

it('媒体库根目录也按名称自然排序', async () => {
  const { host, store, tree } = setup();
  const roots = ['Music 10', 'Music 2'].map((name) => ({
    ...FOLDER_ROOT,
    id: `E:\\${name}`,
    absolutePath: `E:\\${name}`,
    displayName: name,
  }));
  host.answer('library.getRoots', { ...foldersRootsAnswer(), roots });
  tree.want();
  await vi.waitFor(() => expect(store.get(foldersTreeAtom).status).toBe('ready'));
  expect(store.get(foldersTreeAtom).roots).toEqual(
    [...roots].reverse().map((root) => foldersRoot(root).key),
  );
});
