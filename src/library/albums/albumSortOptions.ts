import type { MessageKey } from '../../i18n/en.ts';
import type { Translate } from '../../i18n/translate.ts';
import type { SortGroup } from '../../kit/SortMenu.tsx';
import { isStatsField, LIST_SORT_GROUPS, type ListSortField } from '../album-list/listSort.ts';

export const ALBUM_SORT_LABELS: Readonly<Record<ListSortField, MessageKey>> = {
  albumArtist: 'albumList.fieldAlbumArtist',
  name: 'albumList.fieldName',
  year: 'albumList.fieldYear',
  genre: 'albumList.fieldGenre',
  trackCount: 'albumList.fieldTrackCount',
  duration: 'albumList.fieldDuration',
  folder: 'albumList.fieldFolder',
  codec: 'albumList.fieldCodec',
  bitrate: 'albumList.fieldBitrate',
  sampleRate: 'albumList.fieldSampleRate',
  fileSize: 'albumList.fieldFileSize',
  added: 'albumList.fieldAdded',
  lastPlayed: 'albumList.fieldLastPlayed',
  firstPlayed: 'albumList.fieldFirstPlayed',
  playCount: 'albumList.fieldPlayCount',
  rating: 'albumList.fieldRating',
  random: 'albumList.random',
};

const GROUPS = [
  { title: 'albumList.groupAlbum', fields: LIST_SORT_GROUPS.album },
  { title: 'albumList.groupFile', fields: LIST_SORT_GROUPS.file },
  { title: 'albumList.groupStats', fields: LIST_SORT_GROUPS.stats },
] as const;

export function albumSortOptions(
  t: Translate,
  playcount: boolean | null,
): SortGroup<ListSortField>[] {
  return GROUPS.map((group) => ({
    label: `${t(group.title)}${group.title === 'albumList.groupStats' && playcount === false ? ` · ${t('albumList.statsMissing')}` : ''}`,
    options: group.fields.map((field) => ({
      value: field,
      label: t(ALBUM_SORT_LABELS[field]),
      disabled: isStatsField(field) && playcount === false,
    })),
  }));
}
