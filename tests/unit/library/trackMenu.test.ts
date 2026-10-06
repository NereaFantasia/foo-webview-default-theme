import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import { MENU_HANDLES_LIMIT } from '../../../src/library/albumMenu.ts';
import { startTrackMenu, trackMenuAtom } from '../../../src/library/trackMenu.ts';
import { playlistRow, trackRow } from '../../fixtures/libraryRows.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

const NODE = {
  type: 'command' as const,
  label: 'Properties',
  displayLabel: 'Properties',
  path: 'Properties',
  displayPath: 'Properties',
  available: true,
  commandId: 7,
};

function menuHost(options: { available?: boolean } = {}) {
  const host = installFakeHost(options);
  const playlists = [playlistRow(0, 'Default'), playlistRow(1, 'Locked', { isLocked: true })];
  host.answer('playlist.getAll', { success: true, playlists, count: playlists.length });
  host.answer('menu.getContextMenu', {
    success: true,
    mode: 'handles',
    locale: 'en',
    i18n: true,
    withAvailability: true,
    items: [NODE],
  });
  return host;
}

function setup(host: UnitHost) {
  const store = createStore();
  const menu = startTrackMenu(store, host.fb);
  onTestFinished(() => menu.dispose());
  return { menu, state: () => store.get(trackMenuAtom) };
}

const TRACKS = [
  trackRow('Live', 'One', { path: 'file://E:\\Music\\Live.flac', subsong: 2 }),
  trackRow('Blue', 'Two'),
];

describe('曲目菜单', () => {
  it('评分戳与曲目一同固定，重试扩展不把旧行当成新读取', async () => {
    const host = menuHost();
    const { menu, state } = setup(host);
    await menu.prepare(TRACKS, TRACKS[1], 17);
    await menu.retry();
    expect(state().anchor).toEqual(TRACKS[1]);
    expect(state().ratingStamp).toBe(17);
    await menu.prepare(TRACKS.slice(0, 1), TRACKS[0], 23);
    expect(state().ratingStamp).toBe(23);
  });
  it('作用对象立刻定下；再读发送目标与这批路径的命令树', async () => {
    const host = menuHost();
    const { menu, state } = setup(host);
    const pending = menu.prepare(TRACKS);
    expect(state().tracks).toEqual(TRACKS);
    expect(state().tracks).not.toBe(TRACKS);
    await pending;
    expect(state().targets.map((target) => [target.name, target.locked])).toEqual([
      ['Default', false],
      ['Locked', true],
    ]);
    expect(state().tree.roots).toHaveLength(1);
    expect(host.callsTo('menu.getContextMenu')).toEqual([
      expect.objectContaining({
        mode: 'handles',
        handles: ['file://E:\\Music\\Live.flac|subsong:2', TRACKS[1]?.path],
      }),
    ]);
  });

  it('条数过了上限不建命令树；连着打开两次，先开的那一批晚到的结果丢掉', async () => {
    const host = menuHost();
    const { menu, state } = setup(host);
    const many = Array.from({ length: MENU_HANDLES_LIMIT + 1 }, (_, at) => trackRow('A', `t${at}`));
    await menu.prepare(many);
    expect(host.callsTo('menu.getContextMenu')).toEqual([]);
    const held = host.hold('menu.getContextMenu');
    const first = menu.prepare(TRACKS.slice(0, 1));
    const second = menu.prepare(TRACKS.slice(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    held.respond(0, {
      success: true,
      mode: 'handles',
      locale: 'en',
      i18n: true,
      withAvailability: true,
      items: [],
    });
    held.release();
    await Promise.all([first, second]);
    expect(state().tracks).toEqual(TRACKS.slice(1));
    expect(state().tree.roots).toHaveLength(1);
  });

  it('没连上宿主时只记下作用对象，一个请求都不发', async () => {
    const host = menuHost({ available: false });
    const { menu, state } = setup(host);
    await menu.prepare(TRACKS);
    expect(state().tracks).toEqual(TRACKS);
    expect(host.callsTo('playlist.getAll')).toEqual([]);
  });

  it('关闭后迟到的命令树不再写入，也不改变绑定的曲目', async () => {
    const host = menuHost();
    const { menu, state } = setup(host);
    const held = host.hold('menu.getContextMenu');
    const pending = menu.prepare(TRACKS);
    await new Promise((resolve) => setTimeout(resolve, 0));
    menu.close();
    held.release();
    await pending;
    expect(state().tree.roots).toEqual([]);
    expect(state().tracks).toEqual(TRACKS);
  });

  it('扩展读取失败后只重试命令树，保留对象与发送目标', async () => {
    const host = menuHost();
    host.answer('menu.getContextMenu', hostFailure('OPERATION_FAILED'));
    const { menu, state } = setup(host);
    await menu.prepare(TRACKS);
    expect(state().tree.failed).toBe(true);
    const targets = state().targets;
    host.answer('menu.getContextMenu', {
      success: true,
      mode: 'handles',
      locale: 'en',
      i18n: true,
      withAvailability: true,
      items: [NODE],
    });
    const pending = menu.retry();
    expect(state().targets).toBe(targets);
    expect(state().tracks).toEqual(TRACKS);
    await pending;
    expect(state().tree.failed).not.toBe(true);
    expect(state().tree.roots).toEqual([NODE]);
    expect(host.callsTo('playlist.getAll')).toHaveLength(1);
  });
});
