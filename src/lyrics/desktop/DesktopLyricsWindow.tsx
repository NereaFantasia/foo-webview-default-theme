import { Button, Tooltip, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import {
  Add16Regular,
  Dismiss16Regular,
  LockClosed16Regular,
  LockOpen16Regular,
  Next16Filled,
  Pause16Filled,
  Play16Filled,
  Previous16Filled,
  Settings16Regular,
  Subtract16Regular,
  TextAlignCenter16Regular,
  TextAlignLeft16Regular,
  TextAlignRight16Regular,
  TextCollapse16Regular,
  TextExpand16Regular,
} from '@fluentui/react-icons';
import type { PlaybackClock } from 'foo-webview-sdk/bridge';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
  type RefObject,
} from 'react';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { DEFAULT_LYRICS_DISPLAY, type LyricsDisplay } from '../lyricsDisplay.ts';
import { LYRICS_MOTION_PRESET_VALUES, type LyricsMotion } from '../lyricsMotion.ts';
import { LyricsPlayer } from '../LyricsPlayer.tsx';
import { SINGLE_PADDING_X, translationFontSizeOf } from './desktopLyricsHeight.ts';
import type { DesktopLyricsLabel, DesktopLyricsView } from './desktopLyricsLink.ts';
import type { DesktopLyricsAlign } from './desktopLyricsPrefs.ts';
import type { DesktopLyricsPopup, PopupRect } from './desktopLyricsPopup.ts';
import styles from './DesktopLyricsWindow.module.css';
import { useDesktopLayout } from './useDesktopLayout.ts';
import { usePageHover } from './usePageHover.ts';

/** 锁定后鼠标停这么久才露出解锁键，毫秒 */
const REVEAL_MS = 600;
/** 页面没有原生改尺寸结束事件；尺寸停止变化这么久后再更新歌词布局，毫秒 */
const RESIZE_SETTLE_MS = 150;

const ALIGN_ICONS: Readonly<Record<DesktopLyricsAlign, ReactElement>> = {
  left: <TextAlignLeft16Regular />,
  center: <TextAlignCenter16Regular />,
  right: <TextAlignRight16Regular />,
};

// 遮罩是深色的，键的图标与状态层固定取浅色，不随深浅模式换
const useStyles = makeStyles({
  key: {
    minWidth: '32px',
    width: '32px',
    height: '32px',
    padding: '0',
    color: tokens.colorNeutralForeground1,
    ':hover': { color: tokens.colorNeutralForeground1 },
  },
});

function useClockState(clock: Pick<PlaybackClock, 'state' | 'onChange'>) {
  return useSyncExternalStore(
    (notify) => clock.onChange(notify),
    () => clock.state,
  );
}

interface LyricsViewport {
  readonly width: number;
  readonly height: number;
  readonly resizing: boolean;
}

/** 两层歌词共用一份稳定尺寸：拖边时保留旧布局，停止后一起排版，播放器实例始终保留 */
function useLyricsViewport(area: RefObject<HTMLDivElement | null>, ready: boolean) {
  const [viewport, setViewport] = useState<LyricsViewport | null>(null);
  useLayoutEffect(() => {
    const element = area.current;
    if (!ready || !element) return undefined;
    let latest = { width: element.clientWidth, height: element.clientHeight };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    setViewport({ ...latest, resizing: false });
    const observer = new ResizeObserver(() => {
      if (disposed) return;
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (width <= 0 || height <= 0 || (width === latest.width && height === latest.height)) return;
      latest = { width, height };
      // 连续尺寸通知只刷新计时，不让 React 与 AMLL 跟着每一步重排
      setViewport((current) =>
        current && !current.resizing ? { ...current, resizing: true } : current,
      );
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        setViewport({ ...latest, resizing: false });
      }, RESIZE_SETTLE_MS);
    });
    observer.observe(element);
    return () => {
      disposed = true;
      observer.disconnect();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [area, ready]);
  return viewport;
}

