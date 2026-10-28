import { Slider } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { SegmentedTabs } from '../../kit/SegmentedTabs.tsx';
import { useService } from '../../kit/useService.ts';
import {
  DENSITY_ICONS,
  FORM_ICONS,
  ViewPanel,
  ViewPanelActions,
  ViewSection,
} from '../../kit/ViewPanel.tsx';
import { ColumnsPicker } from '../../table/columns/ColumnsPicker.tsx';
import type { FoldersView } from './detail/useFoldersView.ts';
import { foldersKey } from './foldersServices.ts';

const DENSITIES = ['compact', 'standard', 'comfortable'] as const;

/** 文件夹的视图面板：版式；列表时是行密度与列，封面时是封面尺寸 */
export function FoldersViewPanel({
  model,
  labelled,
}: {
  readonly model: FoldersView;
  readonly labelled: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const folders = useService(foldersKey);
  const { prefs } = model;
  const covers = prefs.view === 'covers';
  return (
    <ViewPanel
      labelled={labelled}
      form={covers ? 'grid' : 'list'}
      buttonAttributes={{ 'data-folders-view-panel': '' }}
    >
      <ViewSection label={t('folders.view')}>
        <SegmentedTabs
          label={t('folders.view')}
          value={prefs.view}
          options={[
            { value: 'list', label: t('folders.listView'), icon: FORM_ICONS.list },
            { value: 'covers', label: t('folders.coverView'), icon: FORM_ICONS.grid },
          ]}
          onChange={(view) => folders.prefs.change({ view })}
        />
      </ViewSection>
      {covers ? (
        <ViewSection
          label={t('folders.coverSize')}
          value={t('album.tileSizeValue', { size: prefs.size })}
        >
          <Slider
            aria-label={t('folders.coverSize')}
            min={128}
            max={256}
            step={8}
            value={prefs.size}
            onChange={(_, data) => folders.prefs.change({ size: data.value })}
          />
        </ViewSection>
      ) : (
        <>
          <ViewSection label={t('folders.group')}>
            <SegmentedTabs
              label={t('folders.group')}
              value={prefs.grouped ? 'directory' : 'none'}
              options={[
                { value: 'directory', label: t('folders.byDirectory') },
                { value: 'none', label: t('folders.ungrouped') },
              ]}
              onChange={(group) => folders.prefs.change({ grouped: group === 'directory' })}
            />
          </ViewSection>
          <ViewSection label={t('folders.density')}>
            <SegmentedTabs
              label={t('folders.density')}
              value={prefs.density}
              options={DENSITIES.map((density) => ({
                value: density,
                label: t(`folders.${density}`),
                icon: DENSITY_ICONS[density],
              }))}
              onChange={(density) => folders.prefs.change({ density })}
            />
          </ViewSection>
          <ViewPanelActions>
            <ColumnsPicker columns={model.columns} />
          </ViewPanelActions>
        </>
      )}
    </ViewPanel>
  );
}
