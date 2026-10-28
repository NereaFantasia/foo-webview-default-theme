import { useAtomValueRawSync } from 'jotai/react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import styles from './CoverLayers.module.css';
import {
  coverMotion,
  coverTurnOf,
  type CoverMotion,
  type CoverShape,
  type CoverWipe,
  type MotionTrack,
} from './swapMotion.ts';
import { trackSwapAtom } from './trackSwap.ts';

export interface CoverLayersProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** 目标封面图片地址；null 时渲染占位内容 */
  readonly url: string | null;
  /** 封面过渡动效形态：bar 对应推入，lcd 对应擦除，round 对应翻转；外框圆角由调用方样式提供 */
  readonly shape: CoverShape;
  /** 图片缺失或为空时的占位节点 */
  readonly placeholder: ReactNode;
  /** 图片加载完成后的回调，参数为目标图片地址 */
  readonly onLoaded?: (url: string) => void;
  /** 图片解码或加载失败回调，供调用方记录失效地址以防重复请求 */
  readonly onBroken: (url: string) => void;
}

/** 封面图层实体：包含独立图层标识、图片地址（null 为占位）及擦除遮罩模式 */
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
 * 响应切歌事件的封面多图层过渡组件
 * 新封面在后台完成解码后才入场覆盖，旧封面全程保留以避免白屏闪烁；入场时根据切歌动效形态播放过渡动画，完成后清理旧图层
 * 在同专辑连续切换、系统减弱动效或页面隐藏时直接瞬切；动画进行中若触发新切换，当前目标直接到位并衔接新封面，跳过中间帧过渡
 */
export function CoverLayers({
  url: target,
  shape,
  placeholder,
  onLoaded,
  onBroken,
  className,
  ...rest
}: CoverLayersProps) {
  const swap = useAtomValueRawSync(trackSwapAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
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
      // 无动效直切时立即丢弃历史图层并终止现有动画
      if (!motion) state.running = [];
      setLayers((previous) => {
        const top = previous.at(-1);
        // 动效入场时保留上一顶层图层作为底衬，同时清除其擦除遮罩
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
        if (mine === state.token) onBroken(target);
      },
    );
  }, [target, state, swap, reduced, shape, onBroken]);

  useLayoutEffect(() => {
    // 图层动画结束并收拢后清理已完成的 Web Animations 实例，恢复静态渲染样式
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
    <span ref={root} className={`${styles.root} ${className ?? ''}`} {...rest}>
      {layers.map(({ id, url, wipe }) => (
        <span key={id} className={styles.layer} data-layer={id} data-wipe={wipe}>
          {url ? (
            <img
              className={styles.image}
              src={url}
              alt=""
              draggable={false}
              onLoad={() => onLoaded?.(url)}
              onError={() => onBroken(url)}
            />
          ) : (
            placeholder
          )}
        </span>
      ))}
    </span>
  );
}
