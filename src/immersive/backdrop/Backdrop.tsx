import { fb } from 'foo-webview-sdk/bridge';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { immersiveCoverAtom, immersiveCoverKey } from '../../covers/immersiveCover.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { playbackAtom } from '../../playback/playback.ts';
import { useLease } from '../lease/useLease.ts';
import styles from './Backdrop.module.css';
import {
  backdropCover,
  createBackdrop,
  type Backdrop as BackdropController,
} from './backdropAdapter.ts';
import { createLowFreqDrive } from './backdropAudio.ts';
import { resolveBackdrop } from './backdropChoice.ts';
import { resolveBackdropOptions } from './backdropOptions.ts';
import { heldCover } from './coverHold.ts';
import { BACKDROP_RENDERERS } from './backdropRegistry.ts';
import {
  backdropChoiceAtom,
  backdropOptionsAtom,
  backdropDegradedAtom,
  backdropUnavailableAtom,
  clearBackdropDegraded,
  markBackdropDegraded,
  markBackdropUnavailable,
} from './backdropState.ts';

const playingAtom = atom((get) => get(playbackAtom).state === 'playing');

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
  const coverState = useAtomValueRawSync(immersiveCoverAtom);
  // 换曲的空当（新地址还没到）里沿用上一张，不把背景先淡出到中性色再淡入
  const lastCover = useRef<string | null>(null);
  const cover = heldCover(coverState, lastCover.current, backdropCover(coverState));
  useLayoutEffect(() => {
    lastCover.current = cover;
  }, [cover]);
  const renderer = resolveBackdrop(
    choice,
    (id) => BACKDROP_RENDERERS[id].supported() && !unavailable.has(id),
  );
  const playing = useAtomValueRawSync(playingAtom);
  const stored = useAtomValueRawSync(backdropOptionsAtom);
  // 按实际在跑的渲染器取：因不支持而回退时，用户的选项照存，生效的是回退后那一个的项
  const options = useMemo(() => resolveBackdropOptions(renderer, stored), [renderer, stored]);
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
      openLowFreq: (lowFreq) => createLowFreqDrive({ host: fb.audio, ...lowFreq }),
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
      options,
      playing,
    });
  }, [renderer, cover, hasLyric, reducedMotion, degraded, visible, fpsCap, options, playing]);

  return (
    <div ref={host} className={styles.backdrop} data-backdrop={renderer ?? 'off'} aria-hidden />
  );
}
