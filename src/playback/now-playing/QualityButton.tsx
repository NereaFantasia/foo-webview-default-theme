import {
  Badge,
  Button,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuTrigger,
  Spinner,
  Tooltip,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
  type MenuProps,
} from '@fluentui/react-components';
import { Bookmark20Regular, ChevronDown12Regular } from '@fluentui/react-icons';
import type { Track } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { MenuSurface } from '../../kit/HostMenuList.tsx';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { Menu } from '../../motion/Surfaces.tsx';
import { MUSIC_QUALITIES } from '../../server/musicObjects.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { roleVar } from '../../theme/roles.ts';
import { useQualityMenu } from './qualityMenu.ts';

const GROUP = 'quality';

// 与本地曲目的格式标记同一个框：高 16、细边、10 号半粗字；切换途中边与字换强调色
const useStyles = makeStyles({
  badge: {
    flex: 'none',
    minWidth: 0,
    height: '16px',
    columnGap: tokens.spacingHorizontalXXS,
    padding: `0 ${tokens.spacingHorizontalXXS} 0 ${tokens.spacingHorizontalXS}`,
    ...shorthands.border(tokens.strokeWidthThin, 'solid', roleVar('line')),
    borderRadius: tokens.borderRadiusMedium,
    color: roleVar('text-secondary'),
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: '14px',
  },
  switching: {
    '&, &:hover, &:active, &:hover:active': {
      ...shorthands.borderColor(tokens.colorBrandStroke1),
      color: tokens.colorBrandForeground1,
    },
  },
  // 沉浸视图里曲名大，标记也放大一档：高 20、左右内边距 6、字 11
  large: {
    height: '20px',
    padding: `0 ${tokens.spacingHorizontalXXS} 0 ${tokens.spacingHorizontalSNudge}`,
    fontSize: '11px',
    lineHeight: '18px',
  },
  icon: {
    width: '12px',
    height: '12px',
    fontSize: '12px',
    marginLeft: 0,
  },
  // Fluent 最小的转圈是 16，放不进 16 高的框，缩到与箭头同为 12
  spinner: { width: '12px', height: '12px' },
  surface: { boxSizing: 'border-box', width: '280px' },
  preferred: { marginLeft: tokens.spacingHorizontalS },
});

export interface QualityButtonProps {
  /** 这一行此刻写的曲目；不是在线曲目时不出 */
  readonly track: Track | null;
  /** `large` 给沉浸视图里的大字，缺省与播放栏同一档 */
  readonly size?: 'default' | 'large';
  /** 写在标记按钮上的属性，宿主用它找键、交接焦点 */
  readonly keyAttributes?: Readonly<Record<string, string>>;
  /** 写在音质菜单浮层上的属性，宿主用它认出这是哪个键的浮层 */
  readonly surfaceAttributes?: Readonly<Record<string, string>>;
}

/**
 * 在线曲目的音质标记：写实际取到的档位（还没读出时写请求的，补全的写「补全」），点开是音质菜单，
 * 选另一档就从当前位置换成那一档接着播。切换途中标记写目标档位、换强调色，箭头换成转圈
 */
export function QualityButton({
  track,
  size = 'default',
  keyAttributes,
  surfaceAttributes,
}: QualityButtonProps) {
  const t = useAtomValueRawSync(translateAtom);
  const menu = useQualityMenu(track);
  const viewControls = useViewControlStyles();
  const classes = useStyles();
  const [open, setOpen] = useState(false);
  if (!menu) return null;

  const onCheckedValueChange: MenuProps['onCheckedValueChange'] = (_, data) => {
    const picked = MUSIC_QUALITIES.find((quality) => quality === data.checkedItems[0]);
    if (picked) menu.pick(picked);
  };
  const button = (
    <Button
      appearance="subtle"
      className={mergeClasses(
        viewControls.icon,
        classes.badge,
        size === 'large' && classes.large,
        menu.switching && classes.switching,
      )}
      icon={{
        children: menu.switching ? (
          <Spinner size="extra-tiny" spinner={{ className: classes.spinner }} />
        ) : (
          <ChevronDown12Regular />
        ),
        className: classes.icon,
      }}
      iconPosition="after"
      aria-label={t('online.qualityButton', { quality: menu.badge })}
      data-quality-badge
      data-switching={menu.switching || undefined}
      {...keyAttributes}
    >
      {menu.badge}
    </Button>
  );
  return (
    <Menu
      open={open}
      onOpenChange={(_, data) => setOpen(data.open)}
      checkedValues={{ [GROUP]: [menu.requested] }}
      onCheckedValueChange={onCheckedValueChange}
      surfaceMotion={MENU_SURFACE_MOTION}
    >
      <MenuTrigger disableButtonEnhancement>
        {menu.unblocked ? (
          <Tooltip content={t('online.unblockedPlaying')} relationship="description">
            {button}
          </Tooltip>
        ) : (
          button
        )}
      </MenuTrigger>
      <MenuSurface className={classes.surface} {...surfaceAttributes}>
        <MenuList aria-label={t('online.quality')}>
          <MenuGroup>
            <MenuGroupHeader>{t('online.quality')}</MenuGroupHeader>
            {menu.choices.map((choice) => (
              <MenuItemRadio
                key={choice.quality}
                name={GROUP}
                value={choice.quality}
                disabled={choice.disabled}
                secondaryContent={choice.detail}
                data-quality={choice.quality}
              >
                {choice.name}
                {choice.preferred && (
                  <Badge
                    size="small"
                    appearance="outline"
                    color="informative"
                    className={classes.preferred}
                  >
                    {t('online.qualityDefault')}
                  </Badge>
                )}
              </MenuItemRadio>
            ))}
          </MenuGroup>
          <MenuDivider />
          <MenuItem
            icon={<Bookmark20Regular />}
            disabled={menu.isDefault}
            onClick={menu.setDefault}
          >
            {t('online.setDefaultQuality')}
          </MenuItem>
        </MenuList>
      </MenuSurface>
    </Menu>
  );
}
