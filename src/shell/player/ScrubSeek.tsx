import { Tooltip, type PositioningVirtualElement } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type AnimationEvent,
  type FocusEvent,
  type PointerEvent,
} from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { createHoverReveal, HOVER_OPEN_MS } from './hoverReveal.ts';
import { currentTrackAtom } from '../../playback/playback.ts';
import { playbackCanSeekAtom, playbackDurationAtom } from '../../playback/playerAtoms.ts';
import styles from './ScrubSeek.module.css';
import { SeekBar } from './SeekBar.tsx';
import { clockText } from '../../playback/seekDraft.ts';
import { usePointerPresence } from './usePointerPresence.ts';

/** 指针离开之后收回前等多久，毫秒：从线上滑过边缘的一两像素不算离开。 */
const SCRUB_CLOSE_MS = 100;
/** 触屏点开之后多久没动作就收回，毫秒。 */
const TOUCH_IDLE_MS = 3000;

/** 悬停态进出：`on` 进来，`off` 收回；从没进过时不给。 */
export type ScrubState = 'on' | 'off';

export interface ScrubSeekProps {
  /** 放在哪一种形态里：几何不同（`ScrubSeek.module.css`）。 */
  readonly form: 'lcd' | 'capsule';
  onScrubChange(state: ScrubState): void;
}

/** 指针停在线上的哪里：横坐标（CSS 像素）与它在线上的比例。存比例不存秒数，换了一首时长变了照样对。 */
interface Hover {
  readonly fraction: number;
  readonly x: number;
}

/** 按此刻命中区的位置量指针在线上的比例；量不到答 null。 */
function hoverAt(root: HTMLElement | null, x: number): Hover | null {
  const box = root?.querySelector('[role="slider"]')?.getBoundingClientRect();
  if (!box || !(box.width > 0)) return null;
  return { fraction: Math.min(1, Math.max(0, (x - box.left) / box.width)), x };
}

/**
 * 正在播放条与胶囊的进度线，带悬停态：指针停在线的命中区 300 ms，或键盘聚焦到进度条，就进悬停态，线挪到这一块的
 * 垂直正中、加粗到 4、出滑块，两端写已播与总长，指针处的时间写在这一块下方的提示里；这一块里封面以外的东西由
 * 外面按 `onScrubChange` 模糊变淡。悬停态里命中区撑满这一块（封面除外），指针离开就收回。
 *
 * 没进悬停态时照样能点、能拖；拖动期间不进也不出，免得线在指针底下换了位置。触屏点一下只进悬停态、不跳，
 * 之后点哪跳哪，3 s 没动作收回，拖着的时候不算没动作。不能跳转（网络流、没有时长）时悬停态里只写已播与一句说明。
 */
