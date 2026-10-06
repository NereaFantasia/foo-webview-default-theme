import { Button, Tooltip, makeStyles, mergeClasses } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { useCommand } from '../../../nav/useCommand.ts';
import { roleVar } from '../../../theme/roles.ts';
import { volumeDbAtom } from '../../../playback/playback.ts';
import { playbackConnectedAtom, playbackMutedAtom } from '../../../playback/playerAtoms.ts';
import { PLAYER_KEY_ATTR } from '../playerFocus.ts';
import { VOLUME_ICONS, VOLUME_ICONS_LARGE } from '../playerIcons.ts';
import {
  stepBase,
  steppedPosition,
  VOLUME_SETTLE_MS,
  VOLUME_SETTLE_TOLERANCE,
  volumeLevel,
  type VolumeSender,
} from './volumeControl.ts';
import { clamp, dbOf, positionOf, type VolumeScale } from '../../../playback/volumeScale.ts';
import { useVolumePreview } from './useVolumePreview.ts';
import styles from './VolumeSlider.module.css';
import { createWheelStepper, type WheelInput } from './wheelSteps.ts';
import { useService } from '../../../kit/useService.ts';
import { playbackKey } from '../../../playback/playbackContract.ts';

// 静音键：面板里与图标列同宽 16，浮层里 24（图标 16 居中，与设备行的图标对齐），底部通栏里是 36 的键、图标 20。
const useStyles = makeStyles({
  mute: { padding: '0', color: roleVar('text-secondary') },
  panel: { minWidth: '16px', width: '16px', height: '16px' },
  flyout: { minWidth: '24px', width: '24px', height: '24px' },
  bar: { minWidth: '36px', width: '36px', height: '36px' },
});

/**
 * 三种样子。`panel`、`flyout` 的根就是外面给的那一行网格（`className`），静音键、滑条与数值依次落进图标列、
 * 滑条列、数值列，与同一处的设备行同一套列（`VolumeStack`）。`bar` 自成一排：36 的静音键、隔 6、96 宽的轨道。
 */
export type VolumeSliderVariant = 'panel' | 'flyout' | 'bar';

/** 拖动中与松手后等宿主追上时显示的位置（0–100）。 */
interface VolumeDraft {
  readonly value: number;
  readonly settling: boolean;
}

export interface VolumeSliderProps {
  readonly sender: VolumeSender;
  readonly scale: VolumeScale;
  /** 浮层里在滑条右边写出音量数值（0–100）；轨道上的滑块面板里 12、浮层里 16，通栏里不画。 */
  readonly variant: VolumeSliderVariant;
  /** 挂在根上；`panel`、`flyout` 用它把根排成外面那一行的网格。 */
  readonly className?: string;
  /** 拖动开始与结束；外面的浮层据此在拖动中不收起。 */
  onDragChange?(dragging: boolean): void;
}

/**
 * 音量一栏：静音键加滑条，浮层里另写数值。滑条上的位置按音量刻度（`volumeScale.ts`）与 dB 互换；拖动中
 * 实时提交、不回读，松手那一下提交并回读，全经 `sender` 排队发。← / → 每下挪一个位置单位；整行上的滚轮
 * 鼠标一格一个单位，触控板攒满一格才挪（`wheelSteps.ts`）。拖动状态挂在滑条自己身上。通栏（`bar`）里的条
 * 不写数值，悬停、拖动与滚轮时在提示里写，滚轮时写的是调到的值（`useVolumePreview`）。
 */
