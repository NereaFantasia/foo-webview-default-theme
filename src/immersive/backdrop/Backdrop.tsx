import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { immersiveCoverAtom, immersiveCoverKey } from '../../covers/immersiveCover.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { useLease } from '../lease/useLease.ts';
import styles from './Backdrop.module.css';
import {
  backdropCover,
  createBackdrop,
  type Backdrop as BackdropController,
} from './backdropAdapter.ts';
import { resolveBackdrop } from './backdropChoice.ts';
import { BACKDROP_RENDERERS } from './backdropRegistry.ts';
import {
  backdropChoiceAtom,
  backdropDegradedAtom,
  backdropUnavailableAtom,
  clearBackdropDegraded,
  markBackdropDegraded,
  markBackdropUnavailable,
} from './backdropState.ts';

export interface BackdropProps {
  /** 完整窗口可见性状态（隐藏时释放渲染器与 canvas 资源） */
  readonly visible: boolean;
  /** 用户配置的帧率上限（null 表示不设硬上限） */
  readonly fpsCap: number | null;
  /** 当前曲目歌词就绪状态 */
  readonly hasLyric?: boolean;
}

/**
 * 沉浸视图动态背景渲染容器
 *
 * 托管 AMLL 背景渲染器调度与色场绘制，换预设场景时不重建实例；
 * 封面数据源绑定沉浸封面服务（immersiveCoverKey）；渲染器故障或不可用时自动回退候选实现或纯色底
 */
export function Backdrop({ visible, fpsCap, hasLyric }: BackdropProps) {
  const store = useStore();
  const choice = useAtomValueRawSync(backdropChoiceAtom);
  const unavailable = useAtomValueRawSync(backdropUnavailableAtom);
  const degraded = useAtomValueRawSync(backdropDegradedAtom);
  const reducedMotion = useAtomValueRawSync(reducedMotionAtom);
  useLease(immersiveCoverKey);
  const cover = backdropCover(useAtomValueRawSync(immersiveCoverAtom));
  const renderer = resolveBackdrop(
    choice,
    (id) => BACKDROP_RENDERERS[id].supported() && !unavailable.has(id),
  );
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<BackdropController | null>(null);

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const backdrop = createBackdrop(element, {
      create: (id) => BACKDROP_RENDERERS[id].create(),
      onUnavailable: (id) => markBackdropUnavailable(store, id),
      onDegrade: () => markBackdropDegraded(store),
      onRecover: () => clearBackdropDegraded(store),
    });
    controller.current = backdrop;
    return () => {
      backdrop.dispose();
      controller.current = null;
    };
  }, [store]);

  // 进视图、窗口重新可见时重新判定：上一段可见期里的跳闸不带到这一段
  useEffect(() => {
    if (visible) clearBackdropDegraded(store);
  }, [visible, store]);

  useEffect(() => {
    controller.current?.update({
      renderer,
      cover,
      hasLyric,
      reducedMotion,
      degraded,
      visible,
      fpsCap,
    });
  }, [renderer, cover, hasLyric, reducedMotion, degraded, visible, fpsCap]);

  return (
    <div ref={host} className={styles.backdrop} data-backdrop={renderer ?? 'off'} aria-hidden />
  );
}
