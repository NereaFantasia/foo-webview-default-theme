import { MusicNote220Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { reducedMotionAtom } from '../../../motion/reducedMotion.ts';
import styles from './NowPlayingCover.module.css';
import { nowPlayingAtom } from './nowPlaying.ts';
import {
  coverMotion,
  coverTurnOf,
  type CoverMotion,
  type CoverWipe,
  type MotionTrack,
} from './swapMotion.ts';
import { trackSwapAtom } from './trackSwap.ts';

export interface NowPlayingCoverProps {
  /** 边长，CSS 像素。 */
  readonly size: number;
  /**
   * 圆角：`lcd` 只圆左边两角，与正在播放条的外框同一条弧，右边贴着文字是直的；`bar` 四角 4；`round` 是圆。
   * 换曲的过渡也按它分：`bar` 推入，`lcd` 擦除，`round` 转入（`swapMotion.ts`）。
   */
  readonly shape: 'lcd' | 'bar' | 'round';
}

/** 叠着画的一层：一张图，或者占位图标（`url` 为 null）。 */
interface Layer {
  readonly id: number;
  readonly url: string | null;
  readonly wipe?: CoverWipe;
}

function play(element: Element | null, tracks: readonly MotionTrack[]): Animation[] {
  if (!element) return [];
  return tracks.map(([frames, timing]) => element.animate(frames, { ...timing, fill: 'forwards' }));
}

/**
 * 正在播放那一首的封面。没有曲目、问不到地址、图解不出（这一首没有封面）时画占位图标；解不出只认那个地址，
 * 换曲换了地址就再试。纯装饰，名字由旁边的曲名给。
 *
 * 换图：新图先在后台解码，解码好了才盖上去，旧图一直留到那时，中间不空一帧。盖上去时按这一次换曲放过渡，
 * 放完只留新的一层。同一次换曲只翻一次；同一张专辑、减弱动效、页面不可见时直接换。过渡还没放完又换了图：
 * 当前这张直接到位，新图照常盖上来，中间的几张不演。
 */
export function NowPlayingCover({ size, shape }: NowPlayingCoverProps) {
  const { key, cover } = useAtomValueRawSync(nowPlayingAtom);
  const swap = useAtomValueRawSync(trackSwapAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const [broken, setBroken] = useState<string | null>(null);
  const target = key && cover && cover !== broken ? cover : null;
  const [layers, setLayers] = useState<readonly Layer[]>(() => [{ id: 0, url: target }]);
  const root = useRef<HTMLSpanElement>(null);
  const [state] = useState(() => ({
    target,
    token: 0,
    nextId: 1,
    usedSerial: swap.serial,
    pending: null as { readonly id: number; readonly motion: CoverMotion } | null,
    running: [] as Animation[],
    settled: [] as Animation[],
  }));

  useEffect(() => {
    if (target === state.target) return;
    state.target = target;
    const mine = ++state.token;
    const commit = (url: string | null) => {
      if (mine !== state.token) return;
      const unused = state.usedSerial === swap.serial ? null : swap;
      state.usedSerial = swap.serial;
      const still = reduced || document.visibilityState !== 'visible';
      const motion = still ? null : coverMotion(shape, coverTurnOf(unused, performance.now()));
      const id = state.nextId++;
      state.pending = motion ? { id, motion } : null;
      // 直接换时旧的几层随这次提交卸下，上面的动画不用再等。
      if (!motion) state.running = [];
      setLayers((previous) => {
        const top = previous.at(-1);
        // 正在放的过渡就此到位：只留盖在最上面的那张，去掉它的擦除遮罩。
        const base = motion && top ? [{ id: top.id, url: top.url }] : [];
        return [...base, { id, url, wipe: motion?.wipe }];
      });
    };
    if (target === null) {
      commit(null);
      return;
    }
    const image = new Image();
    image.src = target;
    image.decode().then(
      () => commit(target),
      () => {
        if (mine === state.token) setBroken(target);
      },
    );
  }, [target, state, swap, reduced, shape]);

  useLayoutEffect(() => {
    // 上一轮放完、收成一层之后，停在终态的动画撤掉；终态就是不带动画时的样子。
    for (const animation of state.settled) animation.cancel();
    state.settled = [];
    const pending = state.pending;
    const host = root.current;
    if (!pending || !host) return;
    state.pending = null;
    for (const animation of state.running) animation.cancel();
    const incoming = host.querySelector(`[data-layer="${pending.id}"]`);
    const outgoing = incoming?.previousElementSibling ?? null;
    const current = [
      ...play(incoming, pending.motion.incoming),
      ...play(outgoing, pending.motion.outgoing),
    ];
    state.running = current;
    void Promise.all(current.map((animation) => animation.finished)).then(
      () => {
        if (state.running !== current) return;
        state.running = [];
        state.settled = current;
        setLayers((previous) => {
          const top = previous.at(-1);
          return top ? [{ id: top.id, url: top.url }] : previous;
        });
      },
      () => undefined,
    );
  }, [layers, state]);

  useLayoutEffect(
    () => () => {
      for (const animation of state.running) animation.cancel();
      state.running = [];
    },
    [state],
  );

  return (
    <span
      ref={root}
      className={styles.root}
      style={{ width: size, height: size }}
      data-shape={shape}
      aria-hidden
    >
      {layers.map((layer) => (
        <span key={layer.id} className={styles.layer} data-layer={layer.id} data-wipe={layer.wipe}>
          {layer.url ? (
            <img
              className={styles.image}
              src={layer.url}
              alt=""
              draggable={false}
              onError={() => setBroken(layer.url)}
            />
          ) : (
            <MusicNote220Regular className={styles.placeholder} />
          )}
        </span>
      ))}
    </span>
  );
}
