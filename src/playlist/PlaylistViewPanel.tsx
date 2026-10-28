import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import { ViewGrouping, ViewPanel, ViewPanelActions } from '../kit/ViewPanel.tsx';
import type { ListMenuGroups } from './playlistListMenu.ts';
import { ColumnsPicker } from '../table/columns/ColumnsPicker.tsx';
import type { ColumnsModel } from '../table/columns/columnsModel.ts';

/** 分组下拉里「不分组」一项的值；分组依据的 id 里没有它 */
const NO_GROUPS = 'none';

export interface PlaylistViewPanelProps {
  /** 分组的模型；列表不支持分组时不给 */
  readonly groups?: ListMenuGroups;
  readonly columns: ColumnsModel;
  readonly labelled: boolean;
}

/** 播放列表页的视图面板：分组依据（含「不分组」）与全部展开、折叠，以及列 */
export function PlaylistViewPanel({ groups, columns, labelled }: PlaylistViewPanelProps) {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <ViewPanel labelled={labelled} buttonAttributes={{ 'data-playlist-view': '' }}>
      {groups && (
        <ViewGrouping
          label={t('table.groupBy')}
          value={groups.enabled ? groups.mode : NO_GROUPS}
          options={[
            { value: NO_GROUPS, label: t('query.noGroups') },
            ...groups.modes.map((mode) => ({ value: mode.id, label: t(mode.label) })),
          ]}
          onChange={(id) => {
            if (id === NO_GROUPS) {
              groups.setEnabled(false);
              return;
            }
            if (!groups.enabled) groups.setEnabled(true);
            if (id !== groups.mode) groups.setMode(id);
          }}
          fold={{
            disabled: !groups.canCollapse,
            expand: () => groups.expandAll(),
            collapse: () => groups.collapseAll(),
          }}
        />
      )}
      <ViewPanelActions>
        <ColumnsPicker columns={columns} />
      </ViewPanelActions>
    </ViewPanel>
  );
}