export function ScrubSeek({ form, onScrubChange }: ScrubSeekProps) {
  const t = useAtomValueRawSync(translateAtom);
  const track = useAtomValueRawSync(currentTrackAtom);
  const duration = useAtomValueRawSync(playbackDurationAtom);
  const canSeek = useAtomValueRawSync(playbackCanSeekAtom);
  const root = useRef<HTMLDivElement>(null);
  const [scrub, setScrub] = useState<ScrubState | undefined>(undefined);
  const [hover, setHover] = useState<Hover | null>(null);
  const [reveal] = useState(() =>
    createHoverReveal({
      openMs: HOVER_OPEN_MS,
      closeMs: SCRUB_CLOSE_MS,
      onChange: (open) => setScrub(open ? 'on' : 'off'),
    }),
  );
  const touchIdle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressing = useRef(false);
  const pointerType = useRef('');
  // 最近一次指针在线上的横坐标：没进悬停态时也记着，进来那一刻指针没动也能写出提示。
  const lastX = useRef<number | null>(null);
  const on = scrub === 'on';

  // 停止时线整条卸下；收回的动效挂在线上，停着的这个「刚收回」要清掉，不然起播时新挂上的线会再落一次。
  if (!track && scrub !== undefined) setScrub(undefined);

  const latest = useRef(onScrubChange);
  useEffect(() => {
    latest.current = onScrubChange;
  });
  const told = useRef(false);
  useEffect(() => {
    if (!on && !told.current) return;
    told.current = true;
    latest.current(on ? 'on' : 'off');
  }, [on]);
  useEffect(
    () => () => {
      reveal.dispose();
      clearTimeout(touchIdle.current);
    },
    [reveal],
  );
  useEffect(() => {
    if (!track) reveal.dismiss();
  }, [track, reveal]);
  // 进悬停态时线换了位置与宽度，按新的版式量一次指针处。
  useLayoutEffect(() => {
    if (on && lastX.current !== null) setHover(hoverAt(root.current, lastX.current));
  }, [on]);

  // 触屏不悬停：点开后按住不收，3 s 没动作再放开，放开时没有别的理由按着就收。
  const touched = () => {
    clearTimeout(touchIdle.current);
    reveal.hold('touch', true);
    touchIdle.current = setTimeout(() => reveal.hold('touch', false), TOUCH_IDLE_MS);
  };
  // 按下时进度线自己调 focus()（`useSeekGesture`），聚焦事件发生在这次按下往回冒泡的途中：捕获时记下、冒泡回到
  // 这一层时清掉。两段之间浏览器会先跑一轮微任务，不能靠微任务清。
  const onPointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
    pressing.current = true;
    pointerType.current = event.pointerType;
    if (event.pointerType !== 'touch') return;
    const opening = !reveal.open;
    touched();
    if (!opening) return;
    // 头一下只进悬停态，不交给进度线去跳：进度线不接已经 preventDefault 的按下。不拦传播，页面上
    // 轻关浮层的监听照样收得到。
    event.preventDefault();
    reveal.show();
  };
  const onDragChange = (dragging: boolean) => {
    if (reveal.open) {
      reveal.hold('drag', dragging);
      // 触屏拖完从松手起重新计 3 s。
      if (!dragging && pointerType.current === 'touch') touched();
      return;
    }
    // 在细线上拖：拖动期间不进悬停态，松手时指针还在线上就重新计时。
    if (dragging) reveal.leave();
    else if (pointerType.current !== 'touch' && root.current?.matches(':hover')) reveal.enter();
  };
  // 按下引起的聚焦不算键盘聚焦：浏览器把脚本调的 focus() 按上一次聚焦的来路判 :focus-visible，页面上还没用鼠标
  // 聚焦过、或刚按过键时也会判成是，悬停态就会一直按着不收。
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (pressing.current || !event.target.matches(':focus-visible')) return;
    reveal.hold('focus', true);
    reveal.show();
  };
  const onBlur = () => reveal.hold('focus', false);
  // 线在指针底下换成一句说明、滑块随悬停态进出时，指针底下的节点会被换掉。
  usePointerPresence(root, {
    enter: (event) => {
      if (event.pointerType !== 'touch') reveal.enter();
    },
    leave: (event) => {
      if (event.pointerType !== 'touch') reveal.leave();
      lastX.current = null;
      setHover(null);
    },
  });
  // 收回的动效播完就回到「从没进过」。只认线那一层自己的动效，里面时间淡入的不算。
  const onAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (
      scrub === 'off' &&
      event.target instanceof Element &&
      event.target.parentElement === root.current
    )
      setScrub(undefined);
  };

  // 提示贴着这一块的下沿、横向跟着指针。
  const target: PositioningVirtualElement | undefined = hover
    ? {
        getBoundingClientRect: () => {
          const box = root.current?.getBoundingClientRect();
          return new DOMRect(hover.x, box?.top ?? 0, 0, box?.height ?? 0);
        },
      }
    : undefined;
  const seekable = canSeek && duration > 0;
  const live = track !== null && !(track.duration > 0);
  return (
    <Tooltip
      content={hover ? clockText(hover.fraction * duration) : ''}
      relationship="inaccessible"
      visible={on && seekable && hover !== null}
      positioning={{ position: 'below', target }}
    >
      <div
        ref={root}
        className={styles.root}
        data-form={form}
        data-scrub={scrub}
        onPointerDownCapture={onPointerDownCapture}
        onPointerDown={() => {
          pressing.current = false;
        }}
        onFocus={onFocus}
        onBlur={onBlur}
        onAnimationEnd={onAnimationEnd}
      >
        <SeekBar
          interactive
          thickness={on ? 4 : form === 'lcd' ? 3 : 2}
          thumb={on}
          clock
          clockHidden={!on}
          fill={on}
          reach={form === 'lcd' ? 'down' : 'up'}
          note={on ? t(live ? 'player.seekLive' : 'player.seekUnavailable') : undefined}
          onDragChange={onDragChange}
          onHover={(seconds, x) => {
            lastX.current = seconds === null ? null : x;
            // 指针处的时间只在悬停态里写，平时不跟着指针重画。
            if (seconds === null) setHover(null);
            else if (reveal.open) setHover(hoverAt(root.current, x));
          }}
        />
      </div>
    </Tooltip>
  );
}
