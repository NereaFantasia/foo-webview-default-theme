import type { MessageKey } from '../i18n/en.ts';
import type { ColumnMenuChoice, ColumnMenuExtras } from '../table/columns/ColumnMenuExtras.tsx';
import type { PlaylistGroupsService, PlaylistGroupsState } from './groups/playlistGroups.ts';
import type { GroupsPrefs } from './groups/playlistGroupsPrefs.ts';
import type { PlaylistTrackActions } from './playlistTrackActions.ts';
import { GROUP_MODES, SORT_CHOICES, type GroupModeId, type SortChoiceId } from './sortPatterns.ts';

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
};

const GROUP_LABELS: Record<GroupModeId, MessageKey> = {
  albumSimple: 'playlistPage.groupAlbumSimple',
  albumArtistAlbumDisc: 'playlistPage.groupAlbumArtistAlbumDisc',
  albumArtist: 'playlistPage.groupAlbumArtist',
  artist: 'playlistPage.groupArtist',
  genre: 'playlistPage.groupGenre',
  directory: 'playlistPage.groupDirectory',
};

const SORT_MENU: readonly ColumnMenuChoice[] = SORT_CHOICES.map((choice) => ({
  id: choice.id,
  label: SORT_LABELS[choice.id],
}));

const GROUP_MENU: readonly ColumnMenuChoice[] = GROUP_MODES.map((mode) => ({
  id: mode.id,
  label: GROUP_LABELS[mode.id],
}));

export interface PlaylistColumnMenuDeps {
  readonly guid: string;
  readonly prefs: GroupsPrefs;
  readonly groupsState: PlaylistGroupsState;
  readonly groups: Pick<
    PlaylistGroupsService,
    'setEnabled' | 'setMode' | 'collapseAll' | 'expandAll'
  >;
  readonly tracks: Pick<PlaylistTrackActions, 'sort' | 'shuffle' | 'reverse'>;
  /** 按菜单里的一档排过了：列头的排序记号不再对应任何一列。 */
  readonly onSorted: () => void;
}

/**
 * 播放列表页列头菜单的排序与分组两段：排序十三档加随机、反向，分组开关、六档依据与全部折叠、展开。
 * 排序改的是宿主列表本身，锁定的列表宿主不排。
 */
export function playlistColumnMenu(deps: PlaylistColumnMenuDeps): ColumnMenuExtras {
  const { guid, prefs, groups, tracks } = deps;
  const settle = (done: Promise<boolean>) =>
    void done.then((ok) => {
      if (ok) deps.onSorted();
    });
  return {
    sort: {
      choices: SORT_MENU,
      pick(id) {
        const choice = SORT_CHOICES.find((candidate) => candidate.id === id);
        if (choice) settle(tracks.sort(guid, choice.pattern, false));
      },
      shuffle: () => settle(tracks.shuffle(guid)),
      reverse: () => settle(tracks.reverse(guid)),
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
