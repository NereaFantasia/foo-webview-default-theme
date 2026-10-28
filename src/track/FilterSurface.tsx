import {
  Button,
  CounterBadge,
  ToggleButton,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  ChevronUp20Regular,
  Dismiss20Regular,
  Options20Regular,
  PanelTopExpand20Regular,
  PictureInPictureEnter20Regular,
  ReOrderDotsVertical16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { useCommandButtonStyles } from '../kit/CommandBar.tsx';
import { SurfacePresence } from '../motion/SurfacePresence.tsx';
import { useLightDismiss } from '../nav/useLightDismiss.ts';
import { PanelBackgroundContext } from '../theme/PopoverSurface.tsx';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import styles from './FilterSurface.module.css';

/** 浮层与视口边缘及筛选触发按钮之间的间距（像素） */
const GAP = 8;
/** 栏头拖动位移死区阈值（像素）：避免单击栏头误触发浮动面板拖拽 */
const DRAG_SLOP = 4;

const useToggleStyles = makeStyles({
  root: { position: 'relative', minWidth: '32px', width: '32px', height: '32px', padding: 0 },
  badge: { position: 'absolute', top: 0, right: 0, pointerEvents: 'none' },
  text: { display: 'inline-flex', alignItems: 'center', columnGap: tokens.spacingHorizontalXS },
});

export interface FilterSurfaceOptions {
  /** 是否启用页面内嵌入布局；窄屏档位下强制回退为浮层 */
  readonly docked: boolean;
  /** 嵌入面板的展开状态 */
  readonly expanded: boolean;
  readonly narrow: boolean;
  onDock(docked: boolean): void;
  onExpand(expanded: boolean): void;
}

export interface FilterSurfaceState {
  readonly docked: boolean;
  /** 综合开合状态：浮层模式下对应气泡展开，嵌入模式下对应面板展开 */
  readonly open: boolean;
  readonly narrow: boolean;
  readonly anchor: RefObject<HTMLButtonElement | null>;
  setOpen(open: boolean): void;
  dock(docked: boolean): void;
}

/**
 * 管理筛选面板的呈现模式与开合状态
 * 嵌入模式与展开偏好由页面级状态持久化；浮层模式的即时开合仅在内存中维护，不持久化亦不写入历史
 * 切换为浮层模式时自动触发弹出，保障交互连贯
 */
export function useFilterSurface(options: FilterSurfaceOptions): FilterSurfaceState {
  const [popover, setPopover] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const docked = options.docked && !options.narrow;
  return {
    docked,
    open: docked ? options.expanded : popover,
    narrow: options.narrow,
    anchor,
    setOpen(open) {
      if (docked) options.onExpand(open);
      else setPopover(open);
    },
    dock(next) {
      options.onDock(next);
      if (next) options.onExpand(true);
      setPopover(!next);
    },
  };
}

export interface FilterToggleProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'type'
> {
  readonly open: boolean;
  /** 当前生效的筛选条件数量（显示于角标） */
  readonly count: number;
  /** 宽屏档位显示文本标签并紧随角标；窄屏档位退化为 32×32 图标并将角标压于右上角 */
  readonly labelled: boolean;
  readonly ref?: Ref<HTMLButtonElement>;
}

/** 筛选触发按钮的外观呈现：按下态指示展开，角标反映条件数；透传属性支持无缝接入 Popover 触发槽位 */
export function FilterToggle({ open, count, labelled, ...rest }: FilterToggleProps) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const command = useCommandButtonStyles();
  const classes = useToggleStyles();
  const label = count > 0 ? t('query.filterPanelCount', { count }) : t('query.filterPanel');
  const badge = count > 0 && (
    <CounterBadge
      className={labelled ? undefined : classes.badge}
      count={count}
      size="small"
      color="brand"
    />
  );
  return (
    <Tooltip content={label} relationship="label">
      <ToggleButton
        {...rest}
        appearance="subtle"
        className={mergeClasses(controls.icon, labelled ? command.labelled : classes.root)}
        checked={open}
        aria-expanded={open}
        icon={
          <>
            <Options20Regular />
            {!labelled && badge}
          </>
        }
        data-filter-toggle
      >
        {labelled ? (
          <span className={classes.text}>
            {t('query.filterPanel')}
            {badge}
          </span>
        ) : undefined}
      </ToggleButton>
    </Tooltip>
  );
}

/** 挂载筛选外壳状态与开合动作的筛选按钮 */
export function FilterButton({
  state,
  count,
  labelled,
}: {
  readonly state: FilterSurfaceState;
  readonly count: number;
  readonly labelled: boolean;
}) {
  return (
    <FilterToggle
      ref={state.anchor}
      open={state.open}
      count={count}
      labelled={labelled}
      onClick={() => state.setOpen(!state.open)}
    />
  );
}

export interface FilterSurfaceProps {
  /** 浮层 Esc 快捷键作用域标识，各页面独立配置 */
  readonly id: string;
  readonly state: FilterSurfaceState;
  /** 分面栏内容（由调用页面插槽提供） */
  readonly children: ReactNode;
  /** 浮层底栏（条件添加、结果统计与重置操作）；嵌入模式由条件栏承担，故底栏隐藏 */
  readonly footer?: ReactNode;
  /** 控制浮层是否提供「嵌入页面」操作入口（宿主页面无嵌入区域时置 false） */
  readonly dockable?: boolean;
}

interface Point {
  readonly left: number;
  readonly top: number;
}

