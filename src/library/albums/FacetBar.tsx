import {
  Button,
  MenuButton,
  MenuItem,
  MenuItemCheckbox,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tag,
  TagGroup,
  makeStyles,
} from '@fluentui/react-components';
import { Menu } from '../../motion/Surfaces.tsx';
import { useAtomValueRawSync } from 'jotai/react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import type { Translate } from '../../i18n/translate.ts';
import { albumBrowseAtom, facetOptionsAtom } from './albumBrowse.ts';
import styles from './FacetBar.module.css';
import { FACET_FIELDS, hasFacetSelection, type FacetField } from './facets.ts';
import { useService } from '../../kit/useService.ts';
import { albumsKey } from '../albumServices.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

const LABELS: Readonly<Record<FacetField, MessageKey>> = {
  genre: 'album.facetGenre',
  decade: 'album.facetDecade',
  albumArtist: 'album.facetAlbumArtist',
};

// 一列最多两百项，弹出层限高、自己滚动。
const useStyles = makeStyles({
  popover: { maxHeight: '360px', overflowY: 'auto' },
  chips: { flexWrap: 'wrap' },
});

/** 年代的键是 `2010s` 这样的串，显示按语言包写；其余两列照原值。 */
function labelOf(t: Translate, field: FacetField, name: string): string {
  return field === 'decade' ? t('album.decade', { decade: name.slice(0, 4) }) : name;
}

/** 标签组按一个字符串认标签：字段与取值拼在一起，取值里不会有换行。 */
const tagValue = (field: FacetField, name: string) => `${field}\n${name}`;

/**
 * 页头下的筛选条：流派、年代、专辑艺术家三列各一个下拉，列内多选、跨列同时生效；项后的数字是勾上
 * 它能筛出几张。勾中的值在同一行列成可去掉的标签，末尾一键清除。取值都从专辑清单算，不问宿主。
 */
export function FacetBar() {
  const t = useAtomValueRawSync(translateAtom);
  const { facets } = useAtomValueRawSync(albumBrowseAtom);
  const options = useAtomValueRawSync(facetOptionsAtom);
  const albums = useService(albumsKey);
  const classes = useStyles();
  const controls = useViewControlStyles();
  const numbers = new Intl.NumberFormat();
  const chips = FACET_FIELDS.flatMap((field) =>
    [...facets[field]].map((name) => ({ field, name, label: labelOf(t, field, name) })),
  );
  return (
    <div className={styles.root} role="group" aria-label={t('album.facets')} data-facet-bar>
      {FACET_FIELDS.map((field) => (
        <Menu
          key={field}
          checkedValues={{ [field]: [...facets[field]] }}
          onCheckedValueChange={(_, data) => {
            // 一次只会点一项：勾选前后差出来的那一个就是它。
            const before = facets[field];
            const after = new Set(data.checkedItems);
            for (const name of new Set([...before, ...after])) {
              if (before.has(name) !== after.has(name)) albums.browse.toggleFacet(field, name);
            }
          }}
        >
          <MenuTrigger disableButtonEnhancement>
            <MenuButton
              appearance="subtle"
              className={controls.field}
              size="small"
              data-facet={field}
            >
              {facets[field].size > 0
                ? `${t(LABELS[field])} ${facets[field].size}`
                : t(LABELS[field])}
            </MenuButton>
          </MenuTrigger>
          <MenuPopover className={classes.popover}>
            <MenuList aria-label={t(LABELS[field])}>
              {options[field].length === 0 && <MenuItem disabled>{t('album.facetEmpty')}</MenuItem>}
              {options[field].map((value) => (
                <MenuItemCheckbox
                  key={value.name}
                  name={field}
                  value={value.name}
                  secondaryContent={numbers.format(value.albumCount)}
                >
                  {labelOf(t, field, value.name)}
                </MenuItemCheckbox>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      ))}
      {chips.length > 0 && (
        <TagGroup
          className={classes.chips}
          size="small"
          aria-label={t('album.facets')}
          onDismiss={(_, data) => {
            const chip = chips.find((item) => tagValue(item.field, item.name) === data.value);
            if (chip) albums.browse.toggleFacet(chip.field, chip.name);
          }}
        >
          {chips.map((chip) => (
            <Tag
              key={tagValue(chip.field, chip.name)}
              value={tagValue(chip.field, chip.name)}
              appearance="outline"
              className={controls.tag}
              dismissible
              dismissIcon={{ 'aria-label': t('album.facetRemove', { value: chip.label }) }}
            >
              {chip.label}
            </Tag>
          ))}
        </TagGroup>
      )}
      <Button
        size="small"
        appearance="subtle"
        className={controls.icon}
        disabled={!hasFacetSelection(facets)}
        onClick={() => albums.browse.clearFacets()}
      >
        {t('album.facetClear')}
      </Button>
    </div>
  );
}
