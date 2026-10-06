import { Tooltip } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { MARQUEE_REST_MS, marqueeCycle, type MarqueeCycle } from './marquee.ts';
import styles from './TruncatedText.module.css';

export interface TruncatedTextProps extends HTMLAttributes<HTMLSpanElement> {
  readonly text: string;
  /** 图文混排时排进这一行的内容；给了它，`text` 只用作悬停提示的全文。 */
  readonly children?: ReactNode;
  /** 放不下时定时向左滚动一遍（`useMarquee`）；减弱动效时照旧只截断。 */
  readonly scroll?: boolean;
}

/**
 * 播放栏里一行会被截断的字（曲名、艺人与专辑）：放不下时截断、右缘渐隐，悬停出全文；放得下时既不渐隐也不出提示。
 * 截没截断在要出提示的那一刻量，窗口宽度、换曲都不用另外盯。读屏本来就念全文，提示只给眼睛看。外面给的
 * `className` 管字号、颜色与在行里怎么伸缩，`data-*` 原样落在外层 `<span>` 上。
 */
export function TruncatedText({
  text,
  children,
  scroll = false,
  className,
  ...rest
}: TruncatedTextProps) {
  const clip = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useMarquee(clip, inner, text, scroll);
  return (
    <Tooltip
      content={text}
      relationship="inaccessible"
      visible={visible}
      onVisibleChange={(_, data) => {
        const outer = clip.current;
        const width = inner.current?.offsetWidth ?? 0;
        setVisible(data.visible && outer !== null && width > outer.clientWidth);
      }}
    >
      <span ref={clip} className={`${styles.clip} ${className ?? ''}`} {...rest}>
        <span ref={inner} className={styles.text}>
          {children ?? text}
        </span>
      </span>
    </Tooltip>
  );
}

/**
 * 放不下的一行字定时向左滚动一遍（节奏见 `marquee.ts`）。`clip` 是裁切的那一层，`text` 是里面的字；字宽与
 * 裁切层的宽一变（换曲、窗口缩放、字体到位）就按新的放不下的量从头来。减弱动效或 `enabled` 为假时不滚，
 * 只留截断与渐隐。`content` 是这一行的字：换了字即便宽度碰巧不变也要从头来。
 *
 * 每一轮是一段播完即止的动画，开头的停顿用定时器等：停着的时候页面上没有这一行的动画，遮罩动画不能交给
 * 合成线程，一直挂着就每一帧都要重算样式。
 */
function useMarquee(
  clip: RefObject<HTMLElement | null>,
  text: RefObject<HTMLElement | null>,
  content: string,
  enabled: boolean,
): void {
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const active = enabled && !reduced;
  useEffect(() => {
    const outer = clip.current;
    const inner = text.current;
    if (!active || !outer || !inner) return;
    let running: Animation[] = [];
    let rest: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearTimeout(rest);
      for (const animation of running) animation.cancel();
      running = [];
    };
    const play = (cycle: MarqueeCycle) => {
      const timing = { duration: cycle.duration };
      const current = [inner.animate(cycle.text, timing), outer.animate(cycle.mask, timing)];
      // 两段从同一刻起算，遮罩与位移才对得上。
      const now = document.timeline.currentTime;
      for (const animation of current) animation.startTime = now;
      running = current;
      // 取消时这个 promise 以 AbortError 落空，那时已经有新的一轮或整个停了，不用接着排。
      current[0]?.finished.then(
        () => {
          if (running !== current) return;
          running = [];
          rest = setTimeout(() => play(cycle), MARQUEE_REST_MS);
        },
        () => undefined,
      );
    };
    const restart = () => {
      stop();
      // 位移不改变排版宽度，滚动中量到的仍是字的原宽。
      const cycle = marqueeCycle(inner.offsetWidth - outer.clientWidth);
      if (cycle) rest = setTimeout(() => play(cycle), MARQUEE_REST_MS);
    };
    const observer = new ResizeObserver(restart);
    observer.observe(outer);
    observer.observe(inner);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [clip, text, content, active]);
}
