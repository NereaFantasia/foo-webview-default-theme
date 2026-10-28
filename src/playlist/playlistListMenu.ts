import type { MessageKey } from '../i18n/en.ts';
import type { PlaylistGroupsService, PlaylistGroupsState } from './groups/playlistGroups.ts';
import type { GroupsPrefs } from './groups/playlistGroupsPrefs.ts';
import type { PlaylistTrackActions } from './playlistTrackActions.ts';
import { GROUP_MODES, SORT_CHOICES, type GroupModeId, type SortChoiceId } from './sortPatterns.ts';

/** 一档排序依据或分组依据 */
export interface ListMenuChoice {
  readonly id: string;
  readonly label: MessageKey;
}

/** 排序：点一档就按它排一次。列表不记着当前按哪一档排，菜单里也不标 */
export interface ListMenuSort {
  readonly choices: readonly ListMenuChoice[];
  readonly disabled?: boolean;
  pick(id: string, descending?: boolean): void;
  /** 打乱、反转；不给就不画 */
  readonly shuffle?: () => void;
  readonly reverse?: () => void;
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

/** 播放列表的列表排序与分组：排序在命令行的「⋯」里，分组在视图面板里，各自只画自己那一段 */
export interface ListMenu {
  readonly sort?: ListMenuSort;
  readonly groups?: ListMenuGroups;
}

const SORT_LABELS: Record<SortChoiceId, MessageKey> = {
  albumArtist: 'playlistPage.sortAlbumArtist',
  artist: 'playlistPage.sortArtist',
  album: 'playlistPage.sortAlbum',
  trackNumber: 'playlistPage.sortTrackNumber',
  title: 'playlistPage.sortTitle',
  path: 'playlistPage.sortPath',
  date: 'playlistPage.sortDate',
  genre: 'playlistPage.sortGenre',
  rating: 'playlistPage.sortRating',
  bitrate: 'playlistPage.sortBitrate',
  modified: 'playlistPage.sortModified',
  playCount: 'playlistPage.sortPlayCount',
  codec: 'playlistPage.sortCodec',
  duration: 'table.duration',
  sampleRate: 'table.sampleRate',
  channels: 'table.channels',
  fileSize: 'table.fileSize',
  added: 'table.added',
  lastPlayed: 'table.lastPlayed',
};

const GROUP_LABELS: Record<GroupModeId, MessageKey> = {
  albumSimple: 'playlistPage.groupAlbumSimple',
  albumArtistAlbumDisc: 'playlistPage.groupAlbumArtistAlbumDisc',
  albumArtist: 'playlistPage.groupAlbumArtist',
  artist: 'playlistPage.groupArtist',
  genre: 'playlistPage.groupGenre',
  directory: 'playlistPage.groupDirectory',
};

const SORT_MENU: readonly ListMenuChoice[] = SORT_CHOICES.map((choice) => ({
  id: choice.id,
  label: SORT_LABELS[choice.id],
}));

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
  readonly tracks: Pick<PlaylistTrackActions, 'sort' | 'shuffle' | 'reverse'>;
  /** 按菜单里的一档排过了：列头的排序记号不再对应任何一列 */
  readonly locked?: boolean;
  readonly onSorted: (pattern?: string, descending?: boolean) => void;
}

/**
 * 播放列表页的列表排序（页头「⋯」里）与分组（视图面板里）两段：排序字段与方向加随机、反向，分组开关、六档依据与全部折叠、展开
 * 排序改的是宿主列表本身，锁定的列表宿主不排
 */
export function playlistListMenu(deps: PlaylistListMenuDeps): ListMenu {
  const { guid, prefs, groups, tracks } = deps;
  const settle = (done: Promise<boolean>, pattern?: string, descending?: boolean) =>
    void done.then((ok) => {
      if (ok) deps.onSorted(pattern, descending);
    });
  return {
    sort: {
      choices: SORT_MENU,
      disabled: deps.locked,
      pick(id, descending = false) {
        if (deps.locked) return;
        const choice = SORT_CHOICES.find((candidate) => candidate.id === id);
        if (choice)
          settle(tracks.sort(guid, choice.pattern, descending), choice.pattern, descending);
      },
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
