import { createStore } from 'jotai/vanilla';
import { expect, it, onTestFinished, vi } from 'vitest';
import {
  startFoldersActions,
  foldersNoticeAtom,
} from '../../../../../src/library/folders/actions/foldersActions.ts';
import {
  FOLDERS_LIMIT,
  foldersDirectory,
  foldersRoot,
} from '../../../../../src/library/folders/tree/foldersModel.ts';
import { foldersSort } from '../../../../../src/library/folders/detail/foldersSort.ts';
import {
  foldersQuery,
  createFoldersAutoplaylist,
} from '../../../../../src/library/folders/actions/foldersQuery.ts';
import {
  folderDirectory,
  foldersAnswers,
  foldersBrowseAnswer,
  FOLDER_ROOT,
  FOLDER_TRACKS,
} from '../../../../fixtures/foldersLibrary.ts';
import { UnitHost } from '../../../../fixtures/unitHost.ts';
import { hostFailure } from '../../../../fixtures/hostAnswers.ts';
import { trackRow } from '../../../../fixtures/libraryRows.ts';

function setup() {
  const host = new UnitHost({ answers: foldersAnswers() });
  const store = createStore();
  const record = vi.fn();
  const actions = startFoldersActions(
    store,
    { record, openPlaylist: vi.fn(), roots: () => [foldersRoot(FOLDER_ROOT)] },
    host.fb,
  );
  onTestFinished(() => {
    actions.dispose();
    host.dispose();
  });
  return { host, store, actions, record };
}
it('按显示顺序播放且成功后才记录目录来源；路径带 subsong 原样传递', async () => {
  const env = setup();
  const node = foldersDirectory(folderDirectory('Alpha', 2));
  const cue = trackRow('Alpha', 'A cue', { subsong: 2 });
  const tracks = foldersSort([FOLDER_TRACKS[0]!, cue], { column: 'title', descending: false });
  await env.actions.run({ nodes: [node], tracks }, 'play', 1);
  expect(env.host.callsTo('library.addToPlaylist')[0]).toMatchObject({
    paths: [`${cue.path}|subsong:2`, FOLDER_TRACKS[0]!.path],
  });
  expect(env.host.callsTo('playlist.playTrack')[0]).toMatchObject({ index: 1 });
  expect(env.record).toHaveBeenCalledWith(node.key, node.name);
  expect(env.host.callsTo('playlist.setActive')).toEqual([]);
});
it('父子同时选中只发送一次同一完整句柄，不合并 CUE 子曲目', async () => {
  const env = setup();
  const path = 'file://E:\\Music\\Alpha\\Disc\\disc.cue';
  const one = trackRow('Alpha', 'One', { path, subsong: 1 });
  const two = trackRow('Alpha', 'Two', { path, subsong: 2 });
  env.host.answer('library.browseTree', {
    ...foldersBrowseAnswer('Alpha', true),
    files: [one, two],
  });
  const tracks = await env.actions.collect({
    nodes: [
      foldersDirectory(folderDirectory('Alpha', 2)),
      foldersDirectory(folderDirectory('Alpha/Disc', 2)),
    ],
  });
  expect(tracks?.map((track) => track.handle)).toEqual([one.handle, two.handle]);
});
it('清空后离页不追加不起播；部分添加失败不记录来源', async () => {
  const env = setup();
  const held = env.host.hold('playlist.clear');
  const target = { nodes: [foldersRoot(FOLDER_ROOT)], tracks: FOLDER_TRACKS };
  const playing = env.actions.run(target, 'play');
  await vi.waitFor(() => expect(held.pending).toHaveLength(1));
  env.actions.cancel();
  held.release();
  await playing;
  expect(env.host.callsTo('library.addToPlaylist')).toEqual([]);
  expect(env.record).not.toHaveBeenCalled();
  env.host.answer('library.addToPlaylist', { success: true, added: 1 });
  await env.actions.run(target, 'play');
  expect(env.host.callsTo('playlist.playTrack')).toEqual([]);
  expect(env.store.get(foldersNoticeAtom)).toBe('failed');
});
it('多步写串行，第二次动作明确提示忙', async () => {
  const env = setup();
  const held = env.host.hold('playlist.clear');
  const target = { nodes: [foldersRoot(FOLDER_ROOT)], tracks: FOLDER_TRACKS };
  const first = env.actions.run(target, 'play');
  await vi.waitFor(() => expect(held.pending).toHaveLength(1));
  await env.actions.run(target, 'next');
  expect(env.store.get(foldersNoticeAtom)).toBe('busy');
  held.release();
  await first;
  expect(env.host.callsTo('queue.insertNext')).toEqual([]);
});
it('超限整批不写入；任一目录读取失败不发送前面已读的部分', async () => {
  const env = setup();
  await env.actions.run(
    { nodes: [foldersDirectory(folderDirectory('Huge', FOLDERS_LIMIT + 1))] },
    'play',
  );
  expect(env.store.get(foldersNoticeAtom)).toBe('limited');
  expect(env.host.callsTo('playlist.clear')).toEqual([]);
  env.host.answer('library.browseTree', (params) =>
    params.pathId === 'Beta' ? hostFailure('OPERATION_FAILED') : foldersBrowseAnswer('Alpha', true),
  );
  await env.actions.run(
    {
      nodes: [
        foldersDirectory(folderDirectory('Alpha', 2)),
        foldersDirectory(folderDirectory('Beta')),
      ],
    },
    'new',
  );
  expect(env.host.callsTo('playlist.create')).toEqual([]);
});
it('目录查询含分隔符并排除嵌套库根；不接受不可表示的路径', () => {
  const root = foldersRoot(FOLDER_ROOT);
  const nested = foldersRoot({
    ...FOLDER_ROOT,
    id: 'E:\\Music\\Other',
    absolutePath: 'E:\\Music\\Other',
  });
  expect(foldersQuery([root], [root, nested])).toBe(
    '(%path% HAS "e:\\music\\" AND NOT (%path% HAS "e:\\music\\other\\"))',
  );
  expect(foldersQuery([{ ...root, absolutePath: 'unpack://archive' }], [root])).toBeNull();
  expect(foldersQuery([{ ...root, absolutePath: 'E:\\a"b' }], [root])).toBeNull();
});
it('自动列表逐一核对句柄，同首数但成员不同也不创建', async () => {
  const env = setup();
  env.host.answer('library.query', {
    success: true,
    total: 3,
    tracks: FOLDER_TRACKS.map((track, index) => ({
      handle: index === 0 ? 'wrong' : track.handle,
      index,
    })),
  });
  expect(
    await createFoldersAutoplaylist(env.host.fb, 'ALL', FOLDER_TRACKS, 'Music', () => true),
  ).toBeNull();
  expect(env.host.callsTo('playlist.createAutoplaylist')).toEqual([]);
});

it('自动列表分别报告无法查询、曲目读取失败和超限', async () => {
  const env = setup();
  const root = foldersRoot(FOLDER_ROOT);
  await env.actions.autoplaylist({ nodes: [{ ...root, absolutePath: 'unpack://archive' }] });
  expect(env.store.get(foldersNoticeAtom)).toBe('queryUnavailable');
  env.host.answer('library.browseTree', hostFailure('OPERATION_FAILED'));
  await env.actions.autoplaylist({ nodes: [root] });
  expect(env.store.get(foldersNoticeAtom)).toBe('tracksFailed');
  await env.actions.autoplaylist({ nodes: [{ ...root, count: FOLDERS_LIMIT + 1 }] });
  expect(env.store.get(foldersNoticeAtom)).toBe('limited');
  expect(env.host.callsTo('playlist.createAutoplaylist')).toEqual([]);
});

it('自动列表查询或创建失败不再误报目录无法查询', async () => {
  const env = setup();
  env.host.answer('library.query', hostFailure('OPERATION_FAILED'));
  await env.actions.autoplaylist({
    nodes: [foldersDirectory(folderDirectory('Alpha', 2))],
  });
  expect(env.store.get(foldersNoticeAtom)).toBe('autoplaylistFailed');
});
