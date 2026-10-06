import { describe, expect, it, vi } from 'vitest';
import { playlistColumnMenu } from '../../../src/playlist/playlistColumnMenu.ts';
import { NO_GROUPS } from '../../../src/playlist/groups/playlistGroups.ts';
import { GROUP_MODES, SORT_ALBUM, SORT_CHOICES } from '../../../src/playlist/sortPatterns.ts';

const GUID = '{00000000-0000-0000-0000-000000000001}';
const RUNS = [{ start: 0, count: 3, key: 'A' }];

function setup(options: { enabled?: boolean; mode?: number; runs?: boolean; ok?: boolean } = {}) {
  const ok = options.ok ?? true;
  const tracks = {
    sort: vi.fn(async () => ok),
    shuffle: vi.fn(async () => ok),
    reverse: vi.fn(async () => ok),
  };
  const groups = {
    setEnabled: vi.fn(),
    setMode: vi.fn(async () => {}),
    collapseAll: vi.fn(),
    expandAll: vi.fn(),
  };
  const onSorted = vi.fn();
  const menu = playlistColumnMenu({
    guid: GUID,
    prefs: { enabled: options.enabled ?? true, mode: options.mode ?? 1 },
    groupsState: { ...NO_GROUPS, runs: options.runs === false ? [] : RUNS },
    groups,
    tracks,
    onSorted,
  });
  return { menu, tracks, groups, onSorted };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('playlistColumnMenu', () => {
  it('排序段列十三档，次序与排序串照 SORT_CHOICES；点一档按它排这张列表、正向', async () => {
    const { menu, tracks, onSorted } = setup();
    expect(menu.sort?.choices.map((choice) => choice.id)).toStrictEqual(
      SORT_CHOICES.map((choice) => choice.id),
    );
    menu.sort?.pick('album');
    await flush();
    expect(tracks.sort).toHaveBeenCalledWith(GUID, SORT_ALBUM, false);
    expect(onSorted).toHaveBeenCalledTimes(1);
    menu.sort?.pick('no-such-choice');
    expect(tracks.sort).toHaveBeenCalledTimes(1);
  });

  it('随机与反向交给曲目命令；宿主没排成时不收列头的排序记号', async () => {
    const { menu, tracks, onSorted } = setup({ ok: false });
    menu.sort?.shuffle?.();
    menu.sort?.reverse?.();
    await flush();
    expect(tracks.shuffle).toHaveBeenCalledWith(GUID);
    expect(tracks.reverse).toHaveBeenCalledWith(GUID);
    expect(onSorted).not.toHaveBeenCalled();
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
