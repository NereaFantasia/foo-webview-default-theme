import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import {
  SIDEBAR_WIDTH,
  sidebarPrefsAtom,
  sidebarPrefsKey,
} from '../../nav/sidebar/sidebarPrefs.ts';
import { RAIL_WIDTH, snapDrag, snapKey, type SidebarShape } from '../../nav/sidebar/sidebarSnap.ts';
import styles from './SidebarSplitter.module.css';
import { useCommand } from '../../nav/useCommand.ts';
import { useService } from '../../kit/useService.ts';
import { SplitterHandle } from '../SplitterHandle.tsx';

export interface SidebarSplitterProps {
  /** 侧边栏左缘所在的元素，用作拖动坐标原点。 */
  readonly origin: RefObject<HTMLElement | null>;
}

const BOUNDS = { min: SIDEBAR_WIDTH.min, max: SIDEBAR_WIDTH.max } as const;

/**
 * 主内容卡左缘的分栏握柄。拖动中按吸附规则实时换形态（`sidebarSnap.ts`），每一下都落盘；按 Esc 回到拖动
 * 之前的形态。双击在图标态与上次的展开宽度之间切换。焦点在握柄上时 ← / →、Home、End、Enter 按吸附规则
 * 换算。
 *
 * 拖动状态挂在握柄自己身上（`data-dragging`），不经祖先的类去点亮它。
 */
export function SidebarSplitter({ origin }: SidebarSplitterProps) {
  const t = useAtomValueRawSync(translateAtom);
  const { rail, width } = useAtomValueRawSync(sidebarPrefsAtom);
  const store = useStore();
  const sidebar = useService(sidebarPrefsKey);
  const handle = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  // 拖动中 Esc 调它：回到拖动之前的形态并结束这一次拖动。
  const cancel = useRef<(() => void) | null>(null);
  const finish = useRef<(() => void) | null>(null);

  useLayoutEffect(() => () => finish.current?.(), []);

  const press = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || finish.current) return;
    const element = event.currentTarget;
    const pointerId = event.pointerId;
    const left = origin.current?.getBoundingClientRect().left ?? 0;
    const prefs = store.get(sidebarPrefsAtom);
    const rest: SidebarShape = { rail: prefs.rail, width: prefs.width };
    // 保存按下位置到侧栏右缘的距离，包含卡片留白与手柄内的抓取偏移。
    const offset = event.clientX - left - (rest.rail ? RAIL_WIDTH : rest.width);
    let shape = rest;
    event.preventDefault();
    element.setPointerCapture(pointerId);
    const move = (moved: globalThis.PointerEvent) => {
      shape = snapDrag(moved.clientX - left - offset, shape, BOUNDS, rest.width);
      sidebar.setShape(shape);
    };
    const end = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', end);
      element.removeEventListener('pointercancel', end);
      element.removeEventListener('lostpointercapture', end);
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      cancel.current = null;
      finish.current = null;
      setDragging(false);
    };
    cancel.current = () => {
      sidebar.setShape(rest);
      end();
    };
    finish.current = end;
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    element.addEventListener('lostpointercapture', end);
    setDragging(true);
  };

  useCommand({
    id: 'sidebar.cancelResize',
    layer: 'gesture',
    keys: [{ key: 'Escape' }],
    enabled: () => cancel.current !== null,
    run: () => cancel.current?.(),
  });
  // 按键换算读 store 里此刻的形态：连按时不必等上一下的重渲染。
  const resizeKey = (key: string) => ({
    id: `sidebar.resize.${key}`,
    layer: 'widget' as const,
    keys: [{ key }],
    enabled: () => document.activeElement === handle.current,
    run: () => {
      const next = snapKey(key, store.get(sidebarPrefsAtom), BOUNDS);
      if (next) sidebar.setShape(next);
    },
  });
  useCommand(resizeKey('ArrowLeft'));
  useCommand(resizeKey('ArrowRight'));
  useCommand(resizeKey('Home'));
  useCommand(resizeKey('End'));
  useCommand(resizeKey('Enter'));

  return (
    <SplitterHandle
      ref={handle}
      className={styles.splitter}
      aria-label={t('sidebar.resize')}
      aria-valuenow={rail ? RAIL_WIDTH : width}
      aria-valuemin={RAIL_WIDTH}
      aria-valuemax={SIDEBAR_WIDTH.max}
      dragging={dragging}
      onPointerDown={press}
      onDoubleClick={() => sidebar.toggleRail()}
    />
  );
}
