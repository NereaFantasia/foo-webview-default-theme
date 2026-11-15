import { mergeClasses } from '@fluentui/react-components';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { usePanelSurface } from '../lyrics-column/toolsStyles.ts';
import { PageSwap } from '../scene/PageSwap.tsx';
import styles from './EditCard.module.css';

export interface EditCardProps {
  /** 当前配置分类标识：切换分类时内容执行交叉淡变 */
  readonly id: string;
  /** 卡片停靠侧。窄窗与竖版布局时固定停靠于底部（由响应式样式控制） */
  readonly dock: 'start' | 'end';
  /** 无障碍名称：当前分类名称（卡片不绘制标题，对应编辑工具栏中选中的标签） */
  readonly label: string;
  /** 处于参考线拖拽交互中：隐藏卡片以避让视图 */
  readonly yielded?: boolean;
  /** 退出编辑模式的退场过渡期间为真 */
  readonly leaving?: boolean;
  /** 单行聚焦展示状态变更回调 */
  readonly onHolding?: (holding: boolean) => void;
  readonly children: ReactNode;
}

/** 判定拖拽位移阈值（CSS 像素）：移动超出该距离视为拖拽开始，单击操作不触发卡片避让 */
const DRAG_SLOP = 3;
/** 长按判定延迟（毫秒）：按住滑块达到该时长自动进入拖拽聚焦态 */
const HOLD_MS = 250;

/** 聚焦保留行在卡片内的几何位置，用于渲染独立底板 */
interface Held {
  readonly row: HTMLElement;
  readonly top: number;
  readonly height: number;
}

/**
 * 滑块拖拽聚焦状态管理：指针按下卡片内的滑块，移动超出位移阈值或按住达到 250ms 时进入聚焦态，指针释放或取消时恢复
 *
 * 键盘调节滑块、点击开关或选择缩略图等操作不触发该交互。配置行由 `data-setting-row` 标识，聚焦行附带 `data-held` 属性
 */
function useHeldRow(card: RefObject<HTMLElement | null>) {
  const [held, setHeld] = useState<Held | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  useEffect(() => {
    if (!held) return;
    held.row.toggleAttribute('data-held', true);
    return () => held.row.removeAttribute('data-held');
  }, [held]);
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const row = event.target.closest<HTMLElement>('[data-setting-row]');
    if (!row || !event.target.closest('.fui-Slider')) return;
    cleanup.current?.();
    const { clientX: x, clientY: y, pointerId } = event;
    const doc = event.currentTarget.ownerDocument;
    const hold = () => {
      const box = card.current?.getBoundingClientRect();
      const rect = row.getBoundingClientRect();
      if (box) setHeld({ row, top: rect.top - box.top, height: rect.height });
    };
    const timer = setTimeout(hold, HOLD_MS);
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      if (Math.abs(next.clientX - x) > DRAG_SLOP || Math.abs(next.clientY - y) > DRAG_SLOP) {
        clearTimeout(timer);
        hold();
      }
    };
    const end = (next: globalThis.PointerEvent) => {
      if (next.pointerId === pointerId) cleanup.current?.();
    };
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', end);
    doc.addEventListener('pointercancel', end);
    cleanup.current = () => {
      clearTimeout(timer);
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', end);
      doc.removeEventListener('pointercancel', end);
      cleanup.current = null;
      setHeld(null);
    };
  };
  return { held, onPointerDown };
}

/**
 * 预设配置编辑卡片：展示当前分类的可调参数，停靠于调节目标对象的相对一侧
 *
 * 宽度 360px，高度随内容，超出时卡片内部纵向滚动。底板采用与歌词工具面板一致的 Acrylic 材质（`usePanelSurface`，降级时近乎实底）。
 * 按住滑块拖动时，底板与其余各行让位，只保留当前这一行，它换上同材质的一小块底板，整幅画面得以露出。
 * 在画面上拖动参考线时整张卡片让位。卡片不绘制标题，单一分组的分类也不绘制分组标题
 */
export function EditCard({
  id,
  dock,
  label,
  yielded = false,
  leaving = false,
  onHolding,
  children,
}: EditCardProps) {
  const surface = usePanelSurface();
  const card = useRef<HTMLElement>(null);
  const { held, onPointerDown } = useHeldRow(card);
  const holding = held !== null;
  useEffect(() => {
    onHolding?.(holding);
  }, [onHolding, holding]);
  return (
    <section
      ref={card}
      className={styles.card}
      aria-label={label}
      data-edit-card
      data-dock={dock}
      data-holding={holding || undefined}
      data-yielded={yielded || undefined}
      data-leaving={leaving || undefined}
      inert={leaving}
      onPointerDownCapture={onPointerDown}
    >
      <div className={mergeClasses(styles.plate, surface)} aria-hidden />
      {held && (
        <div
          className={mergeClasses(styles.rowPlate, surface)}
          style={{ top: held.top, height: held.height }}
          aria-hidden
        />
      )}
      <div className={styles.body}>
        <PageSwap id={id}>{children}</PageSwap>
      </div>
    </section>
  );
}
