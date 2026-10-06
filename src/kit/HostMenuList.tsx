import {
  MenuDivider,
  MenuItem,
  MenuItemCheckbox,
  MenuList,
  MenuPopover,
  MenuTrigger,
  type MenuPopoverProps,
  type MenuProps,
} from '@fluentui/react-components';
import { Menu } from '../motion/Surfaces.tsx';
import type { ReactNode } from 'react';
import styles from './HostMenuList.module.css';
import {
  addressOf,
  isChecked,
  isEnabled,
  keyOf,
  labelOf,
  visibleNodes,
  type MenuNode,
} from '../host/menuNodes.ts';

export interface HostMenuListProps {
  readonly nodes: readonly MenuNode[] | undefined;
  readonly onRun: (node: MenuNode) => void;
  /**
   * 这条命令能不能执行，不能的置灰（宿主标了不可用的也置灰）。主菜单的命令按 GUID 执行，所以不传时
   * 有 GUID 的才能执行；右键菜单的命令按生成那棵树时的编号执行，要传自己的判据。
   */
  readonly runnable?: (node: MenuNode) => boolean;
  /** 接在宿主的项后面的主题自己的项。 */
  readonly children?: ReactNode;
}

const hasAddress = (node: MenuNode) => addressOf(node) !== null;

/**
 * 退出标题栏拖动区的菜单弹出层。弹出层挂在 body 下、不在标题栏里，但盖在标题栏上的那一截照样落在
 * 拖动区里，按下会拖动窗口；从标题栏打开的菜单每一层都用它。
 */
export function MenuSurface({ className, ...props }: MenuPopoverProps) {
  return (
    <MenuPopover
      {...props}
      className={className ? `${styles.surface} ${className}` : styles.surface}
    />
  );
}

/** 勾选只照宿主说的呈现，页面这一侧不改：点了发命令，勾不勾等下一次重读。 */
const CHECK_GROUP = 'checked';
const IGNORE_CHECK_CHANGE = () => {};

/**
 * 一层节点的勾选状态，交给这一层的 `Menu`：Fluent 要求勾选相关的属性放在 Menu 上，放在 MenuList 上会告警。
 */
export function menuCheckProps(
  nodes: readonly MenuNode[] | undefined,
): Pick<MenuProps, 'checkedValues' | 'hasCheckmarks' | 'onCheckedValueChange'> {
  const checked = visibleNodes(nodes).flatMap((node, index) =>
    node.type === 'command' && isChecked(node) ? [keyOf(node, index)] : [],
  );
  return {
    checkedValues: { [CHECK_GROUP]: checked },
    hasCheckmarks: checked.length > 0,
    onCheckedValueChange: IGNORE_CHECK_CHANGE,
  };
}

/**
 * 把一层宿主菜单节点画成 Fluent 的菜单：子菜单递归，勾选的命令画成勾选项，其余是普通项。
 * 执行不了的命令置灰。所在的 `Menu` 要带上 `menuCheckProps(nodes)`。
 */
export function HostMenuList({ nodes, onRun, runnable = hasAddress, children }: HostMenuListProps) {
  return (
    <MenuList>
      {visibleNodes(nodes).map((node, index) => {
        const key = keyOf(node, index);
        if (node.type === 'separator') return <MenuDivider key={key} />;
        if (node.type === 'submenu') {
          return (
            <Menu key={key} {...menuCheckProps(node.children)}>
              <MenuTrigger disableButtonEnhancement>
                <MenuItem>{labelOf(node)}</MenuItem>
              </MenuTrigger>
              <MenuSurface>
                <HostMenuList nodes={node.children} onRun={onRun} runnable={runnable} />
              </MenuSurface>
            </Menu>
          );
        }
        const disabled = !isEnabled(node) || !runnable(node);
        const run = () => onRun(node);
        return isChecked(node) ? (
          <MenuItemCheckbox
            key={key}
            name={CHECK_GROUP}
            value={key}
            disabled={disabled}
            persistOnClick={false}
            onClick={run}
          >
            {labelOf(node)}
          </MenuItemCheckbox>
        ) : (
          <MenuItem key={key} disabled={disabled} onClick={run}>
            {labelOf(node)}
          </MenuItem>
        );
      })}
      {children}
    </MenuList>
  );
}
