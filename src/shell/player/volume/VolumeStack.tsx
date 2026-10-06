import { Tooltip } from '@fluentui/react-components';
import {
  ChevronDown12Regular,
  ChevronDown16Regular,
  ChevronUp12Regular,
  ChevronUp16Regular,
  SpeakerBox16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { ReactNode, Ref } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { outputDevicesAtom } from './outputDevices.ts';
import { PLAYER_KEY_ATTR } from '../playerFocus.ts';
import type { VolumeSender } from './volumeControl.ts';
import type { VolumeScale } from '../../../playback/volumeScale.ts';
import styles from './VolumeStack.module.css';
import { VolumeSlider } from './VolumeSlider.tsx';

export interface VolumeStackProps {
  /** `panel` 是标题栏里 44 高的输出面板，`flyout` 是朝上弹出的音量浮层。 */
  readonly variant: 'panel' | 'flyout';
  readonly sender: VolumeSender;
  readonly scale: VolumeScale;
  /** 设备列表开着：设备行的箭头朝上，`aria-expanded` 为真。 */
  readonly deviceExpanded: boolean;
  /** 设备行本身：面板把设备列表贴着它弹出，选完设备焦点回到它上面。 */
  readonly deviceRef?: Ref<HTMLButtonElement>;
  /** 设备行下面接着放的东西：浮层里原地展开的设备列表。 */
  readonly children?: ReactNode;
  onDeviceToggle(): void;
  onDragChange?(dragging: boolean): void;
}

/**
 * 音量一栏在上、设备一栏在下，两行共用一套列：图标列、内容列、行尾列。静音键与设备图标落在同一列，滑条与
 * 设备名从同一条线起，滑条（或数值）与箭头收在同一条右缘。面板里两行各 18 高、隔 2，设备名 12 / 600 后接
 * 输出模块；浮层里两行各 40 高、隔 2 且中间一道分隔线，设备名 13，输出模块写在悬停提示里。设备行点了开合
 * 设备列表。还没读到当前设备时写「输出设备」。整个音量行上都能用滚轮调音量。
 */
export function VolumeStack(props: VolumeStackProps) {
  const { variant, deviceExpanded } = props;
  const t = useAtomValueRawSync(translateAtom);
  const { current } = useAtomValueRawSync(outputDevicesAtom);
  const name = current?.name ?? t('player.outputDevice');
  const module = current?.outputName ?? '';
  const tip = module ? t('player.deviceTip', { name, output: module }) : name;
  const panel = variant === 'panel';
  let Chevron = deviceExpanded ? ChevronUp16Regular : ChevronDown16Regular;
  if (panel) Chevron = deviceExpanded ? ChevronUp12Regular : ChevronDown12Regular;
  return (
    <div className={styles.root} data-variant={variant}>
      <VolumeSlider
        className={styles.row}
        sender={props.sender}
        scale={props.scale}
        variant={variant}
        onDragChange={props.onDragChange}
      />
      {!panel && <div className={styles.divider} aria-hidden />}
      <Tooltip content={tip} relationship="description">
        <button
          ref={props.deviceRef}
          type="button"
          className={`${styles.row} ${styles.device}`}
          aria-expanded={deviceExpanded}
          {...{ [PLAYER_KEY_ATTR]: 'output' }}
          onClick={props.onDeviceToggle}
        >
          <SpeakerBox16Regular className={styles.icon} aria-hidden />
          <span className={styles.label}>
            <span className={styles.name}>{name}</span>
            {panel && module && <span className={styles.module}>{module}</span>}
          </span>
          <Chevron className={styles.chevron} aria-hidden />
        </button>
      </Tooltip>
      {props.children}
    </div>
  );
}
