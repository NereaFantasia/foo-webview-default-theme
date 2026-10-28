import {
  Input,
  MenuButton,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItemRadio,
  MenuList,
  MenuTrigger,
  Tooltip,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components';
import { ArrowSortDownLines20Regular, Filter16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../../i18n/locale.ts';
import {
  ScrollMenu as Menu,
  ScrollMenuPopover as MenuPopover,
} from '../../../kit/ScrollMenuPopover.tsx';
import { SegmentedTabs } from '../../../kit/SegmentedTabs.tsx';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import { useArtists } from '../artistsContext.ts';
import styles from './ArtistListTools.module.css';

const useStyles = makeStyles({ input: { minWidth: 0, flex: 1 } });

export interface ArtistListToolsProps {
  readonly text: string;
  readonly tidy: boolean;
  onText(value: string): void;
  onTidy(value: boolean): void;
}

export function ArtistListTools({ text, tidy, onText, onTidy }: ArtistListToolsProps) {
  const services = useArtists();
  const t = useAtomValueRawSync(translateAtom);
  const prefs = useAtomValueRawSync(services.prefs.state);
  const catalog = useAtomValueRawSync(services.catalog.state);
  const controls = useViewControlStyles();
  const classes = useStyles();
  return (
    <div className={styles.root}>
      <div className={styles.filter}>
        <Input
          className={mergeClasses(classes.input, controls.field)}
          contentBefore={<Filter16Regular />}
          value={text}
          aria-label={t('artists.filter')}
          placeholder={t('artists.filter')}
          onChange={(_, data) => onText(data.value)}
        />
        <Menu
          checkedValues={{
            basis: [prefs.basis],
            sort: [prefs.sort],
            direction: [prefs.descending ? 'descending' : 'ascending'],
          }}
        >
          <MenuTrigger disableButtonEnhancement>
            <Tooltip
              content={t('query.sortValue', { value: t(`artists.${prefs.sort}`) })}
              relationship="description"
            >
              <MenuButton
                appearance="subtle"
                className={controls.icon}
                aria-label={t('artists.sort')}
                icon={<ArrowSortDownLines20Regular />}
              >
                {t(`artists.${prefs.sort}`)}
              </MenuButton>
            </Tooltip>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {(['name', 'albums', 'tracks'] as const).map((sort) => (
                <MenuItemRadio
                  key={sort}
                  name="sort"
                  value={sort}
                  onClick={() =>
                    services.prefs.update(
                      sort === prefs.sort ? { sort } : { sort, descending: sort !== 'name' },
                    )
                  }
                >
                  {t(`artists.${sort}`)}
                </MenuItemRadio>
              ))}
              <MenuDivider />
              {(['ascending', 'descending'] as const).map((direction) => (
                <MenuItemRadio
                  key={direction}
                  name="direction"
                  value={direction}
                  onClick={() => services.prefs.update({ descending: direction === 'descending' })}
                >
                  {t(`query.${direction}`)}
                </MenuItemRadio>
              ))}
              <MenuDivider />
              <MenuGroup>
                <MenuGroupHeader>{t('artists.basis')}</MenuGroupHeader>
                {(['albumArtist', 'credited'] as const).map((basis) => (
                  <MenuItemRadio
                    key={basis}
                    name="basis"
                    value={basis}
                    onClick={() => services.prefs.update({ basis })}
                  >
                    {t(`artists.${basis}`)}
                  </MenuItemRadio>
                ))}
              </MenuGroup>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>
      <SegmentedTabs
        label={t('artists.title')}
        value={tidy ? 'tidy' : 'all'}
        options={[
          { value: 'all', label: t('artists.all', { count: catalog.rows.length }) },
          { value: 'tidy', label: t('artists.tidy', { count: catalog.issues.size }) },
        ]}
        onChange={(value) => onTidy(value === 'tidy')}
      />
    </div>
  );
}
