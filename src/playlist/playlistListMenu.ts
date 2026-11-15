import type { MessageKey } from '../i18n/en.ts';
import type { PlaylistGroupsService, PlaylistGroupsState } from './groups/playlistGroups.ts';
import type { GroupsPrefs } from './groups/playlistGroupsPrefs.ts';
import type { PlaylistTrackActions } from './playlistTrackActions.ts';
import { GROUP_MODES, type GroupModeId } from './sortPatterns.ts';

/** 一档分组依据 */
export interface ListMenuChoice {
  readonly id: string;
  readonly label: MessageKey;
}

/** 随机与反向：重排宿主列表本身。按字段排序只在列头，这里没有 */
export interface ListMenuReorder {
  readonly disabled?: boolean;
  shuffle(): void;
  reverse(): void;
}

/** 分组：开关、依据与全部折叠、全部展开 */
export interface ListMenuGroups {
  readonly enabled: boolean;
  /** 当前依据的 id，在 `modes` 里 */
  readonly mode: string;
  readonly modes: readonly ListMenuChoice[];
  /** 此刻有组可折叠、展开；分组关着或游程还没取到时为假，那两项置灰 */
  readonly canCollapse: boolean;
  setEnabled(enabled: boolean): void;
  setMode(id: string): void;
  collapseAll(): void;
  expandAll(): void;
}

/** 播放列表页的重排（页头「⋯」里）与分组（视图面板里）两段，各自只画自己那一段 */
export interface ListMenu {
  readonly reorder?: ListMenuReorder;
  readonly groups?: ListMenuGroups;
}

const GROUP_LABELS: Record<GroupModeId, MessageKey> = {
  albumSimple: 'playlistPage.groupAlbumSimple',
  albumArtistAlbumDisc: 'playlistPage.groupAlbumArtistAlbumDisc',
  albumArtist: 'playlistPage.groupAlbumArtist',
  artist: 'playlistPage.groupArtist',
  genre: 'playlistPage.groupGenre',
  directory: 'playlistPage.groupDirectory',
};

const GROUP_MENU: readonly ListMenuChoice[] = GROUP_MODES.map((mode) => ({
  id: mode.id,
  label: GROUP_LABELS[mode.id],
}));

export interface PlaylistListMenuDeps {
  readonly guid: string;
  readonly prefs: GroupsPrefs;
  readonly groupsState: PlaylistGroupsState;
  readonly groups: Pick<
    PlaylistGroupsService,
    'setEnabled' | 'setMode' | 'collapseAll' | 'expandAll'
  >;
  readonly tracks: Pick<PlaylistTrackActions, 'shuffle' | 'reverse'>;
  /** 列表锁着（自动播放列表也算）：宿主不重排 */
  readonly locked?: boolean;
  /** 宿主办成了随机或反向：列头的排序记号不再对应任何一列 */
  readonly onReordered: () => void;
}

/**
 * 播放列表页的重排（页头「⋯」里）与分组（视图面板里）两段：随机、反向，分组开关、六档依据与全部折叠、展开
 * 重排改的是宿主列表本身，锁定的列表宿主不排
 */
export function playlistListMenu(deps: PlaylistListMenuDeps): ListMenu {
  const { guid, prefs, groups, tracks } = deps;
  const settle = (done: Promise<boolean>) =>
    void done.then((ok) => {
      if (ok) deps.onReordered();
    });
  return {
    reorder: {
      disabled: deps.locked,
      shuffle: () => {
        if (!deps.locked) settle(tracks.shuffle(guid));
      },
      reverse: () => {
        if (!deps.locked) settle(tracks.reverse(guid));
      },
    },
    groups: {
      enabled: prefs.enabled,
      mode: GROUP_MODES[prefs.mode]?.id ?? '',
      modes: GROUP_MENU,
      canCollapse: prefs.enabled && deps.groupsState.runs.length > 0,
      setEnabled: (enabled) => groups.setEnabled(enabled),
      setMode(id) {
        const mode = GROUP_MODES.findIndex((candidate) => candidate.id === id);
        if (mode >= 0) void groups.setMode(guid, mode);
      },
      collapseAll: () => groups.collapseAll(guid),
      expandAll: () => groups.expandAll(guid),
    },
  };
}
