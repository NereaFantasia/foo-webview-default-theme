import {
  MenuButton,
  MenuItemRadio,
  MenuList,
  MenuTrigger,
  ToggleButton,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  ScrollMenu as Menu,
  ScrollMenuPopover as MenuPopover,
} from '../../kit/ScrollMenuPopover.tsx';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { MAX_INLINE_ARTISTS } from '../../track/TrackCredits.tsx';
import type { BiographyTranslate } from './BiographyPanel.tsx';

const useStyles = makeStyles({
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalXS,
    minWidth: 0,
    marginBottom: tokens.spacingVerticalM,
  },
  chip: {
    minWidth: 0,
    maxWidth: '100%',
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStrokeAlpha}`,
  },
  // 按钮根节点是弹性容器，省略号要落在里面的文字上
  label: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

/**
 * 一首曲目有多位艺人时，选看哪一位的简介：不超过 `MAX_INLINE_ARTISTS` 位直接排开，再多收成一个单选菜单，
 * 界线与曲目署名一致。只有一位或没有时不出
 */
export function BiographyArtistSwitch({
  artists,
  selected,
  onSelect,
  t,
}: {
  readonly artists: readonly string[];
  readonly selected: string | null;
  onSelect(name: string): void;
  readonly t: BiographyTranslate;
}) {
  const controls = useViewControlStyles();
  const styles = useStyles();
  if (artists.length < 2) return null;
  if (artists.length > MAX_INLINE_ARTISTS)
    return (
      <div className={styles.row} data-biography-artists>
        <Menu
          surfaceMotion={MENU_SURFACE_MOTION}
          checkedValues={{ artist: selected ? [selected] : [] }}
          onCheckedValueChange={(_, data) => {
            const name = data.checkedItems[0];
            if (name) onSelect(name);
          }}
        >
          <MenuTrigger disableButtonEnhancement>
            <MenuButton
              size="small"
              appearance="subtle"
              className={mergeClasses(controls.icon, styles.chip)}
            >
              <span className={styles.label}>{selected}</span>
            </MenuButton>
          </MenuTrigger>
          <MenuPopover>
            <MenuList aria-label={t('biography.artists')}>
              {artists.map((name) => (
                <MenuItemRadio key={name} name="artist" value={name} data-biography-artist={name}>
                  {name}
                </MenuItemRadio>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>
    );
  return (
    <div
      className={styles.row}
      role="group"
      aria-label={t('biography.artists')}
      data-biography-artists
    >
      {artists.map((name) => (
        <ToggleButton
          key={name}
          size="small"
          appearance="subtle"
          className={mergeClasses(controls.icon, styles.chip)}
          checked={name === selected}
          onClick={() => onSelect(name)}
          data-biography-artist={name}
        >
          <span className={styles.label}>{name}</span>
        </ToggleButton>
      ))}
    </div>
  );
}