export function VolumeSlider({
  sender,
  scale,
  variant,
  className,
  onDragChange,
}: VolumeSliderProps) {
  const t = useAtomValueRawSync(translateAtom);
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  const volumeDb = useAtomValueRawSync(volumeDbAtom);
  const muted = useAtomValueRawSync(playbackMutedAtom);
  const playback = useService(playbackKey);
  const classes = useStyles();
  const instance = useId();
  const hit = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<VolumeDraft | null>(null);
  const [stepper] = useState(createWheelStepper);
  const { preview, show } = useVolumePreview();
  const [tip, setTip] = useState(false);
  const finish = useRef<(() => void) | null>(null);
  const latestDrag = useRef(onDragChange);
  useLayoutEffect(() => {
    latestDrag.current = onDragChange;
  });
  useLayoutEffect(() => () => finish.current?.(), []);

  // 松手后接着显示拖到的位置，等宿主报回的音量追上（或等够时限）再交还，滑块不先跳回一两步前的值。
  const hostPosition = positionOf(volumeDb, scale);
  if (draft?.settling && Math.abs(hostPosition - draft.value) < VOLUME_SETTLE_TOLERANCE) {
    setDraft(null);
  }
  useEffect(() => {
    if (!draft?.settling) return;
    const timer = setTimeout(() => setDraft(null), VOLUME_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [draft]);

  const position = draft?.value ?? hostPosition;
  const Icon = (variant === 'bar' ? VOLUME_ICONS_LARGE : VOLUME_ICONS)[
    volumeLevel(position, muted)
  ];

  const step = (steps: number) => {
    const base = positionOf(stepBase(sender, volumeDb), scale);
    return dbOf(steppedPosition(base, steps), scale);
  };

  const press = (event: PointerEvent<HTMLDivElement>) => {
    if (!connected || event.button !== 0 || finish.current) return;
    const element = event.currentTarget;
    const pointerId = event.pointerId;
    const box = element.getBoundingClientRect();
    const at = (clientX: number) =>
      box.width > 0 ? clamp(((clientX - box.left) / box.width) * 100, 0, 100) : 0;
    let value = at(event.clientX);
    event.preventDefault();
    element.focus();
    element.setPointerCapture(pointerId);
    setDraft({ value, settling: false });
    sender.live(dbOf(value, scale));
    latestDrag.current?.(true);
    const move = (moved: globalThis.PointerEvent) => {
      value = at(moved.clientX);
      setDraft({ value, settling: false });
      sender.live(dbOf(value, scale));
    };
    const end = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', end);
      element.removeEventListener('pointercancel', end);
      element.removeEventListener('lostpointercapture', end);
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      finish.current = null;
      sender.commit(dbOf(value, scale));
      setDraft({ value, settling: true });
      latestDrag.current?.(false);
    };
    finish.current = end;
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    element.addEventListener('lostpointercapture', end);
  };

  const volumeKey = (key: string, direction: number) => ({
    id: `player.volume${instance}.${key}`,
    layer: 'widget' as const,
    keys: [{ key }],
    enabled: () =>
      connected &&
      finish.current === null &&
      hit.current !== null &&
      document.activeElement === hit.current,
    run: () => {
      setDraft(null);
      sender.commit(step(direction));
    },
  });
  useCommand(volumeKey('ArrowLeft', -1));
  useCommand(volumeKey('ArrowDown', -1));
  useCommand(volumeKey('ArrowRight', 1));
  useCommand(volumeKey('ArrowUp', 1));

  const onWheel = (event: WheelInput) => {
    if (!connected || finish.current) return;
    const steps = stepper(event);
    if (steps === 0) return;
    setDraft(null);
    const target = step(steps);
    sender.live(target);
    show(positionOf(target, scale));
  };

  const shown = Math.round(position);
  const dragging = draft !== null && !draft.settling;
  const slider = (
    <div
      ref={hit}
      className={styles.hit}
      role="slider"
      tabIndex={connected ? 0 : -1}
      aria-label={t('player.volume')}
      aria-disabled={!connected || undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={shown}
      data-dragging={dragging || undefined}
      {...{ [PLAYER_KEY_ATTR]: 'volume-slider' }}
      onPointerDown={press}
    >
      <div className={styles.rail}>
        <div className={styles.fill} style={{ transform: `scaleX(${position / 100})` }} />
      </div>
      {variant !== 'bar' && <div className={styles.thumb} style={{ left: `${position}%` }} />}
    </div>
  );
  return (
    <div className={`${styles.root} ${className ?? ''}`} data-variant={variant} onWheel={onWheel}>
      <Tooltip content={muted ? t('player.unmute') : t('player.mute')} relationship="label">
        <Button
          appearance="subtle"
          className={mergeClasses(classes.mute, classes[variant])}
          icon={<Icon />}
          disabled={!connected}
          aria-pressed={muted}
          {...{ [PLAYER_KEY_ATTR]: 'mute' }}
          onClick={() => void playback.toggleMute()}
        />
      </Tooltip>
      {/* 通栏里的条不写数值：悬停、拖动、滚轮时提示里写，读屏照旧念 aria-valuenow。 */}
      {variant === 'bar' ? (
        <Tooltip
          content={String(dragging ? shown : (preview ?? shown))}
          relationship="inaccessible"
          visible={tip || dragging || preview !== null}
          onVisibleChange={(_, data) => setTip(data.visible)}
        >
          {slider}
        </Tooltip>
      ) : (
        slider
      )}
      {variant === 'flyout' && <span className={styles.value}>{shown}</span>}
    </div>
  );
}
