import {
  Button,
  Menu,
  MenuItemRadio,
  MenuList,
  MenuTrigger,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
  type MenuProps,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useState, type MouseEvent } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { MenuSurface } from '../../kit/HostMenuList.tsx';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { roleVar } from '../../theme/roles.ts';
import { playbackOrderAtom } from '../../playback/playback.ts';
import { isOrderName, ORDER_IDS, ORDER_LABEL_KEYS } from '../../playback/playbackOrder.ts';
import { PLAYER_KEY_ATTR, PLAYER_SURFACE_ATTR } from './playerFocus.ts';
import { ORDER_KEY_ICONS, ORDER_MENU_ICONS } from './playerIcons.ts';
import { useService } from '../../kit/useService.ts';
import { playbackKey } from '../../playback/playbackContract.ts';

const GROUP = 'order';

// 菜单项宽 220：整只 230 连着两边的内边距 4 与描边 1。行 32、左右 12，图标 16、隔 10，字 13，行与行隔 2。
// 当前项铺选中底、图标取主色，不另画勾；选中与否照样由 menuitemradio 的 aria-checked 告诉读屏。
const useStyles = makeStyles({
  surface: { boxSizing: 'border-box', width: '230px' },
  list: { gap: tokens.spacingVerticalXXS },
  item: {
    minHeight: '32px',
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalM,
    columnGap: tokens.spacingHorizontalMNudge,
    borderRadius: roleVar('radius-control'),
    fontSize: '13px',
  },
  current: { backgroundColor: roleVar('bg-hover') },
  icon: { width: '16px', height: '16px', fontSize: '16px', color: roleVar('text-secondary') },
  currentIcon: { color: roleVar('accent') },
});

export interface OrderMenuButtonProps {
  readonly className: string;
  readonly disabled: boolean;
  /** 底部通栏里的键：图标 20，其余 16。 */
  readonly large?: boolean;
}

/**
 * 播放顺序键：图标跟着当前顺序，单击或右键都弹出七选一的菜单，各项带图标，当前项铺选中底、图标取主色。
 * 选了只发命令，选中项与键上的图标等宿主回读了新顺序才动；还没读到顺序时按缺省画、菜单里没有选中项。
 */
export function OrderMenuButton({ className, disabled, large = false }: OrderMenuButtonProps) {
  const t = useAtomValueRawSync(translateAtom);
  const current = useAtomValueRawSync(playbackOrderAtom);
  const playback = useService(playbackKey);
  const classes = useStyles();
  const [open, setOpen] = useState(false);
  const shown = current ?? 'default';
  const Icon = (large ? ORDER_MENU_ICONS : ORDER_KEY_ICONS)[shown];

  const onCheckedValueChange: MenuProps['onCheckedValueChange'] = (_, data) => {
    const picked = data.checkedItems[0];
    if (isOrderName(picked) && picked !== current) void playback.setOrder(picked);
  };
  // 右键与单击一样开在键下面，不跟着指针。
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    if (!disabled) setOpen(true);
  };

  return (
    <Menu
      open={open}
      onOpenChange={(_, data) => setOpen(data.open)}
      checkedValues={{ [GROUP]: current ? [current] : [] }}
      onCheckedValueChange={onCheckedValueChange}
      surfaceMotion={MENU_SURFACE_MOTION}
    >
      <MenuTrigger disableButtonEnhancement>
        <Tooltip
          content={t('player.order', { order: t(ORDER_LABEL_KEYS[shown]) })}
          relationship="label"
        >
          <Button
            appearance="subtle"
            className={className}
            icon={<Icon />}
            disabled={disabled}
            {...{ [PLAYER_KEY_ATTR]: 'order' }}
            onContextMenu={onContextMenu}
          />
        </Tooltip>
      </MenuTrigger>
      <MenuSurface className={classes.surface} {...{ [PLAYER_SURFACE_ATTR]: 'order' }}>
        <MenuList className={classes.list} aria-label={t('player.orderMenu')}>
          {ORDER_IDS.map((id) => {
            const ItemIcon = ORDER_MENU_ICONS[id];
            const on = id === current;
            return (
              <MenuItemRadio
                key={id}
                name={GROUP}
                value={id}
                className={mergeClasses(classes.item, on && classes.current)}
                icon={{
                  className: mergeClasses(classes.icon, on && classes.currentIcon),
                  children: <ItemIcon />,
                }}
                checkmark={null}
              >
                {t(ORDER_LABEL_KEYS[id])}
              </MenuItemRadio>
            );
          })}
        </MenuList>
      </MenuSurface>
    </Menu>
  );
}
