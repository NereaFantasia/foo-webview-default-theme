import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { listPrefsAtom, listTrackSortAtom } from './listPrefs.ts';
import { albumSortOptions } from '../albums/albumSortOptions.ts';
import { playStatsAtom } from '../playStats.ts';
import { useService } from '../../kit/useService.ts';
import { albumListKey } from './albumList.ts';
import { SortMenu } from '../../kit/SortMenu.tsx';
import { TrackSortMenu } from '../../track/TrackSortMenu.tsx';

// 列表形态页头的排序：有专辑分组时是专辑的三组字段、随机与方向；不按专辑分组时是曲目的列与方向，
// 与列头排序同一份

/** 专辑列表的排序偏好独立保存，字段与封面墙共用 */
export function ListSortMenu({ labelled }: { readonly labelled: boolean }) {
  const t = useAtomValueRawSync(translateAtom);
  const { sort, albumGroups } = useAtomValueRawSync(listPrefsAtom);
  const trackSort = useAtomValueRawSync(listTrackSortAtom);
  const { available } = useAtomValueRawSync(playStatsAtom);
  const albumList = useService(albumListKey);
  if (!albumGroups)
    return (
      <TrackSortMenu
        buttonAttributes={{ 'data-album-tool': 'sort' }}
        sort={trackSort}
        playcount={available}
        labelled={labelled}
        onSort={(next) => {
          if (next) albumList.prefs.setTrackSort(next);
        }}
      />
    );
  return (
    <SortMenu
      buttonAttributes={{ 'data-album-tool': 'sort' }}
      tool={{ labelled }}
      groups={albumSortOptions(t, available)}
      field={sort.field}
      descending={sort.descending}
      onField={albumList.prefs.setField}
      onDescending={albumList.prefs.setDescending}
      shuffle={{
        value: 'random',
        label: t('albumList.random'),
        run: () => albumList.prefs.setField('random'),
      }}
    />
  );
}
