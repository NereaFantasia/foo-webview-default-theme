import {
  MenuButton,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from '@fluentui/react-components';
import { Menu } from '../../motion/Surfaces.tsx';
import { ArrowSortDown16Regular, ArrowSortUp16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { browserPrefsAtom } from '../albums/browserPrefs.ts';
import { listPrefsAtom } from './listPrefs.ts';
import { LIST_SORT_GROUPS, type ListSortField } from './listSort.ts';
import { playStatsAtom } from '../playStats.ts';
import { useService } from '../../kit/useService.ts';
import { albumListKey } from './albumList.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

// 列表形态页头的排序：三组字段、随机与方向。

export const LIST_SORT_LABELS: Readonly<Record<ListSortField, MessageKey>> = {
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

function pick<T extends string>(values: readonly T[], checked: readonly string[]): T | undefined {
  return values.find((value) => checked.includes(value));
}

/**
 * 排序：专辑、文件、播放统计三组外加随机，另选方向。没装 foo_playcount 时播放统计一组置灰，组头写明原因；
 * 按流派分节时流派一项置灰。「随机」每点一次重洗，已经是随机也照洗。
 */
export function ListSortMenu() {
  const controls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const { dimension } = useAtomValueRawSync(browserPrefsAtom);
  const { sort } = useAtomValueRawSync(listPrefsAtom);
  const { available } = useAtomValueRawSync(playStatsAtom);
  const albumList = useService(albumListKey);
  const random = sort.field === 'random';
  const direction = sort.descending ? 'descending' : 'ascending';
  const Arrow = sort.descending ? ArrowSortDown16Regular : ArrowSortUp16Regular;
  return (
    <Menu
      checkedValues={{ field: [sort.field], direction: random ? [] : [direction] }}
      onCheckedValueChange={(_, data) => {
        if (data.name === 'direction') {
          albumList.prefs.setDescending(data.checkedItems.includes('descending'));
          return;
        }
        const fields = GROUPS.flatMap((group) => group.fields);
        const next = pick(fields, data.checkedItems);
        if (next) albumList.prefs.setField(next);
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <MenuButton
          className={controls.field}
          data-album-tool="sort"
          icon={random ? undefined : <Arrow />}
          appearance="subtle"
        >
          {t('album.sortValue', { value: t(LIST_SORT_LABELS[sort.field]) })}
        </MenuButton>
      </MenuTrigger>
      <MenuPopover>
        <MenuList aria-label={t('album.sort')}>
          {GROUPS.map((group, at) => {
            const stats = group.title === 'albumList.groupStats';
            const locked = stats && available === false;
            return (
              <MenuGroup key={group.title}>
                {at > 0 && <MenuDivider />}
                <MenuGroupHeader>
                  {t(group.title)}
                  {locked ? ` · ${t('albumList.statsMissing')}` : ''}
                </MenuGroupHeader>
                {group.fields.map((field: ListSortField) => (
                  <MenuItemRadio
                    key={field}
                    name="field"
                    value={field}
                    disabled={locked || (field === 'genre' && dimension === 'genre')}
                    data-sort-field={field}
                  >
                    {t(LIST_SORT_LABELS[field])}
                  </MenuItemRadio>
                ))}
              </MenuGroup>
            );
          })}
          <MenuDivider />
          <MenuItem data-sort-field="random" onClick={() => albumList.prefs.setField('random')}>
            {t('albumList.random')}
          </MenuItem>
          <MenuDivider />
          <MenuGroup>
            <MenuGroupHeader>{t('albumList.direction')}</MenuGroupHeader>
            <MenuItemRadio name="direction" value="ascending" disabled={random}>
              {t('albumList.ascending')}
            </MenuItemRadio>
            <MenuItemRadio name="direction" value="descending" disabled={random}>
              {t('albumList.descending')}
            </MenuItemRadio>
          </MenuGroup>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
