import type { MenuCommand, MenuItem, MenuSubmenu } from 'foo-webview-sdk';
import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import { startPlaylistRows } from '../../../src/playlist/playlistRows.ts';
import { startPlaylists } from '../../../src/playback/playlists.ts';
import { createPlaylistTrackMenu } from '../../../src/playlist/playlistTrackMenu.ts';
import { FakePlaylists, guidOf, makePlaylist, makeRow } from '../../fixtures/fakePlaylists.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const MAIN = guidOf(0);
const OTHER = guidOf(1);
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function command(label: string, commandId: number): MenuCommand {
  return {
    type: 'command',
    label,
    displayLabel: label,
    path: label,
    displayPath: label,
    available: true,
    enabled: true,
    commandId,
  };
}

/** 一棵带属性与评分子菜单的命令树。 */
const RATING: MenuSubmenu = {
  type: 'submenu',
  label: 'Rating',
  displayLabel: 'Rating',
  path: 'Rating',
  displayPath: 'Rating',
  children: [1, 2, 3, 4, 5].map((value) => command(String(value), 20 + value)),
};
const TREE: MenuItem[] = [command('Properties', 7), RATING];

function answer(items: MenuItem[]) {
  return {
    success: true as const,
    mode: 'selection' as const,
    locale: 'en',
    i18n: true,
    withAvailability: true,
    items,
  };
}

/** Main 是活动列表；两张的行都有页面在看，内容版本跟着宿主的增删走。 */
async function setup(settled: () => Promise<boolean> = async () => true) {
  const host = installFakeHost();
  const lists = new FakePlaylists(
    host,
    [
      makePlaylist(0, 'Main', { isActive: true, trackCount: 3 }),
      makePlaylist(1, 'Other', { trackCount: 1 }),
    ],
    (event, payload) => host.emit(event, payload),
  );
  lists.setTracks(
    MAIN,
    [0, 1, 2].map((row) => makeRow('Main', row)),
  );
  lists.setTracks(OTHER, [makeRow('Other', 0)]);
  host.answer('menu.getContextMenu', answer(TREE));
  host.answer('menu.runContextCommandById', { success: true });
  const store = createStore();
  const playlists = startPlaylists(store, host.fb);
  const rows = startPlaylistRows(store, { stamp: () => 0, refetch: atom(0) }, host.fb);
  await Promise.all([playlists.ready, rows.ready]);
  rows.acquire(MAIN);
  rows.acquire(OTHER);
  await wait(50);
  const settle = vi.fn(settled);
  const menu = createPlaylistTrackMenu(store, { selection: { settle }, rows }, host.fb);
  const state = () => store.get(menu.stateAtom);
  const failed = () => store.get(menu.failedAtom);
  const properties = () => {
    const found = state().known.properties;
    if (!found) throw new Error('应认出属性');
    return found;
  };
  return { host, menu, settle, state, failed, properties };
}

describe('createPlaylistTrackMenu', () => {
  it('先等选中落地，再按宿主那份选中读命令树，认出属性与评分', async () => {
    const { host, menu, settle, state } = await setup();
    await menu.prepare(MAIN);
    expect(settle).toHaveBeenCalledWith(MAIN);
    expect(host.callsTo('menu.getContextMenu')).toMatchObject([{ mode: 'selection' }]);
    expect(state().tree.roots).toHaveLength(2);
    expect(state().known.properties?.commandId).toBe(7);
    expect(state().known.rating?.values.map((entry) => entry.value)).toStrictEqual([1, 2, 3, 4, 5]);
  });

  it('选中没落地就不读，树留空，宿主的几项置灰', async () => {
    const { host, menu, state } = await setup(async () => false);
    await menu.prepare(MAIN);
    expect(host.callsTo('menu.getContextMenu')).toEqual([]);
    expect(state().tree.roots).toEqual([]);
    expect(state().known.properties).toBeNull();
  });

  it('又开了一次：上一次的树按先后晚到也丢掉；开的时候先清成空树', async () => {
    const { host, menu, state } = await setup();
    await menu.prepare(MAIN);
    const held = host.hold('menu.getContextMenu');
    const first = menu.prepare(MAIN);
    expect(state().tree.roots).toEqual([]);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    const second = menu.prepare(MAIN);
    await vi.waitFor(() => expect(held.pending).toHaveLength(2));
    held.respond(0);
    await first;
    expect(state().tree.roots).toEqual([]);
    held.respond(0, answer(TREE.slice(0, 1)));
    await second;
    expect(state().tree.roots).toHaveLength(1);
  });

  it('执行一条：目标是生成这棵树时的宿主选中；办成了收起失败', async () => {
    const { host, menu, failed, properties } = await setup();
    await menu.prepare(MAIN);
    expect(await menu.run(properties())).toBe(true);
    expect(host.callsTo('menu.runContextCommandById')).toMatchObject([
      { id: 7, mode: 'selection' },
    ]);
    expect(failed()).toBe(false);
  });

  it('这张不是宿主的活动列表时不读树；读树之后活动列表被换走，执行时不发并记失败', async () => {
    const { host, menu, state, failed, properties } = await setup();
    await menu.prepare(OTHER);
    expect(host.callsTo('menu.getContextMenu')).toEqual([]);
    expect(state().tree.roots).toEqual([]);
    await menu.prepare(MAIN);
    const node = properties();
    await host.invoke('playlist.setActive', { playlistGuid: OTHER });
    await wait(250);
    expect(await menu.run(node)).toBe(false);
    expect(host.callsTo('menu.runContextCommandById')).toEqual([]);
    expect(failed()).toBe(true);
  });

  it('读树之后列表增删了行：编号已对不上看到的那一批，不发、记失败；重开之后照常办成、失败收起', async () => {
    const { host, menu, failed, properties } = await setup();
    await menu.prepare(MAIN);
    const stale = properties();
    await host.fb.playlist.removeTracks(MAIN, [0]);
    await wait(400);
    expect(await menu.run(stale)).toBe(false);
    expect(host.callsTo('menu.runContextCommandById')).toEqual([]);
    expect(failed()).toBe(true);
    await menu.prepare(MAIN);
    expect(await menu.run(properties())).toBe(true);
    expect(failed()).toBe(false);
  });

  it('释放之后：在途的树不落地，执行不发', async () => {
    const { host, menu, state, properties } = await setup();
    await menu.prepare(MAIN);
    const node = properties();
    const held = host.hold('menu.getContextMenu');
    const pending = menu.prepare(MAIN);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    menu.dispose();
    held.release();
    await pending;
    expect(state().tree.roots).toEqual([]);
    expect(await menu.run(node)).toBe(false);
    expect(host.callsTo('menu.runContextCommandById')).toEqual([]);
  });

  it('关闭使在途读取失效，之前的命令也不能再执行', async () => {
    const { host, menu, state, properties } = await setup();
    await menu.prepare(MAIN);
    const node = properties();
    const held = host.hold('menu.getContextMenu');
    const pending = menu.prepare(MAIN);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    menu.close();
    held.release();
    await pending;
    expect(state().tree.roots).toEqual([]);
    expect(await menu.run(node)).toBe(false);
    expect(host.callsTo('menu.runContextCommandById')).toEqual([]);
  });
});
