import {
  Button,
  Tooltip,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import {
  Next24Regular,
  Pause24Filled,
  Play24Filled,
  Previous24Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import { useState, type CSSProperties, type FocusEvent, type ReactElement } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { playbackAtom } from '../../playback/playback.ts';
import { playbackConnectedAtom } from '../../playback/playerAtoms.ts';
import { controlsVisibleAtom } from '../page/immersiveShell.ts';
import { useViewServices } from '../page/viewServices.ts';
import styles from './PaperTransport.module.css';

/** 只随播放态变：`playbackAtom` 每 100 ms 随进度更新一次，整份读会让三颗键跟着重画。 */
const playingAtom = atom((get) => get(playbackAtom).state === 'playing');

/** 不给 `size` 时的原尺寸，单位像素：两侧键 56、中键 80、整组 240 宽，都乘 `scale`。 */
const BASE_SIZE = { side: 56, play: 80, width: 240 } as const;

const RING = 'var(--paper-ring)';
/** 按下态的选择器，与 Fluent `Button` 样式里的逐字相同：合并类名时同一选择器的同一属性才会被顶掉。 */
const PRESSED = ':hover:active,:active:focus-visible';

// 键径取根上的 --side / --play，图标按原尺寸的比例（24 / 56、32 / 80）跟着键径缩放。
// Fluent 的 transparent 键悬停、按下时会换品牌色并撤掉底色，这组键三态钉成同一套颜色。
// 禁用时两侧键留着环线、中键换成禁用底色，字色与图标色交给 Fluent 的禁用样式。
const useStyles = makeStyles({
  side: {
    width: 'var(--side)',
    minWidth: 'var(--side)',
    maxWidth: 'var(--side)',
    height: 'var(--side)',
    padding: '0',
    ...shorthands.borderColor(RING),
    ':hover': shorthands.borderColor(RING),
    [PRESSED]: shorthands.borderColor(RING),
  },
  sideLive: {
    color: tokens.colorNeutralForeground1,
    ':hover': { color: tokens.colorNeutralForeground1 },
    [PRESSED]: { color: tokens.colorNeutralForeground1 },
  },
  // 中键实心：底取中性前景色、图标反过来取底色，不用品牌色。
  play: {
    width: 'var(--play)',
    minWidth: 'var(--play)',
    maxWidth: 'var(--play)',
    height: 'var(--play)',
    padding: '0',
    ...shorthands.borderWidth('0'),
  },
  playLive: {
    backgroundColor: tokens.colorNeutralForeground2,
    color: tokens.colorNeutralBackground1,
    ':hover': {
      backgroundColor: tokens.colorNeutralForeground2,
      color: tokens.colorNeutralBackground1,
    },
    [PRESSED]: {
      backgroundColor: tokens.colorNeutralForeground2,
      color: tokens.colorNeutralBackground1,
    },
  },
  playOff: {
    backgroundColor: tokens.colorNeutralBackgroundDisabled,
    ':hover': { backgroundColor: tokens.colorNeutralBackgroundDisabled },
    [PRESSED]: { backgroundColor: tokens.colorNeutralBackgroundDisabled },
  },
  sideIcon: {
    width: 'calc(var(--side) * 3 / 7)',
    height: 'calc(var(--side) * 3 / 7)',
    '& svg': { width: '100%', height: '100%' },
  },
  playIcon: {
    width: 'calc(var(--play) * 2 / 5)',
    height: 'calc(var(--play) * 2 / 5)',
    '& svg': { width: '100%', height: '100%' },
  },
});

interface KeyProps {
  readonly label: string;
  readonly icon: ReactElement;
  readonly className: string;
  readonly iconClassName: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}

function TransportKey({ label, icon, className, iconClassName, disabled, onClick }: KeyProps) {
  return (
    <Tooltip content={label} relationship="label">
      <Button
        shape="circular"
        appearance="transparent"
        className={className}
        icon={{ className: iconClassName, children: icon }}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      />
    </Tooltip>
  );
}

export interface PaperTransportProps {
  /** 两侧键与中键的直径、整组的宽，单位像素；给了就不看 `scale`。 */
  readonly size?: { side: number; play: number; width: number };
  /** `data-decor-guard` 的外扩，单位像素：生成式网格不在这组键周围这么远以内放装饰。 */
  readonly guard?: number;
  /** 不给 `size` 时原尺寸乘的倍数：版心档 1，紧凑档 0.8。 */
  readonly scale?: number;
  /** 这一组放在哪由外层定，定位经这两项传进来。 */
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * 罗盘下的三颗圆键：上一首、播放 / 暂停、下一首。这里只管键的大小与排布，放在哪由罗盘件定。
 * 播放键的图标与名字跟着宿主报的状态走；命令不做乐观更新，没连上宿主时三键禁用。
 *
 * 三颗键随控件层一起藏：控件层藏起时淡出且不接指针；用键盘把焦点移到其中一颗键上时不藏。
 */
export function PaperTransport({
  size,
  guard = 48,
  scale = 1,
  className,
  style,
}: PaperTransportProps) {
  const t = useAtomValueRawSync(translateAtom);
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  const playing = useAtomValueRawSync(playingAtom);
  const controlsVisible = useAtomValueRawSync(controlsVisibleAtom);
  const { playback } = useViewServices();
  const classes = useStyles();
  const [focused, setFocused] = useState(false);
  const { side, play, width } = size ?? {
    side: BASE_SIZE.side * scale,
    play: BASE_SIZE.play * scale,
    width: BASE_SIZE.width * scale,
  };
  const layout: CSSProperties & Record<`--${string}`, string> = {
    ...style,
    '--side': `${side}px`,
    '--play': `${play}px`,
    '--width': `${width}px`,
  };
  const disabled = !connected;
  const sideKey = mergeClasses(classes.side, !disabled && classes.sideLive);
  const shown = controlsVisible || focused;
  // 只有键盘带来的焦点算：鼠标点过的键会一直留着焦点，算上的话这组键就再也不藏了。
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target.matches(':focus-visible')) setFocused(true);
  };
  // 焦点在组内两颗键之间移动时不算离开，免得中间那一下把整组判成藏起。
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node && event.currentTarget.contains(next))) setFocused(false);
  };
  return (
    <div
      className={`${styles.transport} ${shown ? '' : styles.hidden} ${className ?? ''}`}
      style={layout}
      role="group"
      aria-label={t('player.controls')}
      data-decor-guard={guard}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <TransportKey
        label={t('player.previous')}
        icon={<Previous24Regular />}
        className={sideKey}
        iconClassName={classes.sideIcon}
        disabled={disabled}
        onClick={() => void playback.previous()}
      />
      <TransportKey
        label={playing ? t('player.pause') : t('player.play')}
        icon={playing ? <Pause24Filled /> : <Play24Filled />}
        className={mergeClasses(classes.play, disabled ? classes.playOff : classes.playLive)}
        iconClassName={classes.playIcon}
        disabled={disabled}
        onClick={() => void playback.playOrPause()}
      />
      <TransportKey
        label={t('player.next')}
        icon={<Next24Regular />}
        className={sideKey}
        iconClassName={classes.sideIcon}
        disabled={disabled}
        onClick={() => void playback.next()}
      />
    </div>
  );
}
