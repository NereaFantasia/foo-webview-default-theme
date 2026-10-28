import { Menu } from '../../motion/Surfaces.tsx';
import {
  Button,
  MenuItemRadio,
  MenuList,
  MenuTrigger,
  Tooltip,
  makeStyles,
  mergeClasses,
  type MenuProps,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useState, type MouseEvent } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { MenuSurface } from '../../kit/HostMenuList.tsx';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { playbackOrderAtom } from '../playback.ts';
import { isOrderName, ORDER_IDS, ORDER_LABEL_KEYS } from '../playbackOrder.ts';
import { ORDER_KEY_ICONS, ORDER_MENU_ICONS } from '../playerIcons.ts';
import type { OrderName } from '../playbackOrder.ts';
import type { FluentIcon } from '@fluentui/react-icons';
import { useService } from '../../kit/useService.ts';
import { playbackKey } from '../playbackContract.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

const GROUP = 'order';

const useStyles = makeStyles({
  surface: { boxSizing: 'border-box', width: '230px' },
});

export interface OrderMenuButtonProps {
  readonly className: string;
  readonly disabled: boolean;
  /** 使用 20px 图标，缺省为 16px */
  readonly large?: boolean;
  /** 键上的图标表；不给就按 `large` 取 20 或 16 的那两套，菜单项的图标不受它影响 */
  readonly keyIcons?: Readonly<Record<OrderName, FluentIcon>>;
  /** 写在键上的属性，宿主用它找键、交接焦点 */
  readonly keyAttributes?: Readonly<Record<string, string>>;
  /** 写在菜单浮层上的属性，宿主用它认出这是哪个键的浮层 */
  readonly surfaceAttributes?: Readonly<Record<string, string>>;
}

/**
 * 播放顺序键：图标跟着当前顺序，单击或右键都弹出七选一的菜单，当前项用勾选标明
 * 选了只发命令，选中项与键上的图标等宿主回读了新顺序才动；还没读到顺序时按缺省画、菜单里没有选中项
 */
export function OrderMenuButton({
  className,
  disabled,
  large = false,
  keyIcons,
  keyAttributes,
  surfaceAttributes,
}: OrderMenuButtonProps) {
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const current = useAtomValueRawSync(playbackOrderAtom);
  const playback = useService(playbackKey);
  const classes = useStyles();
  const [open, setOpen] = useState(false);
  const shown = current ?? 'default';
  const Icon = (keyIcons ?? (large ? ORDER_MENU_ICONS : ORDER_KEY_ICONS))[shown];

  const onCheckedValueChange: MenuProps['onCheckedValueChange'] = (_, data) => {
    const picked = data.checkedItems[0];
    if (isOrderName(picked) && picked !== current) void playback.setOrder(picked);
  };
  // 右键与单击一样开在键下面，不跟着指针
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
            className={mergeClasses(className, viewControls.icon)}
            icon={<Icon />}
            disabled={disabled}
            {...keyAttributes}
            onContextMenu={onContextMenu}
          />
        </Tooltip>
      </MenuTrigger>
      <MenuSurface className={classes.surface} {...surfaceAttributes}>
        <MenuList aria-label={t('player.orderMenu')}>
          {ORDER_IDS.map((id) => {
            const ItemIcon = ORDER_MENU_ICONS[id];
            return (
              <MenuItemRadio key={id} name={GROUP} value={id} icon={<ItemIcon />}>
                {t(ORDER_LABEL_KEYS[id])}
              </MenuItemRadio>
            );
          })}
        </MenuList>
      </MenuSurface>
    </Menu>
  );
}