function Key({
  label,
  icon,
  onClick,
}: {
  readonly label: string;
  readonly icon: ReactElement;
  onClick(): void;
}) {
  const classes = useStyles();
  const controls = useViewControlStyles();
  return (
    <Tooltip content={label} relationship="label">
      <Button
        appearance="subtle"
        className={mergeClasses(classes.key, controls.icon)}
        icon={icon}
        onClick={onClick}
      />
    </Tooltip>
  );
}

function Toolbar({
  view,
  popup,
  playing,
}: {
  readonly view: DesktopLyricsView;
  readonly popup: DesktopLyricsPopup;
  readonly playing: boolean;
}) {
  const label = (key: DesktopLyricsLabel) => view.labels[key];
  const offset = `${view.offset < 0 ? '−' : '+'}${Math.abs(view.offset).toFixed(1)} s`;
  return (
    <div className={styles.toolbar} role="toolbar" aria-label={view.title}>
      <div className={styles.group}>
        <Key
          label={label('previous')}
          icon={<Previous16Filled />}
          onClick={() => popup.transport('prev')}
        />
        <Key
          label={label(playing ? 'pause' : 'play')}
          icon={playing ? <Pause16Filled /> : <Play16Filled />}
          onClick={() => popup.transport('toggle')}
        />
        <Key
          label={label('next')}
          icon={<Next16Filled />}
          onClick={() => popup.transport('next')}
        />
      </div>
      <div className={styles.group}>
        <Key
          label={label('earlier')}
          icon={<Subtract16Regular />}
          onClick={() => popup.send({ type: 'offset', delta: -0.1 })}
        />
        <span className={styles.offset}>{offset}</span>
        <Key
          label={label('later')}
          icon={<Add16Regular />}
          onClick={() => popup.send({ type: 'offset', delta: 0.1 })}
        />
      </div>
      <div className={styles.group}>
        <Key
          label={label('mode')}
          icon={view.mode === 'multi' ? <TextCollapse16Regular /> : <TextExpand16Regular />}
          onClick={() => popup.switchMode()}
        />
        <Key
          label={label('align')}
          icon={ALIGN_ICONS[view.align]}
          onClick={() => popup.send({ type: 'align' })}
        />
        <Key
          label={label('lock')}
          icon={<LockClosed16Regular />}
          onClick={() => popup.send({ type: 'lock', locked: true })}
        />
      </div>
      <div className={styles.group}>
        <Key
          label={label('settings')}
          icon={<Settings16Regular />}
          onClick={() => popup.send({ type: 'settings' })}
        />
        <Key
          label={label('close')}
          icon={<Dismiss16Regular />}
          onClick={() => popup.send({ type: 'close' })}
        />
      </div>
    </div>
  );
}

/**
 * 桌面歌词弹窗的整个页面：顶部 48 的工具栏行加歌词区。平时工具栏行透明，底板只铺歌词区；未锁定时悬停，
 * 工具栏行与歌词区共用一整块遮罩，带细边。锁定后鼠标穿透，停 600 ms 只在工具栏行正中露出解锁键，
 * 这块键是穿透的例外区。配色有两色时叠两层播放器：下层未唱色，上层已唱色只露出唱过的部分
 */
