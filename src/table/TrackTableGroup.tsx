import type { MouseEvent, ReactNode } from 'react';
import type { TableGroupItem } from './tableItems.ts';
import styles from './TrackTableGroup.module.css';
import type { GroupHandlers } from './useTrackTableInput.ts';

export interface TrackTableGroupProps<G> {
  readonly id: string;
  readonly index: number;
  /** 读屏的行号，见 `ariaRowsOf`。 */
  readonly rowIndex: number;
  readonly item: TableGroupItem<G>;
  /** 在行带里的纵坐标与高，CSS 像素。 */
  readonly top: number;
  readonly height: number;
  /** 调用方接了开合才报展开态：读屏不该念一个按不动的开关。 */
  readonly expandable: boolean;
  /** 列头一共几列：分组头的内容是横跨全部列的一格。 */
  readonly columns: number;
  readonly focused: boolean;
  readonly handlers: GroupHandlers;
  /** 调用方画的内容。 */
  readonly children?: ReactNode;
}

const CONTROLS = 'a[href], button, input, select, textarea, [role="button"], [role="link"]';

/** 这一下是不是点在调用方画的控件（按钮、链接、输入框）上：那是控件自己的事，不算点分组头。 */
function onControl(event: MouseEvent<HTMLElement>): boolean {
  const control = event.target instanceof Element ? event.target.closest(CONTROLS) : null;
  return (
    control !== null && control !== event.currentTarget && event.currentTarget.contains(control)
  );
}

/**
 * 条目流里的一个分组头：横跨整行，不让开封面列。表格管它的位置、焦点与指针手势，里面画什么归调用方。
 * 单击与双击落在调用方画的控件上时不当成点分组头：双击专辑名链接不会把整张播起来，点开合键也不会顺带选中。
 */
export function TrackTableGroup<G>(props: TrackTableGroupProps<G>) {
  const { index, item, handlers, expandable } = props;
  return (
    <div
      id={props.id}
      data-table-item-key={item.key}
      role="row"
      className={styles.group}
      style={{ transform: `translateY(${props.top}px)`, height: props.height }}
      aria-rowindex={props.rowIndex}
      aria-level={item.level + 1}
      aria-expanded={expandable ? !item.collapsed : undefined}
      data-row-focus={props.focused || undefined}
      onClick={(event) => {
        if (!onControl(event)) handlers.click(index, event);
      }}
      onDoubleClick={(event) => {
        if (!onControl(event)) handlers.play(index);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        handlers.menu(index, { x: event.clientX, y: event.clientY });
      }}
    >
      <div role="gridcell" aria-colspan={props.columns} className={styles.cell}>
        {props.children}
      </div>
    </div>
  );
}
