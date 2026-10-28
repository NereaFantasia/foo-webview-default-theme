import { ArrowReset20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { SegmentedTabs } from '../../kit/SegmentedTabs.tsx';
import { useService } from '../../kit/useService.ts';
import {
  DENSITY_ICONS,
  ViewPanel,
  ViewPanelActions,
  ViewPanelButton,
  ViewSection,
} from '../../kit/ViewPanel.tsx';
import { ColumnsPicker } from '../../table/columns/ColumnsPicker.tsx';
import { songsPrefsAtom, SONGS_DENSITIES, type SongsDensity } from './songsPrefs.ts';
import { songsKey } from './songsServices.ts';
import type { SongsPageModel } from './useSongsPage.ts';

const DENSITY_LABELS: Readonly<Record<SongsDensity, MessageKey>> = {
  compact: 'songs.densityCompact',
  standard: 'songs.densityStandard',
  comfortable: 'songs.densityComfortable',
};

/** 歌曲页只有列表形态：视图面板里是行密度、列，以及恢复默认的列与排序 */
export function SongsViewPanel({
  model,
  labelled,
}: {
  readonly model: SongsPageModel;
  readonly labelled: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const prefs = useAtomValueRawSync(songsPrefsAtom);
  const songs = useService(songsKey);
  const { columns } = model;
  return (
    <ViewPanel labelled={labelled} buttonAttributes={{ 'data-songs-view': '' }}>
      <ViewSection label={t('songs.density')}>
        <SegmentedTabs
          label={t('songs.density')}
          value={prefs.density}
          options={SONGS_DENSITIES.map((density) => ({
            value: density,
            label: t(DENSITY_LABELS[density]),
            icon: DENSITY_ICONS[density],
          }))}
          onChange={songs.prefs.setDensity}
        />
      </ViewSection>
      <ViewPanelActions>
        <ColumnsPicker columns={columns} />
        <ViewPanelButton
          icon={<ArrowReset20Regular />}
          data-action="reset"
          onClick={() => {
            columns.reset();
            songs.prefs.resetSort();
          }}
        >
          {t('songs.resetView')}
        </ViewPanelButton>
      </ViewPanelActions>
    </ViewPanel>
  );
}
