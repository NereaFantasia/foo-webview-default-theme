import { Button, Tooltip, mergeClasses } from '@fluentui/react-components';
import {
  Next24Regular,
  Pause24Filled,
  Play24Filled,
  Previous24Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import type { ReactElement } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { noteSkip } from '../../playback/now-playing/trackSwap.ts';
import { currentTrackAtom } from '../../playback/playback.ts';
import { playbackKey } from '../../playback/playbackContract.ts';
import { playbackConnectedAtom } from '../../playback/playerAtoms.ts';
import { playingAudibleAtom } from '../../playback/playingTrack.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { keyClass, useKeyStyles, type KeySize } from './keyStyles.ts';
import { SwapIcon } from './SwapIcon.tsx';
import styles from './Transport.module.css';

export interface KeysProps {
  /** 播控按键尺寸档位，默认为 regular（40px） */
  readonly size?: KeySize;
}

/**
 * 沉浸模式核心播控三键组（上一首、播放/暂停、下一首）
 *
 * 播放状态严格对齐宿主反馈而不采用乐观更新，上一首与下一首触发时记录跳曲方向以联动切歌翻转动效；
 * 未连接宿主时全组禁用，已连接但停止播放时上一首与下一首置灰
 */
export function Transport({ size = 'regular' }: KeysProps) {
  const t = useAtomValueRawSync(translateAtom);
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  const audible = useAtomValueRawSync(playingAudibleAtom);
  const track = useAtomValueRawSync(currentTrackAtom);
  const playback = useService(playbackKey);
  const store = useStore();
  const classes = useKeyStyles();
  const controls = useViewControlStyles();
  const skipDisabled = !connected || track === null;
  const key = mergeClasses(keyClass(classes, size), controls.icon);
  return (
    <div
      className={styles.group}
      role="group"
      aria-label={t('player.controls')}
      data-scene-element="transport"
    >
      <Key
        name="previous"
        label={t('player.previous')}
        icon={<Previous24Regular />}
        className={key}
        disabled={skipDisabled}
        onClick={() => {
          noteSkip(store, 'previous');
          void playback.previous();
        }}
      />
      <Key
        name="play"
        label={audible ? t('player.pause') : t('player.play')}
        icon={
          <SwapIcon id={audible ? 'pause' : 'play'}>
            {audible ? <Pause24Filled /> : <Play24Filled />}
          </SwapIcon>
        }
        className={mergeClasses(key, classes.primary)}
        disabled={!connected}
        onClick={() => void playback.playOrPause()}
      />
      <Key
        name="next"
        label={t('player.next')}
        icon={<Next24Regular />}
        className={key}
        disabled={skipDisabled}
        onClick={() => {
          noteSkip(store, 'next');
          void playback.next();
        }}
      />
    </div>
  );
}

interface KeyProps {
  readonly name: string;
  readonly label: string;
  readonly icon: ReactElement;
  readonly className: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}

function Key({ name, label, icon, className, disabled, onClick }: KeyProps) {
  return (
    <Tooltip content={label} relationship="label">
      <Button
        appearance="subtle"
        shape="rounded"
        className={className}
        icon={icon}
        disabled={disabled}
        data-key={name}
        onClick={onClick}
      />
    </Tooltip>
  );
}
