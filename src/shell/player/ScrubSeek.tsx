import { Tooltip, type PositioningVirtualElement } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
} from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { createHoverReveal } from './hoverReveal.ts';
import { currentTrackAtom } from '../../playback/playback.ts';
import { playbackCanSeekAtom, playbackDurationAtom } from '../../playback/playerAtoms.ts';
import styles from './ScrubSeek.module.css';
import { SeekBar } from './SeekBar.tsx';
import { clockText } from '../../playback/seekDraft.ts';
import { usePointerPresence } from './usePointerPresence.ts';
import { SeekLyrics } from './SeekLyrics.tsx';

/** 紧凑进度条悬停到展开前的等待，毫秒。 */
const SCRUB_OPEN_MS = 50;
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
 * 正在播放条与胶囊的紧凑进度线：悬停后轻抬并加粗，两端时间覆盖在轨道上方，鼠标位置用竖条标出。
 * 命中区与轨道宽度不随显隐改变，时间和预览装饰不接指针；周围内容由外面按 `onScrubChange` 模糊变淡。
 *
 * 起拖和键盘聚焦立即显示时间，拖动时竖条随目标位置移动。触屏点一下只展开、不跳，之后点哪跳哪，
 * 3 s 没动作收回，拖着的时候不收。不能跳转时显示已播与说明，不画预览竖条。
 */
export function ScrubSeek({ form, onScrubChange }: ScrubSeekProps) {
  const t = useAtomValueRawSync(translateAtom);
  const track = useAtomValueRawSync(currentTrackAtom);
  const duration = useAtomValueRawSync(playbackDurationAtom);
  const canSeek = useAtomValueRawSync(playbackCanSeekAtom);
  const root = useRef<HTMLDivElement>(null);
  const [scrub, setScrub] = useState<ScrubState | undefined>(undefined);
  const [hover, setHover] = useState<Hover | null>(null);
  const [focused, setFocused] = useState(false);
  const [reveal] = useState(() =>
    createHoverReveal({
      openMs: SCRUB_OPEN_MS,
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

  // 没有曲目时清掉交互态，新挂上的进度线从常态开始。
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
  // 指针停着不动也要在悬停展开时显示预览位置。
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
    lastX.current = event.clientX;
    setFocused(false);
    reveal.hold('focus', false);
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
    reveal.hold('drag', dragging);
    if (dragging) reveal.show();
    else if (pointerType.current === 'touch') touched();
    else if (lastX.current !== null && root.current?.matches(':hover')) {
      setHover(hoverAt(root.current, lastX.current));
    }
  };
  // 按下引起的聚焦不算键盘聚焦：浏览器把脚本调的 focus() 按上一次聚焦的来路判 :focus-visible，页面上还没用鼠标
  // 聚焦过、或刚按过键时也会判成是，悬停态就会一直按着不收。
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (pressing.current || !event.target.matches(':focus-visible')) return;
    setFocused(true);
    reveal.hold('focus', true);
    reveal.show();
  };
  const onBlur = () => {
    setFocused(false);
    reveal.hold('focus', false);
  };
  usePointerPresence(root, {
    enter: (event) => {
      if (event.pointerType !== 'touch') {
        lastX.current = event.clientX;
        reveal.enter();
      }
    },
    leave: (event) => {
      if (event.pointerType !== 'touch') reveal.leave();
      lastX.current = null;
      setHover(null);
    },
  });
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
        onPointerMoveCapture={(event) => {
          lastX.current = event.clientX;
        }}
      >
        <SeekBar
          interactive
          thickness={6}
          className={styles.hit}
          onDragChange={onDragChange}
          onHover={(seconds, x) => {
            // 指针处的时间只在悬停态里写，平时不跟着指针重画。
            if (seconds === null) setHover(null);
            else {
              lastX.current = x;
              if (reveal.open) setHover(hoverAt(root.current, x));
            }
          }}
        >
          {(display) => {
            const marker =
              display.preview?.fraction ??
              (display.dragging
                ? display.fraction
                : (hover?.fraction ?? (focused ? display.fraction : undefined)));
            const digits = Math.max(
              clockText(display.position).length,
              clockText(display.duration).length,
            );
            return (
              <div className={styles.display}>
                <div
                  className={styles.lyrics}
                  style={{
                    left: `calc(${digits}ch + var(--spacingHorizontalS))`,
                    right: `calc(${digits}ch + var(--spacingHorizontalS))`,
                  }}
                >
                  <SeekLyrics target={display.preview} />
                </div>
                <div className={styles.clocks} aria-hidden="true">
                  <span data-seek-clock="position" data-dragging={display.dragging || undefined}>
                    {clockText(display.position)}
                  </span>
                  <span className={styles.total} data-seek-clock="duration">
                    {seekable ? clockText(display.duration) : ''}
                  </span>
                  {!seekable && (
                    <span className={styles.note}>
                      {t(live ? 'player.seekLive' : 'player.seekUnavailable')}
                    </span>
                  )}
                </div>
                <div className={styles.line} data-seek-track aria-hidden="true">
                  {display.track}
                </div>
                <span
                  className={styles.marker}
                  data-seek-preview
                  data-visible={(on && seekable && marker !== undefined) || undefined}
                  style={{
                    left:
                      display.dragging || hover === null || display.preview?.keyboard
                        ? 'calc(var(--seek-indicator, 0) * 100%)'
                        : `${(marker ?? display.fraction) * 100}%`,
                  }}
                  aria-hidden="true"
                />
              </div>
            );
          }}
        </SeekBar>
      </div>
    </Tooltip>
  );
}
