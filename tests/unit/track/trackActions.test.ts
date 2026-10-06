import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import { LIBRARY_VIEW_PLAYLIST } from '../../../src/playback/libraryView.ts';
import { LIBRARY_SOURCE, type PlaybackSource } from '../../../src/playback/playbackSource.ts';
import { startTrackActions, trackActionsNoticeAtom } from '../../../src/track/trackActions.ts';
import { readSendTargets } from '../../../src/track/trackListActions.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { playlistGuid, playlistRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

const VIEW = 3;
const PATHS = ['file://E:\\Music\\Blue\\Blue1.flac', 'file://E:\\Music\\Blue\\Blue2.flac'];
const BLUE: PlaybackSource = { kind: 'album', subject: 'blue', name: 'Blue' };

/** 专用列表在第 3 张、已有 10 行。 */
function libraryHost(options: { available?: boolean } = {}) {
  const host = installFakeHost(options);
  const playlists = [
    playlistRow(0, 'Default'),
    playlistRow(VIEW, LIBRARY_VIEW_PLAYLIST, { trackCount: 10 }),
  ];
  host.answer('playlist.getAll', { success: true, playlists, count: playlists.length });
  return host;
}

function setup(host: UnitHost) {
  const store = createStore();
  const recorded: PlaybackSource[] = [];
  const actions = startTrackActions(store, { record: (source) => recorded.push(source) }, host.fb);
  return { actions, recorded, notice: () => store.get(trackActionsNoticeAtom) };
}

describe('按一批路径执行', () => {
  it('起播从第 index 首起、成功后记下来源，入队、发送同样按这批，失败照样挂横幅', async () => {
    const host = libraryHost();
    const { actions, recorded, notice } = setup(host);
    expect(await actions.playPaths(PATHS, 1, BLUE)).toBe(true);
    expect(recorded).toEqual([BLUE]);
    expect(host.callsTo('library.addToPlaylist')).toEqual([
      { paths: PATHS, playlistGuid: playlistGuid(VIEW) },
    ]);
    expect(host.callsTo('playlist.playTrack')).toEqual([
      { playlistGuid: playlistGuid(VIEW), index: 1 },
    ]);
    expect(await actions.queuePaths(PATHS, true)).toBe(true);
    expect(await actions.queuePaths(PATHS, false)).toBe(true);
    expect(host.callsTo('queue.insertNext')).toHaveLength(2);
    expect(host.callsTo('queue.add')).toHaveLength(0);
    const [target] = await readSendTargets(host.fb);
    expect(await actions.sendPathsTo(PATHS, target!)).toBe(true);
    expect(await actions.sendPathsToNew(PATHS, 'Picked')).toBe(true);
    expect(host.callsTo('playlist.create').map((call) => call['name'])).toEqual(['Picked']);
    host.answer('playlist.playTrack', hostFailure('OPERATION_FAILED'));
    expect(await actions.playPaths(PATHS, 0, LIBRARY_SOURCE)).toBe(false);
    expect(notice()).toBe('album.playFailed');
    expect(await actions.playPaths(PATHS, 5, LIBRARY_SOURCE)).toBe(false);
    expect(recorded).toEqual([BLUE]);
  });

  it('发送被宿主拒收时挂命令失败，收起后下一次失败照样挂', async () => {
    const host = libraryHost();
    const { actions, notice } = setup(host);
    const [target] = await readSendTargets(host.fb);
    host.answer('library.addToPlaylist', hostFailure('LOCKED'));
    expect(await actions.sendPathsTo(PATHS, target!)).toBe(false);
    expect(notice()).toBe('album.commandFailed');
    actions.dismissNotice();
    expect(notice()).toBeNull();
    host.answer('library.addToPlaylist', hostFailure('NOT_FOUND'));
    expect(await actions.sendPathsTo(PATHS, target!)).toBe(false);
    expect(notice()).toBe('album.commandFailed');
  });

  it('现取路径的起播：正忙时不取、挂忙碌提示，取不到算起播失败；只有收下的那一次记来源', async () => {
    const host = libraryHost();
    const held = host.hold('playlist.playTrack');
    const { actions, recorded, notice } = setup(host);
    const loads: string[] = [];
    const load = (name: string, paths: readonly string[] | null) => async () => {
      loads.push(name);
      return paths;
    };
    const first = actions.playLoaded(load('A', PATHS), 0, BLUE);
    expect(await actions.playLoaded(load('B', PATHS), 0, LIBRARY_SOURCE)).toBe(false);
    expect(notice()).toBe('album.busy');
    await new Promise((resolve) => setTimeout(resolve, 0));
    held.release();
    expect(await first).toBe(true);
    expect(loads).toEqual(['A']);
    expect(await actions.playLoaded(load('C', null), 0, LIBRARY_SOURCE)).toBe(false);
    expect(notice()).toBe('album.playFailed');
    expect(recorded).toEqual([BLUE]);
  });

  it('「更多命令」按生成那棵树时的目标执行', async () => {
    const host = libraryHost();
    const { actions } = setup(host);
    const node = {
      type: 'command' as const,
      label: 'Properties',
      displayLabel: 'Properties',
      path: 'Properties',
      displayPath: 'Properties',
      available: true,
      commandId: 7,
    };
    const tree = { roots: [node], target: { mode: 'handles' as const, handles: PATHS } };
    expect(await actions.runCommandIn(tree, node)).toBe(true);
    expect(host.callsTo('menu.runContextCommandById')).toEqual([
      { id: 7, mode: 'handles', handles: PATHS },
    ]);
  });

  it('没连上宿主时一个请求都不发', async () => {
    const host = libraryHost({ available: false });
    const { actions, recorded } = setup(host);
    expect(await actions.playPaths(PATHS, 0, LIBRARY_SOURCE)).toBe(false);
    expect(await actions.queuePaths(PATHS, true)).toBe(false);
    expect(await actions.command(async () => true)).toBe(false);
    expect(host.calls).toEqual([]);
    expect(recorded).toEqual([]);
  });
});
