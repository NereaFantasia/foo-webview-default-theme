import { fb } from 'foo-webview-sdk/bridge';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { immersiveCoverAtom, immersiveCoverKey } from '../../covers/immersiveCover.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { currentTrackAtom, playbackAtom } from '../../playback/playback.ts';
import { trackKeyOf } from '../../playback/playbackContract.ts';
import { backgroundCoverAtom } from '../../theme/background/windowBackground.ts';
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
import { backdropSource, heldCover } from './coverHold.ts';
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
  /** 背景是否可见。为假时释放渲染器与 canvas */
  readonly visible: boolean;
  /** 用户设置的帧率上限，null 表示不设上限 */
  readonly fpsCap: number | null;
  /** 当前曲目的歌词是否就绪 */
  readonly hasLyric?: boolean;
}

/**
 * 沉浸视图的动态背景，切换预设场景时沿用同一个渲染器实例
 *
 * 封面来自沉浸封面服务（`immersiveCoverKey`）。渲染器出错或不可用时回退到其他候选渲染器，都不可用时显示纯色底
 */
export function Backdrop({ visible, fpsCap, hasLyric }: BackdropProps) {
  const store = useStore();
  const choice = useAtomValueRawSync(backdropChoiceAtom);
  const unavailable = useAtomValueRawSync(backdropUnavailableAtom);
  const degraded = useAtomValueRawSync(backdropDegradedAtom);
  const reducedMotion = useAtomValueRawSync(reducedMotionAtom);
  useLease(immersiveCoverKey);
  const coverState = useAtomValueRawSync(immersiveCoverAtom);
  const playingCover = useAtomValueRawSync(backgroundCoverAtom);
  const trackKey = trackKeyOf(useAtomValueRawSync(currentTrackAtom));
  // 换曲后新地址尚未取得时沿用上一张封面，背景不先淡出到中性色再淡入。
  // 只在视图可见期间沿用，再次进入视图时不使用上一次留下的封面
  const lastCover = useRef<string | null>(null);
  const cover = backdropSource(
    coverState,
    playingCover,
    trackKey,
    heldCover(coverState, lastCover.current, backdropCover(coverState)),
  );
  useLayoutEffect(() => {
    lastCover.current = visible ? cover : null;
  }, [cover, visible]);
  const renderer = resolveBackdrop(
    choice,
    (id) => BACKDROP_RENDERERS[id].supported() && !unavailable.has(id),
  );
  const playing = useAtomValueRawSync(playingAtom);
  const stored = useAtomValueRawSync(backdropOptionsAtom);
  // 按实际运行的渲染器解析选项。因不支持而回退时，用户的选项保持不变，生效的是回退后渲染器的选项
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

  // 进入视图或窗口重新可见时清除降级状态，上一段可见期内的帧率降级不延续到这一段
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