export function DesktopLyricsWindow({
  popup,
  clock,
}: {
  readonly popup: DesktopLyricsPopup;
  readonly clock: Pick<PlaybackClock, 'state' | 'onChange' | 'position'>;
}) {
  const view = useAtomValueRawSync(popup.view);
  const payload = useAtomValueRawSync(popup.lines);
  const hovering = useAtomValueRawSync(popup.hovering);
  const state = useClockState(clock);
  const area = useRef<HTMLDivElement>(null);
  const lyricsBox = useRef<HTMLDivElement>(null);
  const unlock = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; dragging: boolean } | null>(null);
  const suppressSeek = useRef(false);
  const hover = usePageHover(popup);
  const [reveal, setReveal] = useState(false);
  const locked = view?.locked ?? false;
  const hidden = view?.hidden ?? false;
  const align = view?.align ?? 'center';
  const lines = payload?.lines?.length ? payload.lines : null;

  const ready = view !== null;
  const viewport = useLyricsViewport(area, ready);
  const single = view?.mode === 'single';
  const interactive = ready && !single && !locked && !hidden && !viewport?.resizing;
  const preset = view?.motionPreset ?? 'amll';
  const motion = useMemo<LyricsMotion>(
    () => ({
      ...LYRICS_MOTION_PRESET_VALUES[preset],
      alignPosition: 0.5,
      ...(single ? { hidePassedLines: true, scale: false } : {}),
    }),
    [preset, single],
  );
  useEffect(() => {
    if (!interactive) {
      gesture.current = null;
      popup.endDrag();
    }
    return () => popup.endDrag();
  }, [popup, interactive]);

  // 捕获滚轮后再分别交给两层，避免可点击的下层先滚一次、转发时又滚一次
  useEffect(() => {
    const box = lyricsBox.current;
    if (!box) return undefined;
    const forwarded = new WeakSet<Event>();
    const onWheel = (event: WheelEvent) => {
      if (forwarded.has(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!interactive) return;
      for (const player of box.querySelectorAll('.amll-lyric-player')) {
        const { deltaX, deltaY, deltaMode } = event;
        const copy = new WheelEvent('wheel', { deltaX, deltaY, deltaMode, cancelable: true });
        forwarded.add(copy);
        player.dispatchEvent(copy);
      }
    };
    box.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => box.removeEventListener('wheel', onWheel, true);
  }, [ready, interactive]);

  useEffect(() => {
    if (!locked || !hovering || hidden) {
      setReveal(false);
      return undefined;
    }
    const timer = setTimeout(() => setReveal(true), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [locked, hovering, hidden]);

  useLayoutEffect(() => {
    const box = reveal ? unlock.current?.getBoundingClientRect() : undefined;
    const keep: PopupRect | null = box
      ? { x: box.left, y: box.top, width: box.width, height: box.height }
      : null;
    popup.setClickThrough(locked || hidden, keep);
  }, [popup, locked, hidden, reveal]);

  const fontSize = view?.fontSize ?? 34;
  const translationFontSize = translationFontSizeOf(fontSize);
  const showTranslation = view?.showTranslation ?? true;
  const showRomanization = view?.showRomanization ?? false;
  useDesktopLayout(popup, lyricsBox, {
    single,
    locked,
    multilineSize: view?.multilineSize ?? null,
    lines,
    lyricsWidth: viewport?.width ?? 0,
    fontSize,
    showTranslation,
    showRomanization,
  });

  // 显示参数换了对象 AMLL 就重建歌词行；只在这几项变了时才换，改尺寸、悬停引起的重渲染不碰它
  const display = useMemo<LyricsDisplay>(
    () => ({
      ...DEFAULT_LYRICS_DISPLAY,
      fontSize,
      translationFontSize,
      showTranslation,
      showRomanization,
      align,
    }),
    [fontSize, translationFontSize, showTranslation, showRomanization, align],
  );

  if (!view) return <div className={styles.window} />;
  const twoTone = view.sung !== null;
  const masked = (hovering || viewport?.resizing) && !locked && !hidden;
  const style: CSSProperties & Record<`--${string}`, string> = {
    '--plate-alpha': `${Math.round(view.plateOpacity * 100)}%`,
    '--mask-alpha': `${Math.round(Math.max(view.plateOpacity, 0.45) * 100)}%`,
    ...(view.tint ? { '--plate-color': view.tint } : {}),
    ...(view.sung ? { '--sung': view.sung } : {}),
    ...(view.unsung ? { '--unsung': view.unsung } : {}),
    ...(view.glow ? { '--glow': view.glow } : {}),
    '--title-size': `${Math.round(fontSize * 0.82)}px`,
    '--single-padding-x': `${SINGLE_PADDING_X}px`,
  };
  const title = [view.title, view.artist].filter(Boolean).join(' — ');
  const fallback = <p className={styles.title}>{title}</p>;
  const active = !hidden && !viewport?.resizing && state === 'playing';
  const lyricsStyle: CSSProperties | undefined = viewport
    ? {
        width: viewport.width,
        height: `calc(${viewport.height}px - var(--spacingVerticalXL) * 2)`,
      }
    : undefined;
  const player = (layer: 'base' | 'sung') =>
    lines && (
      <div className={styles.layer} data-layer={layer}>
        <LyricsPlayer
          lines={lines}
          fallback={layer === 'base' ? fallback : null}
          motion={motion}
          clock={clock}
          active={active}
          fontSize={fontSize}
          display={display}
          offset={view.offset}
          scrollable={!single}
          onSeek={
            interactive && layer === 'base' && payload
              ? (seconds) => {
                  if (!suppressSeek.current) popup.send({ type: 'seek', id: payload.id, seconds });
                }
              : undefined
          }
        />
      </div>
    );
  return (
    <div
      className={styles.window}
      style={style}
      data-locked={locked || undefined}
      data-hidden={hidden || undefined}
      data-resizing={viewport?.resizing || undefined}
      data-mask={masked || undefined}
      data-plate={view.plate || undefined}
      data-align={align}
      data-single={single || undefined}
      data-interactive={interactive || undefined}
      data-two-tone={twoTone || undefined}
      onPointerEnter={hover.onPointerEnter}
      onPointerMove={hover.onPointerMove}
      onPointerDown={hover.onPointerDown}
      // 弹窗不接键盘，按下时不让按键拿焦点：WebView 要焦点会引出宿主对不抢焦点窗口的激活与撤销，
      // 其间鼠标的抓取可能被打断，松开到不了页面，这一下就不算点击
      onMouseDown={(event) => event.preventDefault()}
      onPointerLeave={hover.onPointerLeave}
    >
      <div className={styles.backdrop} />
      <div className={styles['toolbar-row']}>
        {locked ? (
          <Tooltip content={view.labels.unlock} relationship="label">
            <button
              ref={unlock}
              type="button"
              className={styles.unlock}
              data-shown={(reveal && !hidden) || undefined}
              onClick={() => popup.send({ type: 'lock', locked: false })}
            >
              <LockOpen16Regular />
            </button>
          </Tooltip>
        ) : (
          <Toolbar view={view} popup={popup} playing={state === 'playing'} />
        )}
      </div>
      <div ref={area} className={styles.area}>
        <div
          ref={lyricsBox}
          className={styles.lyrics}
          style={lyricsStyle}
          onPointerDownCapture={(event) => {
            if (!interactive || event.button !== 0) return;
            suppressSeek.current = false;
            gesture.current = {
              id: event.pointerId,
              x: event.screenX,
              y: event.screenY,
              dragging: false,
            };
          }}
          onPointerMoveCapture={(event) => {
            const current = gesture.current;
            if (!current || current.id !== event.pointerId || !(event.buttons & 1)) return;
            const x = event.screenX - current.x;
            const y = event.screenY - current.y;
            if (!current.dragging && Math.hypot(x, y) < 4) return;
            if (!current.dragging) {
              current.dragging = true;
              suppressSeek.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              popup.beginDrag();
            }
            popup.dragBy(x, y);
          }}
          onPointerUpCapture={() => {
            gesture.current = null;
            popup.endDrag();
          }}
          onPointerCancel={() => {
            gesture.current = null;
            popup.endDrag();
          }}
          onLostPointerCapture={() => {
            gesture.current = null;
            popup.endDrag();
          }}
        >
          {lines ? (
            <>
              {player('base')}
              {twoTone && player('sung')}
            </>
          ) : (
            fallback
          )}
        </div>
      </div>
    </div>
  );
}
