import { useAtomValueRawSync } from 'jotai/react';
import { useCallback, useId, useRef, type PointerEvent } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useCommand } from '../../nav/useCommand.ts';
import { playbackAtom } from '../../playback/playback.ts';
import { trackKeyOf, playbackKey } from '../../playback/playbackContract.ts';
import { handOffPlayerFocus, PLAYER_KEY_ATTR } from './playerFocus.ts';
import styles from './SeekBar.module.css';
import { clockText, keySeek, secondsAt, shownSeconds } from '../../playback/seekDraft.ts';
import { useSeekGesture } from './useSeekGesture.ts';
import { useService } from '../../kit/useService.ts';

export interface SeekBarProps {
  /** 能点能拖、能用键盘；为假时只显示。 */
  readonly interactive: boolean;
  /** 线的粗细，CSS 像素。 */
  readonly thickness: number;
  /** 在播到的位置画一个滑块。 */
  readonly thumb?: boolean;
  /** 线的左边写播到的时间、右边写总长；拖动中左边跟着拖到的位置。 */
  readonly clock?: boolean;
  /** 时间先不露出来（`clock` 时）：悬停态之外的正在播放条与胶囊。版式不换，线照旧占满。 */
  readonly clockHidden?: boolean;
  /** 命中区撑满外面给的高度，线在正中（悬停态）。 */
  readonly fill?: boolean;
  /** 命中区往哪边伸：缺省上下各 8；`down` 往上只留 2（上面紧挨着一行字）；`up` 往下只留 2（下面就是外缘）。 */
  readonly reach?: 'even' | 'down' | 'up';
  /** 不能 seek 时在线的位置写这句话、不画线，右边不写总长；不给就照旧画一条置灰的线。 */
  readonly note?: string;
  /** 挂在最外层：写时间时是时间与线的那一行，否则是线本身。 */
  readonly className?: string;
  /** 拖动开始与结束（含放弃）。 */
  onDragChange?(dragging: boolean): void;
  /** 指针停在线上时，指针处是第几秒、指针的横坐标（CSS 像素）；离开线或拖起来时是 null。 */
  onHover?(seconds: number | null, clientX: number): void;
}

/**
 * 进度线：轨道取分隔线色，已播的一段取主色；时间与滑块按需画。停止时整条不画。
 *
 * 能交互时它是一个 slider：点哪跳哪，按住拖动、松手才 seek，拖动中 Esc 或按下右键放弃（`useSeekGesture`）。
 * 键盘 ← / → 各 5 秒，Home 回到开头。宿主说这一首不能 seek（网络流等）时不接指针也不接键，标 `aria-disabled`。
 * 拖动状态挂在命中区自己身上。
 */
export function SeekBar(props: SeekBarProps) {
  const { interactive, thickness, thumb = false, clock = false, className } = props;
  const t = useAtomValueRawSync(translateAtom);
  const { track, position, duration, canSeek } = useAtomValueRawSync(playbackAtom);
  const playback = useService(playbackKey);
  // 命令按 id 登记，同名的会顶替；两套播放栏换形态时新旧两条同时在，各用各的。
  const instance = useId();
  const hit = useRef<HTMLDivElement | null>(null);
  // 停止时整条卸下，焦点在它上面就交给播放键。
  const attachHit = useCallback((node: HTMLDivElement | null) => {
    hit.current = node;
    const handOff = handOffPlayerFocus(node);
    return () => {
      handOff?.();
      hit.current = null;
    };
  }, []);
  const enabled = interactive && canSeek && duration > 0;
  const gesture = useSeekGesture({
    enabled,
    duration,
    position,
    trackKey: trackKeyOf(track),
    seek: (seconds) => void playback.seek(seconds),
    onDragChange: (dragging) => {
      if (dragging) props.onHover?.(null, 0);
      props.onDragChange?.(dragging);
    },
  });
  const { draft } = gesture;
  const dragging = draft.phase === 'dragging';

  useCommand({
    id: `player.seek${instance}.cancel`,
    layer: 'gesture',
    keys: [{ key: 'Escape' }],
    enabled: () => hit.current?.hasAttribute('data-dragging') ?? false,
    run: () => void gesture.cancel(),
  });
  const seekKey = (key: string) => ({
    id: `player.seek${instance}.${key}`,
    layer: 'widget' as const,
    keys: [{ key }],
    enabled: () => enabled && hit.current !== null && document.activeElement === hit.current,
    run: () => {
      const next = keySeek(key, shownSeconds(draft, position), duration);
      if (next !== null) gesture.seekTo(next);
    },
  });
  useCommand(seekKey('ArrowLeft'));
  useCommand(seekKey('ArrowRight'));
  useCommand(seekKey('Home'));

  const hover = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || dragging || !props.onHover) return;
    const box = event.currentTarget.getBoundingClientRect();
    props.onHover(secondsAt(event.clientX, box.left, box.width, duration), event.clientX);
  };

  if (!track) return null;
  const shown = shownSeconds(draft, position);
  const fraction = duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0;
  const note = !enabled && props.note ? props.note : null;
  const groove = (
    <div className={styles.track} style={{ height: thickness }}>
      <div className={styles.fill} style={{ transform: `scaleX(${fraction})` }} />
    </div>
  );
  // 轨道要裁掉已播那一段的圆角外沿，滑块只好与它并排放在一层定位盒里。
  // 没有时长（网络流之类）时不画滑块：它只会钉在最左边。
  const line = note ? (
    <span className={styles.note}>{note}</span>
  ) : thumb && duration > 0 ? (
    <div className={styles.rail}>
      {groove}
      <div className={styles.thumb} style={{ left: `${fraction * 100}%` }} />
    </div>
  ) : (
    groove
  );
  const outer = clock ? '' : (className ?? '');
  const bar = interactive ? (
    <div
      ref={attachHit}
      className={`${styles.hit} ${outer}`}
      role="slider"
      tabIndex={enabled ? 0 : -1}
      aria-label={t('player.seek')}
      aria-disabled={!enabled || undefined}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={t('player.seekValue', {
        position: clockText(shown),
        duration: clockText(duration),
      })}
      data-dragging={dragging || undefined}
      data-reach={props.reach}
      {...{ [PLAYER_KEY_ATTR]: 'seek' }}
      onPointerDown={gesture.press}
      onPointerMove={hover}
      onPointerLeave={() => props.onHover?.(null, 0)}
    >
      {line}
    </div>
  ) : (
    <div className={`${styles.passive} ${outer}`}>{line}</div>
  );
  if (!clock) return bar;
  // 两边按总长的位数留宽：播到 10:00 这类进位时左边不变宽，线也就不挪位，拖动中按下时量的盒子一直对。
  const total = duration > 0 && !note ? clockText(duration) : '';
  const clockWidth = { minWidth: `${Math.max(total.length, clockText(shown).length)}ch` };
  return (
    <div
      className={`${styles.timed} ${className ?? ''}`}
      data-fill={props.fill || undefined}
      data-clock-hidden={props.clockHidden || undefined}
      data-dragging={dragging || undefined}
    >
      {/* 读屏从 slider 的 aria-valuetext 念时间，这两处只给眼睛看。 */}
      <span className={styles.clock} style={clockWidth} aria-hidden data-seek-clock="position">
        {clockText(shown)}
      </span>
      {bar}
      <span className={styles.clock} style={clockWidth} aria-hidden data-seek-clock="duration">
        {total}
      </span>
    </div>
  );
}
