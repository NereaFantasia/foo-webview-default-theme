import {
  mergeClasses,
  TableHeader,
  TableHeaderCell,
  TableResizeHandle,
  TableRow,
  useArrowNavigationGroup,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { useCommand } from '../nav/useCommand.ts';
import { focusColumn } from './columns/columnCells.ts';
import { ColumnGhost } from './columns/ColumnGhost.tsx';
import { ColumnMenu } from './columns/ColumnMenu.tsx';
import type { ColumnMenuExtras } from './columns/ColumnMenuExtras.tsx';
import { columnDef, type ColumnId } from './columns/columns.ts';
import { resizePartner } from './columns/columnsLayout.ts';
import type { ColumnsModel } from './columns/columnsModel.ts';
import type { TablePoint } from './tableItems.ts';
import styles from './TrackTableHeader.module.css';
import { useColumnReorder } from './columns/useColumnReorder.ts';
import { useColumnResize } from './columns/useColumnResize.ts';
import { useTrackTableStyles } from './useTrackTableStyles.ts';

/** 列头上显示的排序：哪一列、哪个方向。 */
export interface TableSort {
  readonly column: ColumnId;
  readonly descending: boolean;
}

export interface TrackTableHeaderProps {
  readonly columns: ColumnsModel;
  /** 表格根元素：换列的让位动效写在它上面，关掉列菜单后焦点无处可回时也回到它。 */
  readonly root: RefObject<HTMLElement | null>;
  readonly sort?: TableSort | null;
  /** 单击能排序的列头；不给时列头不能点着排序。 */
  readonly onSort?: (column: ColumnId) => void;
  /** 行跟着页面滚：列头吸在页面滚动元素的顶上。 */
  readonly sticky?: boolean;
  /** 列头菜单里列勾选之外的几段。 */
  readonly menu?: ColumnMenuExtras;
}

/** 拖动途中不接的键。 */
const MOVE_KEYS = new Set(['Enter', ' ', 'ArrowLeft', 'ArrowRight']);

/**
 * 表格的列头：Fluent 的 `TableHeaderCell`，分隔条是 `TableResizeHandle`。单击排序（带 Shift、Ctrl 的单击
 * 是行的多选手势，扩选时手滑点到列头上不当排序）；拖列头换列；拖分隔条改宽；右键、Shift+F10 或 Menu 键开
 * 列的勾选菜单。整条列头在 Tab 次序里只占一站，左右键在各列之间移焦点，Alt+← → 与相邻列换位。拖动中按
 * Esc 取消，登记在手势层。
 */
export function TrackTableHeader(props: TrackTableHeaderProps) {
  const { columns, root, sort, onSort, sticky } = props;
  const classes = useTrackTableStyles();
  const t = useAtomValueRawSync(translateAtom);
  const layout = useAtomValueRawSync(columns.layout);
  const header = useRef<HTMLDivElement>(null);
  const reorder = useColumnReorder(columns, root, header);
  const resize = useColumnResize(columns, header);
  const arrows = useArrowNavigationGroup({ axis: 'horizontal', memorizeCurrent: true });
  const [menuAt, setMenuAt] = useState<TablePoint | null>(null);
  const refocus = useRef<ColumnId | null>(null);
  const id = useId();

  useCommand({
    id: `table.columnGesture.${id}`,
    layer: 'gesture',
    keys: [{ key: 'Escape' }],
    enabled: () => reorder.active() || resize.active(),
    run: () => {
      reorder.cancel();
      resize.cancel();
    },
  });

  // 键盘换位后列头格在 DOM 里挪了位置，焦点会丢；换完把焦点还给挪动的那一格。
  useLayoutEffect(() => {
    const column = refocus.current;
    refocus.current = null;
    if (column) focusColumn(header.current, column);
  }, [layout]);

  const menuAtCell = (cell: HTMLElement) => {
    const box = cell.getBoundingClientRect();
    setMenuAt({ x: box.left, y: box.bottom });
  };

  function onKeyDown(event: KeyboardEvent<HTMLElement>, column: ColumnId): void {
    const arrow = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (event.altKey && arrow !== 0 && !event.ctrlKey && !event.shiftKey) {
      // 拦下缺省：命令登记处看到就不再当成后退、前进。
      event.preventDefault();
      if (columns.moveAdjacent(column, arrow)) refocus.current = column;
      return;
    }
    if (event.key === 'F10' && event.shiftKey) {
      event.preventDefault();
      menuAtCell(event.currentTarget);
    }
  }

  const gesturing = (event: KeyboardEvent<HTMLElement>) =>
    (reorder.active() || resize.active()) && MOVE_KEYS.has(event.key);
  // 拖列头或拖分隔条的途中按下的回车、空格与左右键不当排序或换位，在列头格上按下时就拦住。
  const blockDuringGesture = (event: KeyboardEvent<HTMLElement>) => {
    if (!gesturing(event)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  function sortClick(event: MouseEvent, column: ColumnId): void {
    const modified = event.shiftKey || event.ctrlKey || event.metaKey;
    if (!reorder.swallowClick(event) && !modified) onSort?.(column);
  }

  return (
    <>
      <TableHeader
        className={mergeClasses(classes.header, sticky && classes.stickyHeader)}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuAt({ x: event.clientX, y: event.clientY });
        }}
      >
        <TableRow ref={header} className={classes.headerRow} aria-rowindex={1} {...arrows}>
          {layout.header.map((column) => {
            const def = columnDef(column);
            const sortable = onSort !== undefined && def.sortable;
            const dragging = reorder.dragging === column;
            return (
              <TableHeaderCell
                key={column}
                data-column-id={column}
                data-dragging={dragging || undefined}
                className={mergeClasses(classes.headerCell, dragging && classes.headerDragging)}
                sortable={sortable}
                sortDirection={
                  sort?.column === column
                    ? sort.descending
                      ? 'descending'
                      : 'ascending'
                    : undefined
                }
                aria-label={t(def.label)}
                // 能排序时拿焦点的是排序按钮，否则是列头格自己（封面列不拿焦点）：焦点总落在有名字的元素上。
                tabIndex={sortable || column === 'cover' ? undefined : 0}
                button={{
                  className: def.numeric ? classes.numericHeader : undefined,
                  'aria-label': sortable ? t(def.label) : undefined,
                  // 排序按钮在空格松开时才点；Fluent 的列头格不转交 keyup 的捕获监听，只能在按钮上拦下缺省。
                  onKeyUp: (event: KeyboardEvent<HTMLElement>) => {
                    if (gesturing(event)) event.preventDefault();
                  },
                  onClick: sortable
                    ? (event: MouseEvent<HTMLElement>) => sortClick(event, column)
                    : undefined,
                }}
                onPointerDown={(event) => reorder.onPointerDown(event, column)}
                onKeyDownCapture={blockDuringGesture}
                onKeyDown={(event) => onKeyDown(event, column)}
                onKeyUp={(event) => {
                  if (event.key !== 'ContextMenu') return;
                  event.preventDefault();
                  menuAtCell(event.currentTarget);
                }}
                aside={
                  resizePartner(layout, column) ? (
                    <TableResizeHandle
                      className={classes.handle}
                      data-dragging={resize.resizing === column || undefined}
                      onPointerDown={(event) => resize.onPointerDown(event, column)}
                    />
                  ) : undefined
                }
              >
                {def.heading ? <span className={styles.label}>{t(def.heading)}</span> : null}
              </TableHeaderCell>
            );
          })}
        </TableRow>
      </TableHeader>
      <ColumnMenu
        at={menuAt}
        columns={columns}
        extras={props.menu}
        root={root}
        onClose={() => setMenuAt(null)}
      />
      <ColumnGhost ghost={reorder.ghost} />
    </>
  );
}
