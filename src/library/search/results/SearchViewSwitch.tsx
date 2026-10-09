import { Toolbar, ToolbarRadioButton, Tooltip } from '@fluentui/react-components';
import { Apps20Regular, TextBulletList20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../../i18n/locale.ts';
import type { SearchView } from './searchView.ts';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';

export function SearchViewSwitch({
  view,
  onChange,
}: {
  readonly view: SearchView;
  onChange(view: SearchView): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  return (
    <Toolbar
      aria-label={t('search.view')}
      checkedValues={{ view: [view] }}
      onCheckedValueChange={(_, data) => {
        const next = data.checkedItems[0];
        if ((next === 'grid' || next === 'list') && next !== view) onChange(next);
      }}
    >
      <Tooltip content={t('search.list')} relationship="label">
        <ToolbarRadioButton
          appearance="subtle"
          className={controls.icon}
          name="view"
          value="list"
          icon={<TextBulletList20Regular />}
          aria-label={t('search.list')}
        />
      </Tooltip>
      <Tooltip content={t('search.grid')} relationship="label">
        <ToolbarRadioButton
          appearance="subtle"
          className={controls.icon}
          name="view"
          value="grid"
          icon={<Apps20Regular />}
          aria-label={t('search.grid')}
        />
      </Tooltip>
    </Toolbar>
  );
}