/** 将浮层坐标限制在定位父级的可视矩形范围内并保持边距；父级滚动时按内容坐标系及当前滚动偏移换算 */
function clampWithin(node: HTMLElement | null, point: Point): Point {
  const parent = node?.offsetParent;
  if (!node || !(parent instanceof HTMLElement)) return point;
  const left = parent.scrollLeft + GAP;
  const top = parent.scrollTop + GAP;
  const right = parent.scrollLeft + parent.clientWidth - node.offsetWidth - GAP;
  const bottom = parent.scrollTop + parent.clientHeight - node.offsetHeight - GAP;
  return {
    left: Math.max(left, Math.min(point.left, right)),
    top: Math.max(top, Math.min(point.top, bottom)),
  };
}

/**
 * 筛选面板外壳组件
 * 嵌入模式下就地渲染于命令行下方；浮层模式下渲染为定位覆盖层，默认对齐筛选按钮右侧边缘
 * 支持通过栏头拖拽转为浮动面板：在外部点击不再触发轻量失焦关闭，视口缩放时自动推回可视区域；关闭后重置位置
 */
export function FilterSurface({
  id,
  state,
  children,
  footer,
  dockable = true,
}: FilterSurfaceProps) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const background = useContext(PanelBackgroundContext);
  const { open, docked, narrow, anchor } = state;
  const panel = useRef<HTMLDivElement>(null);
  const [anchored, setAnchored] = useState<Point>({ left: GAP, top: 0 });
  const [floating, setFloating] = useState<Point | null>(null);
  const drag = useRef<{ x: number; y: number; from: Point } | null>(null);

  const close = (focusAnchor: boolean) => {
    state.setOpen(false);
    if (focusAnchor) anchor.current?.focus();
  };
  const markInside = useLightDismiss({
    id: `${id}.filter.dismiss`,
    open: open && !docked,
    panel,
    escapeFromInput: true,
    exempt: (target) => anchor.current?.contains(target) ?? false,
    held: () => floating !== null,
    onDismiss: close,
  });

  useLayoutEffect(() => {
    const node = panel.current;
    const parent = node?.offsetParent;
    if (!open || docked || !node || !(parent instanceof HTMLElement)) return;
    const measure = () => {
      const target = anchor.current?.getBoundingClientRect();
      if (!target) return;
      const box = parent.getBoundingClientRect();
      const x = parent.scrollLeft - box.left;
      const right = parent.scrollLeft + parent.clientWidth - node.offsetWidth - GAP;
      setAnchored({
        left: narrow
          ? parent.scrollLeft + GAP
          : Math.max(parent.scrollLeft + GAP, Math.min(target.right + x - node.offsetWidth, right)),
        top: target.bottom - box.top + parent.scrollTop + GAP / 2,
      });
      setFloating((point) => point && clampWithin(node, point));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [open, docked, narrow, anchor]);

  useEffect(() => {
    if (open && !docked) panel.current?.focus({ preventScroll: true });
  }, [open, docked]);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (narrow || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('button')) return;
    drag.current = { x: event.clientX, y: event.clientY, from: floating ?? anchored };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!floating && Math.hypot(dx, dy) < DRAG_SLOP) return;
    setFloating(
      clampWithin(panel.current, { left: start.from.left + dx, top: start.from.top + dy }),
    );
  };
  const endDrag = () => {
    drag.current = null;
  };

  const label = t('query.filterPanel');
  if (docked) {
    if (!open) return null;
    return (
      <section className={styles.docked} aria-label={label} data-filter-surface="docked">
        <div className={styles.head}>
          <span className={styles.title}>{label}</span>
          <div className={styles.ops}>
            <Tooltip content={t('query.filterUndock')} relationship="label">
              <Button
                appearance="subtle"
                size="small"
                className={controls.icon}
                icon={<PictureInPictureEnter20Regular />}
                onClick={() => state.dock(false)}
                data-filter-undock
              />
            </Tooltip>
            <Tooltip content={t('query.filterCollapse')} relationship="label">
              <Button
                appearance="subtle"
                size="small"
                className={controls.icon}
                icon={<ChevronUp20Regular />}
                onClick={() => state.setOpen(false)}
                data-filter-collapse
              />
            </Tooltip>
          </div>
        </div>
        {children}
      </section>
    );
  }

  const at = floating ?? anchored;
  return (
    <SurfacePresence kind="flyout" visible={open} appear unmountOnExit>
      <div
        ref={panel}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        className={styles.flyout}
        style={{
          left: at.left,
          top: at.top,
          right: narrow ? GAP : undefined,
          ...(background ? { '--bg-panel-overlay': background } : {}),
        }}
        data-filter-surface={floating ? 'floating' : 'popover'}
        data-narrow={narrow || undefined}
        onPointerDownCapture={markInside}
      >
        <div
          className={styles.head}
          data-filter-handle
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={(event) => {
            if (narrow || (event.target instanceof Element && event.target.closest('button')))
              return;
            setFloating(null);
          }}
        >
          <span className={styles.title}>
            {!narrow && <ReOrderDotsVertical16Regular className={styles.grip} />}
            {label}
          </span>
          <div className={styles.ops}>
            {!narrow && dockable && (
              <Tooltip content={t('query.filterDock')} relationship="label">
                <Button
                  appearance="subtle"
                  size="small"
                  className={controls.icon}
                  icon={<PanelTopExpand20Regular />}
                  onClick={() => state.dock(true)}
                  data-filter-dock
                />
              </Tooltip>
            )}
            <Tooltip content={t('query.filterClose')} relationship="label">
              <Button
                appearance="subtle"
                size="small"
                className={controls.icon}
                icon={<Dismiss20Regular />}
                onClick={() => close(true)}
                data-filter-close
              />
            </Tooltip>
          </div>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </SurfacePresence>
  );
}
