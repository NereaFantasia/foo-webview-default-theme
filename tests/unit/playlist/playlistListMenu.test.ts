import { describe, expect, it, vi } from 'vitest';
import { playlistListMenu } from '../../../src/playlist/playlistListMenu.ts';
import { NO_GROUPS } from '../../../src/playlist/groups/playlistGroups.ts';
import { GROUP_MODES } from '../../../src/playlist/sortPatterns.ts';

const GUID = '{00000000-0000-0000-0000-000000000001}';
const RUNS = [{ start: 0, count: 3, key: 'A' }];

function setup(
  options: {
    enabled?: boolean;
    mode?: number;
    runs?: boolean;
    ok?: boolean;
    locked?: boolean;
  } = {},
) {
  const ok = options.ok ?? true;
  const tracks = {
    shuffle: vi.fn(async () => ok),
    reverse: vi.fn(async () => ok),
  };
  const groups = {
    setEnabled: vi.fn(),
    setMode: vi.fn(async () => {}),
    collapseAll: vi.fn(),
    expandAll: vi.fn(),
  };
  const onReordered = vi.fn();
  const menu = playlistListMenu({
    guid: GUID,
    prefs: { enabled: options.enabled ?? true, mode: options.mode ?? 1 },
    groupsState: { ...NO_GROUPS, runs: options.runs === false ? [] : RUNS },
    groups,
    tracks,
    ...(options.locked === undefined ? {} : { locked: options.locked }),
    onReordered,
  });
  return { menu, tracks, groups, onReordered };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('playlistListMenu', () => {
  it('随机与反向交给曲目命令，宿主办成了才收列头的排序记号', async () => {
    const { menu, tracks, onReordered } = setup();
    menu.reorder?.shuffle();
    menu.reorder?.reverse();
    await flush();
    expect(tracks.shuffle).toHaveBeenCalledWith(GUID);
    expect(tracks.reverse).toHaveBeenCalledWith(GUID);
    expect(onReordered).toHaveBeenCalledTimes(2);
  });

  it('宿主没排成时不收列头的排序记号', async () => {
    const { menu, onReordered } = setup({ ok: false });
    menu.reorder?.shuffle();
    menu.reorder?.reverse();
    await flush();
    expect(onReordered).not.toHaveBeenCalled();
  });

  it('锁定列表的重排置灰，也不执行', () => {
    const { menu, tracks } = setup({ locked: true });
    expect(menu.reorder?.disabled).toBe(true);
    menu.reorder?.shuffle();
    menu.reorder?.reverse();
    expect(tracks.shuffle).not.toHaveBeenCalled();
    expect(tracks.reverse).not.toHaveBeenCalled();
  });

  it('分组段：当前依据按偏好里的下标认，选一档换成下标交给分组服务', () => {
    const { menu, groups } = setup({ mode: 3 });
    expect(menu.groups?.mode).toBe(GROUP_MODES[3]?.id);
    expect(menu.groups?.modes).toHaveLength(GROUP_MODES.length);
    menu.groups?.setMode('genre');
    expect(groups.setMode).toHaveBeenCalledWith(GUID, 4);
    menu.groups?.setMode('no-such-mode');
    expect(groups.setMode).toHaveBeenCalledTimes(1);
    menu.groups?.setEnabled(false);
    expect(groups.setEnabled).toHaveBeenCalledWith(false);
    menu.groups?.collapseAll();
    menu.groups?.expandAll();
    expect(groups.collapseAll).toHaveBeenCalledWith(GUID);
    expect(groups.expandAll).toHaveBeenCalledWith(GUID);
  });

  it('分组关着、或游程还没到时，全部折叠与展开置灰', () => {
    expect(setup().menu.groups?.canCollapse).toBe(true);
    expect(setup({ enabled: false }).menu.groups?.canCollapse).toBe(false);
    expect(setup({ runs: false }).menu.groups?.canCollapse).toBe(false);
  });
});
