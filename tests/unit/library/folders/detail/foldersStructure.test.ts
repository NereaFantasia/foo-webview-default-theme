import { expect, it } from 'vitest';
import {
  foldersItems,
  foldersStructure,
} from '../../../../../src/library/folders/detail/foldersStructure.ts';
import {
  foldersDirectory,
  foldersRoot,
} from '../../../../../src/library/folders/tree/foldersModel.ts';
import {
  folderDirectory,
  FOLDER_ROOT,
  FOLDER_TRACKS,
} from '../../../../fixtures/foldersLibrary.ts';
import { trackRow } from '../../../../fixtures/libraryRows.ts';

it('直属曲目与嵌套目录各自排序，折叠不改变完整播放集合', () => {
  const alpha = foldersDirectory(folderDirectory('Alpha', 2, true));
  const result = foldersStructure([alpha], FOLDER_TRACKS.slice(0, 2), {
    column: 'title',
    descending: false,
  });
  expect(result.tracks.map((track) => track.title)).toEqual(['Zebra', 'Amber']);
  expect(result.groups[0]?.children[0]?.node.pathId).toBe('Alpha/Disc');
  const child = result.groups[0]!.children[0]!;
  const items = foldersItems(result, new Set([child.node.key]), 0, 40);
  expect(items.filter((item) => item.kind === 'row').map((item) => item.key)).toEqual([
    FOLDER_TRACKS[0]!.handle,
  ]);
  expect(result.tracks).toHaveLength(2);
});
it('父子选择去重，但同一文件的 subsong 与不同父目录的同名子目录保留', () => {
  const alpha = foldersDirectory(folderDirectory('Alpha', 3, true));
  const disc = foldersDirectory(folderDirectory('Alpha/Disc'));
  const beta = foldersDirectory(folderDirectory('Beta', 1, true));
  const extra = trackRow('Alpha', 'Cue 2', { path: FOLDER_TRACKS[1]!.path, subsong: 2 });
  const other = trackRow('Beta', 'Other', { path: 'file://E:\\Music\\Beta\\Disc\\01.flac' });
  const result = foldersStructure(
    [alpha, disc, beta],
    [...FOLDER_TRACKS.slice(0, 2), extra, other, FOLDER_TRACKS[0]!],
    null,
  );
  expect(result.groups).toHaveLength(2);
  expect(result.tracks).toHaveLength(4);
  expect(result.groups.map((group) => group.children[0]?.node.pathId)).toEqual([
    'Alpha/Disc',
    'Beta/Disc',
  ]);
  expect(result.tracks.map((track) => track.handle)).toContain(extra.handle);
});
it('封面形态仍显示本层曲目；叶目录保持曲目表', () => {
  const alpha = foldersDirectory(folderDirectory('Alpha', 2, true));
  const result = foldersStructure([alpha], FOLDER_TRACKS.slice(0, 2), null);
  expect(
    foldersItems(result, new Set(), 0, 40, true)
      .filter((item) => item.kind === 'row')
      .map((item) => item.key),
  ).toEqual([FOLDER_TRACKS[0]!.handle]);
  const leaf = foldersStructure(
    [foldersDirectory(folderDirectory('Beta'))],
    FOLDER_TRACKS.slice(2),
    null,
  );
  expect(foldersItems(leaf, new Set(), 0, 40, true).map((item) => item.kind)).toEqual(['row']);
});
it('父根先选时，嵌套库根仍独立归属并保留显示顺序', () => {
  const parent = foldersRoot(FOLDER_ROOT);
  const nested = foldersRoot({
    ...FOLDER_ROOT,
    id: 'E:\\Music\\Nested',
    absolutePath: 'E:\\Music\\Nested',
    rawPath: 'E:\\Music\\Nested',
    displayName: 'Nested',
  });
  const outerTrack = trackRow('', 'Outer', { path: 'file://E:\\Music\\Outer.flac' });
  const innerTrack = trackRow('Nested', 'Inner');
  const result = foldersStructure([parent, nested], [outerTrack, innerTrack], null);
  expect(result.groups.map((group) => group.node.key)).toEqual([parent.key, nested.key]);
  expect(result.groups.map((group) => group.direct)).toEqual([[outerTrack], [innerTrack]]);
  expect(result.groups.map((group) => group.children)).toEqual([[], []]);
  expect(result.tracks).toEqual([outerTrack, innerTrack]);
});
it('不按目录分组：曲目按目录树摊平后整体排序，同值保持树的次序，条目里没有组头', () => {
  const alpha = foldersDirectory(folderDirectory('Alpha', 2, true));
  const tracks = FOLDER_TRACKS.slice(0, 2);
  const flat = (sort: Parameters<typeof foldersStructure>[2]) =>
    foldersStructure([alpha], tracks, sort, false);
  const titles = (sort: Parameters<typeof foldersStructure>[2]) =>
    flat(sort).tracks.map((track) => track.title);
  expect(titles(null)).toEqual(['Zebra', 'Amber']);
  expect(titles({ column: 'title', descending: false })).toEqual(['Amber', 'Zebra']);
  expect(titles({ column: 'title', descending: true })).toEqual(['Zebra', 'Amber']);
  expect(titles({ column: 'sampleRate', descending: true })).toEqual(['Zebra', 'Amber']);
  const result = flat({ column: 'title', descending: false });
  expect(result.flat).toBe(true);
  expect(result.groups[0]?.children).toHaveLength(1);
  expect(foldersItems(result, new Set(), 0, 40).map((item) => item.kind)).toEqual(['row', 'row']);
  expect(
    foldersItems(result, new Set(), 0, 40).flatMap((item) =>
      item.kind === 'row' ? [item.key] : [],
    ),
  ).toEqual(result.tracks.map((track) => track.handle));
  expect(foldersStructure([alpha], tracks, null).flat).toBe(false);
});
