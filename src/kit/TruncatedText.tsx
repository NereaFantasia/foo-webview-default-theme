import { Tooltip } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import { reducedMotionAtom } from '../motion/reducedMotion.ts';
import {
  MARQUEE_MIN_OVERFLOW,
  MARQUEE_REST_MS,
  conveyorCycle,
  marqueeCycle,
  type MarqueeCycle,
} from './marquee.ts';
import styles from './TruncatedText.module.css';

export interface TruncatedTextProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  readonly text: string;
  /** 图文混排时排进这一行的内容；给了它，`text` 只用作悬停提示的全文 */
  readonly children?: ReactNode;
  /** 放不下时定时滚动（`useMarquee`）；减弱动效时照旧只截断 */
  readonly scroll?: boolean;
  /**
   * 怎么滚：`rewind` 向左滚到末尾、淡出回到开头（缺省，播放栏）；`conveyor` 传送带，字后面接一份相同的字，
   * 滚一圈回到原点。传送带只在放不下时才画第二份字，放得下与减弱动效时都只有一份
   */
  readonly loop?: 'rewind' | 'conveyor';
  /** 滚动速度，CSS 像素每秒；缺省是播放栏那一档，大字用 `marqueeSpeedFor(字号)` */
  readonly speed?: number;
  /**
   * 放不下时怎么给全文：`tooltip` 是 Fluent 的悬停提示（缺省）；`title` 是浏览器自带的 `title`，
   * 只在此刻放不下时才写在这一行上，放得下就没有
   */
  readonly hint?: 'tooltip' | 'title';
}

/**
 * 一行会被截断的字（播放栏与沉浸视图里的曲名、艺人与专辑）：放不下时截断、右缘渐隐，悬停出全文；放得下时
 * 既不渐隐也不出提示。`tooltip` 档截没截断在要出提示的那一刻量，窗口宽度、换曲都不用另外盯；`title` 档
 * 没有「要出提示的那一刻」可挂，改为盯着字宽与裁切层宽。读屏本来就念全文，提示只给眼睛看。外面给的
 * `className` 管字号、颜色与在行里怎么伸缩，`data-*` 原样落在外层 `<span>` 上
 */
export function TruncatedText({
  text,
  children,
  scroll = false,
  loop = 'rewind',
  speed,
  hint = 'tooltip',
  className,
  ...rest
}: TruncatedTextProps) {
  const clip = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const lead = useRef<HTMLSpanElement>(null);
  const tail = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const clipped = useClipped(clip, inner, hint === 'title');
  const conveyor = loop === 'conveyor';
  // 只有传送带要知道此刻在不在滚（画不画第二份字），缺省的单向滚动不必另外量
  const moving = useMoving(clip, lead, text, scroll && conveyor);
  const looping = moving && conveyor;
  const edges = useMemo(() => (conveyor ? { lead, tail } : null), [conveyor]);
  useMarquee(clip, inner, text, scroll && (!conveyor || looping), speed, edges);
  const content = children;
  const line = (
    <span
      ref={clip}
      className={`${styles.clip} ${className ?? ''}`}
      title={clipped ? text : undefined}
      data-conveyor={looping || undefined}
      {...rest}
    >
      <span ref={inner} className={styles.text}>
        {conveyor ? <span ref={lead}>{content ?? text}</span> : (content ?? text)}
        {looping && (
          <>
            <span className={styles.gap} aria-hidden />
            <span ref={tail} aria-hidden>
              {content ?? text}
            </span>
          </>
        )}
      </span>
    </span>
  );
  if (hint === 'title') return line;
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
      {line}
    </Tooltip>
  );
}

/**
 * 字此刻比裁切层宽（被截断了）。只在 `enabled` 时盯：字宽与裁切层宽一变就重量，观察器登记时会先发一次，
 * 不用另外量初值。滚动中的位移不改排版宽度，量到的仍是字的原宽
 */
function useClipped(
  clip: RefObject<HTMLElement | null>,
  text: RefObject<HTMLElement | null>,
  enabled: boolean,
): boolean {
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const outer = clip.current;
    const inner = text.current;
    if (!enabled || !outer || !inner) return;
    const measure = () => setClipped(inner.offsetWidth > outer.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [clip, text, enabled]);
  return enabled && clipped;
}

/** 传送带的两份字：`lead` 是原来那份，`tail` 是接在后面的那份，画了第二份才有 `tail` */
interface ConveyorEdges {
  readonly lead: RefObject<HTMLElement | null>;
  readonly tail: RefObject<HTMLElement | null>;
}

/**
 * 这一行此刻在不在滚：字比裁切层宽出 `MARQUEE_MIN_OVERFLOW` 以上。减弱动效或不滚时没有。传送带据此决定画不画
 * 第二份字，所以按原来那份的宽判（`measured`），不按整行：画了第二份之后整行的宽翻倍，不能再拿它判断放不放得下
 */
function useMoving(
  clip: RefObject<HTMLElement | null>,
  measured: RefObject<HTMLElement | null>,
  content: string,
  enabled: boolean,
): boolean {
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const active = enabled && !reduced;
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const outer = clip.current;
    const first = measured.current;
    if (!active || !outer || !first) {
      setMoving(false);
      return;
    }
    const measure = () => setMoving(first.offsetWidth - outer.clientWidth >= MARQUEE_MIN_OVERFLOW);
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(first);
    return () => observer.disconnect();
  }, [clip, measured, content, active]);
  return moving && active;
}

/**
 * 放不下的一行字定时滚动（节奏见 `marquee.ts`）。`clip` 是裁切的那一层，`text` 是里面的字；字宽与
 * 裁切层的宽一变（换曲、窗口缩放、字体到位）就按新的放不下的量从头来。减弱动效或 `enabled` 为假时不滚，
 * 只留截断与渐隐。`content` 是这一行的字：换了字即便宽度碰巧不变也要从头来。`edges` 给了就按传送带滚：
 * 一圈的长度是两份字的左缘之差，量到小数，两份落在彼此的位置上才对得严
 *
 * 每一轮是一段播完即止的动画，开头的停顿用定时器等：停着的时候页面上没有这一行的动画，遮罩动画不能交给
 * 合成线程，一直挂着就每一帧都要重算样式
 */
function useMarquee(
  clip: RefObject<HTMLElement | null>,
  text: RefObject<HTMLElement | null>,
  content: string,
  enabled: boolean,
  speed: number | undefined,
  edges: ConveyorEdges | null,
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
      // 两段从同一刻起算，遮罩与位移才对得上
      const now = document.timeline.currentTime;
      for (const animation of current) animation.startTime = now;
      running = current;
      // 取消时这个 promise 以 AbortError 落空，那时已经有新的一轮或整个停了，不用接着排
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
      // 位移不改变排版宽度，滚动中量到的仍是字的原宽
      const first = edges?.lead.current;
      const second = edges?.tail.current;
      const cycle = edges
        ? first && second
          ? conveyorCycle(
              second.getBoundingClientRect().left - first.getBoundingClientRect().left,
              speed,
            )
          : null
        : marqueeCycle(inner.offsetWidth - outer.clientWidth, speed);
      if (cycle) rest = setTimeout(() => play(cycle), MARQUEE_REST_MS);
    };
    const observer = new ResizeObserver(restart);
    observer.observe(outer);
    observer.observe(inner);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [clip, text, content, active, speed, edges]);
}
