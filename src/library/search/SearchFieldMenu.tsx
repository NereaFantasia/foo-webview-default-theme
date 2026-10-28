import {
  MenuButton,
  MenuDivider,
  MenuItemRadio,
  MenuList,
  MenuTrigger,
  Tooltip,
  mergeClasses,
} from '@fluentui/react-components';
import { Search20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { Fragment } from 'react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { useCommandButtonStyles } from '../../kit/CommandBar.tsx';
import {
  ScrollMenu as Menu,
  ScrollMenuPopover as MenuPopover,
} from '../../kit/ScrollMenuPopover.tsx';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import type { SearchScope } from './searchQuery.ts';

const LABELS: Readonly<Record<SearchScope, MessageKey>> = {
  any: 'search.scopeAny',
  title: 'query.scopeTitle',
  artist: 'query.scopeArtist',
  albumArtist: 'query.scopeAlbumArtist',
  album: 'query.scopeAlbum',
  genre: 'query.scopeGenre',
  date: 'query.scopeDate',
  filename: 'query.scopeFilename',
  comment: 'query.scopeComment',
};

/** 检索字段单选菜单：宽屏展示当前字段标签，紧凑档位仅保留图标并由气泡提示当前生效范围 */
export function SearchFieldMenu<S extends SearchScope>({
  scope,
  scopes,
  labelled,
  onScope,
}: {
  readonly scope: S;
  readonly scopes: readonly S[];
  readonly labelled: boolean;
  onScope(scope: S): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const buttons = useCommandButtonStyles();
  const value = t(LABELS[scope]);
  const name = `${t('query.scope')}: ${value}`;
  return (
    <Menu
      surfaceMotion={MENU_SURFACE_MOTION}
      checkedValues={{ scope: [scope] }}
      onCheckedValueChange={(_, data) => {
        const next = scopes.find((one) => data.checkedItems.includes(one));
        if (next) onScope(next);
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={name} relationship="label">
          <MenuButton
            appearance="subtle"
            className={mergeClasses(controls.icon, labelled && buttons.labelled)}
            icon={<Search20Regular />}
            aria-label={name}
            data-search-scope={scope}
          >
            {labelled ? value : undefined}
          </MenuButton>
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList aria-label={t('query.scope')}>
          {scopes.map((one) => (
            <Fragment key={one}>
              {one === 'filename' && <MenuDivider />}
              <MenuItemRadio name="scope" value={one}>
                {t(LABELS[one])}
              </MenuItemRadio>
            </Fragment>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
