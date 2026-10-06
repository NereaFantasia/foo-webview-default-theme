import { mergeClasses, NavItem, Tooltip } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import type { MouseEvent, PointerEvent, ReactElement, ReactNode } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import styles from './SidebarItem.module.css';
import { useSidebarItemStyles } from './useSidebarItemStyles.ts';

/** `data-*` 属性照常可以传，原样落到这一项的按钮上。 */
export interface SidebarItemProps {
  /** 选中键：`Nav` 按它认选中项，竖条按它找自己。 */
  readonly value: string;
  readonly icon: ReactElement;
  readonly label: string;
  readonly selected: boolean;
  /** 页面还没上线时为假：置灰，悬停提示「即将推出」，点了不报。缺省为真。 */
  readonly ready?: boolean;
  /** 压暗但照样能点，锁定的列表用。 */
  readonly muted?: boolean;
  /** 图标态：只画图标，名字放进悬停提示，也当这一项的无障碍名。 */
  readonly compact?: boolean;
  /** 图标右上角的小圆点：这一项底下有东西，比如队列不空、有列表在播。 */
  readonly dot?: boolean;
  /** 行尾的东西，播放列表是曲目数。 */
  readonly end?: ReactNode;
  readonly className?: string;
  readonly title?: string;
  /** 单击或回车；`event.detail` 是连击的第几下，键盘触发时为 0。 */
  onSelect(event: MouseEvent<HTMLElement>): void;
  onPointerDown?(event: PointerEvent<HTMLElement>): void;
  onMouseDown?(event: MouseEvent<HTMLElement>): void;
  onContextMenu?(event: MouseEvent<HTMLElement>): void;
}

/**
 * 侧边栏的一个导航项：Fluent `NavItem` 换上侧边栏的外观。点击只往上报，去哪由调用方定；
 * 选中与否由调用方按当前地点给，`Nav` 自己不改选中。图标态与展开态是同一个件，选中的浅底与竖条相同。
 */
export function SidebarItem({
  value,
  icon,
  label,
  selected,
  ready = true,
  muted = false,
  compact = false,
  dot = false,
  end,
  onSelect,
  className,
  ...rest
}: SidebarItemProps) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useSidebarItemStyles();
  const item = (
    <NavItem
      {...rest}
      value={value}
      icon={{
        children: (
          <>
            {icon}
            {dot && <span className={styles.dot} data-sidebar-dot aria-hidden />}
          </>
        ),
        className: classes.icon,
      }}
      aria-disabled={ready ? undefined : true}
      className={mergeClasses(
        classes.item,
        selected && classes.selected,
        !ready && classes.soon,
        muted && classes.muted,
        compact && classes.compact,
        className,
      )}
      onClick={(event) => {
        // 不交给 Nav 改选中：选中跟着历史的当前地点走。
        event.preventDefault();
        if (ready) onSelect(event);
      }}
    >
      <span
        className={selected ? `${styles.indicator} ${styles.shown}` : styles.indicator}
        data-nav-indicator={value}
        aria-hidden
      />
      {!compact && <span className={styles.label}>{label}</span>}
      {!compact && end !== undefined && <span className={styles.end}>{end}</span>}
    </NavItem>
  );
  if (compact) {
    return (
      <Tooltip
        content={ready ? label : t('sidebar.comingSoonItem', { name: label })}
        relationship="label"
        positioning="after"
      >
        {item}
      </Tooltip>
    );
  }
  return ready ? (
    item
  ) : (
    <Tooltip content={t('sidebar.comingSoon')} relationship="description">
      {item}
    </Tooltip>
  );
}
