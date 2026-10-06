import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  nowPlayingMenuAtom,
  nowPlayingMenuFailureAtom,
  startNowPlayingMenu,
} from '../../../../../src/shell/player/context-menu/nowPlayingMenu.ts';
import { currentTrackAtom, startPlayback } from '../../../../../src/playback/playback.ts';
import { hostFailure } from '../../../../fixtures/hostAnswers.ts';
import { playlistRow } from '../../../../fixtures/libraryRows.ts';
import { makeTrack } from '../../../../fixtures/tracks.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

const TRACK = makeTrack({ path: 'file://E:/Music/Disc.cue', subsong: 2 });
const NODE = {
  type: 'command' as const,
  label: 'Convert',
  displayLabel: 'Convert',
  path: 'Convert',
  displayPath: 'Convert',
  commandId: 8,
  available: true,
  executable: false,
};
const TREE = {
  success: true as const,
  mode: 'handles' as const,
  locale: 'en',
  i18n: true,
  withAvailability: true,
  items: [NODE],
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function setup() {
  const host = installFakeHost();
  host.answer('playback.getState', {
    success: true,
    state: 'paused',
    canSeek: true,
    canPause: true,
  });
  host.answer('playback.getCurrentTrack', { success: true, found: true, track: TRACK });
  host.answer('menu.getContextMenu', TREE);
  host.answer('playback.getStopAfterCurrent', { success: true, enabled: false });
  const playlists = [
    playlistRow(0, 'Default'),
    playlistRow(1, 'Locked', { isLocked: true }),
    playlistRow(2, '[WebView Queue]'),
  ];
  host.answer('playlist.getAll', { success: true, playlists, count: playlists.length });
  const store = createStore();
  const playback = startPlayback(store, host.fb);
  await playback.ready;
  await flush();
  const menu = startNowPlayingMenu(
    store,
    {
      pathOf: (track) => `${track.path}|subsong:${track.subsong}`,
      albumOf: () => null,
    },
    host.fb,
  );
  onTestFinished(() => {
    menu.dispose();
    playback.dispose();
  });
  return { host, store, menu, state: () => store.get(nowPlayingMenuAtom) };
}

describe('正在播放菜单', () => {
  it('绑定路径及分轨，过滤宿主列表，未知扩展仍可按编号执行', async () => {
    const { host, menu, state } = await setup();
    await menu.prepare(TRACK, 0);
    expect(state().targets.map(({ name, locked }) => [name, locked])).toEqual([
      ['Default', false],
      ['Locked', true],
    ]);
    expect(state().stopAfter).toBe(false);
    expect(host.callsTo('menu.getContextMenu')).toEqual([
      expect.objectContaining({ mode: 'handles', handles: [`${TRACK.path}|subsong:2`] }),
    ]);
    await menu.run(NODE);
    expect(host.callsTo('menu.runContextCommandById')).toEqual([
      { id: 8, mode: 'handles', handles: [`${TRACK.path}|subsong:2`] },
    ]);
  });

  it('停止选项先订阅后读取，较新的事件盖过迟到的初读', async () => {
    const { host, menu, state } = await setup();
    const held = host.hold('playback.getStopAfterCurrent');
    const pending = menu.prepare(TRACK, 0);
    await flush();
    expect(host.listenerCount('playback:stopAfterCurrentChanged')).toBe(1);
    host.emit('playback:stopAfterCurrentChanged', { enabled: true });
    held.release();
    await pending;
    expect(state().stopAfter).toBe(true);
    menu.close();
    expect(host.listenerCount('playback:stopAfterCurrentChanged')).toBe(0);
  });

  it('暂停与标签编辑不关闭，换曲立即作废菜单及迟到的读取', async () => {
    const { host, menu, state } = await setup();
    const held = host.hold('menu.getContextMenu');
    const pending = menu.prepare(TRACK, 0);
    await flush();
    host.emit('playback:paused', { paused: false });
    host.emit('playback:edited', { ...TRACK, title: 'Edited' });
    expect(menu.isCurrent(TRACK)).toBe(true);
    host.emit('playback:trackChanged', makeTrack({ path: 'file://E:/Other.flac' }));
    expect(state().track).toBeNull();
    held.release();
    await pending;
    expect(state().tree.roots).toEqual([]);
    await menu.run(NODE);
    expect(host.callsTo('menu.runContextCommandById')).toEqual([]);
  });

  it('关闭后读取不落地，重开及重试只采用最新一份命令树', async () => {
    const { host, menu, state } = await setup();
    host.answer('menu.getContextMenu', hostFailure('OPERATION_FAILED'));
    await menu.prepare(TRACK, 0);
    expect(state().tree.failed).toBe(true);
    const targets = state().targets;
    host.answer('menu.getContextMenu', TREE);
    await menu.retry();
    expect(state().targets).toBe(targets);
    expect(state().tree.roots).toEqual([NODE]);
    expect(host.callsTo('playlist.getAll')).toHaveLength(1);
    const held = host.hold('menu.getContextMenu');
    const pending = menu.retry();
    menu.close();
    held.release();
    await pending;
    expect(state().track).toBeNull();
    expect(state().tree.roots).toEqual([]);
  });

  it('从头播放只跳回零并恢复暂停，不更换列表；关闭不取消已受理的动作', async () => {
    const { host, menu } = await setup();
    await menu.prepare(TRACK, 0);
    const held = host.hold('playback.setPosition');
    const pending = menu.restart();
    await flush();
    menu.close();
    held.release();
    await pending;
    expect(host.callsTo('playback.setPosition')).toEqual([{ position: 0 }]);
    expect(host.callsTo('playback.play')).toHaveLength(1);
    expect(host.callsTo('playlist.playTrack')).toEqual([]);
  });

  it('seek 等待期间换曲，不恢复另一首；命令失败在关闭后仍然报告', async () => {
    const { host, menu, store } = await setup();
    await menu.prepare(TRACK, 0);
    const held = host.hold('playback.setPosition');
    const pending = menu.restart();
    await flush();
    host.emit('playback:trackChanged', makeTrack({ path: 'file://E:/Other.flac' }));
    held.release();
    await pending;
    expect(host.callsTo('playback.play')).toEqual([]);
    const track = store.get(currentTrackAtom);
    expect(track).not.toBeNull();
    if (!track) return;
    await menu.prepare(track, 0);
    host.answer('playback.setStopAfterCurrent', hostFailure('OPERATION_FAILED'));
    const command = menu.setStopAfter(true);
    menu.close();
    await command;
    expect(host.callsTo('playback.setStopAfterCurrent')).toEqual([{ enabled: true }]);
    expect(store.get(nowPlayingMenuFailureAtom)).toBe(true);
    menu.dismissFailure();
    expect(store.get(nowPlayingMenuFailureAtom)).toBe(false);
  });
});
