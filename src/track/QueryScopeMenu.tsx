import {
  Menu,
  MenuButton,
  MenuDivider,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tooltip,
  makeStyles,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { Fragment } from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import { MENU_SURFACE_MOTION } from '../motion/MenuMotion.tsx';
import { QUERY_SCOPES, type QueryScope } from './trackQuery.ts';
import styles from './QueryScopeMenu.module.css';

const SCOPE_LABELS: Readonly<Record<QueryScope, MessageKey>> = {
  all: 'query.scopeAll',
  title: 'query.scopeTitle',
  artist: 'query.scopeArtist',
  albumArtist: 'query.scopeAlbumArtist',
  album: 'query.scopeAlbum',
  genre: 'query.scopeGenre',
  date: 'query.scopeDate',
  filename: 'query.scopeFilename',
  comment: 'query.scopeComment',
};

const useStyles = makeStyles({
  control: { flexShrink: 0, minWidth: '24px', whiteSpace: 'nowrap' },
});

export function QueryScopeMenu(props: {
  readonly scope: QueryScope;
  readonly onScope: (scope: QueryScope) => void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  return (
    <Menu
      surfaceMotion={MENU_SURFACE_MOTION}
      checkedValues={{ scope: [props.scope] }}
      onCheckedValueChange={(_, data) => {
        const next = QUERY_SCOPES.find((value) => data.checkedItems.includes(value));
        if (next) props.onScope(next);
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <Tooltip
          content={`${t('query.scope')}: ${t(SCOPE_LABELS[props.scope])}`}
          relationship="label"
        >
          <MenuButton
            className={classes.control}
            size="small"
            appearance="subtle"
            aria-label={`${t('query.scope')}: ${t(SCOPE_LABELS[props.scope])}`}
            data-query-scope
          >
            <span className={styles.label}>{t(SCOPE_LABELS[props.scope])}</span>
          </MenuButton>
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList aria-label={t('query.scope')}>
          {QUERY_SCOPES.map((value) => (
            <Fragment key={value}>
              {value === 'filename' && <MenuDivider />}
              <MenuItemRadio name="scope" value={value}>
                {t(SCOPE_LABELS[value])}
              </MenuItemRadio>
            </Fragment>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
