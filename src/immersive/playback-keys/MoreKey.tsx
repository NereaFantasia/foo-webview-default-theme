import { Button, Tooltip, mergeClasses } from '@fluentui/react-components';
import { MoreHorizontal24Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { NowPlayingMenu } from '../../playback/now-playing/NowPlayingMenu.tsx';
import { useNowPlayingMenu } from '../../playback/now-playing/useNowPlayingMenu.ts';
import { currentTrackAtom } from '../../playback/playback.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import type { TrackMenuItem } from '../../track/trackMenuEntries.ts';
import { keyClass, useKeyStyles } from './keyStyles.ts';
import type { KeysProps } from './Transport.tsx';
import styles from './Transport.module.css';

/** 上下文菜单触发范围；仅作用于按键自身 */
const SCOPE = { anchor: () => null, accepts: () => true };

export interface MoreKeyProps extends KeysProps {
  /** 顶部追加的前置菜单项（如侧栏展开/收起），后接内置分隔线 */
  readonly extraItems?: readonly TrackMenuItem[];
}

/**
 * 沉浸模式当前曲目更多操作控制键
 *
 * 弹出曲目快捷菜单（含评级、停止、发送到及宿主菜单）；未连接宿主或无有效曲目时置灰
 */
export function MoreKey({ size = 'regular', extraItems }: MoreKeyProps) {
  const t = useAtomValueRawSync(translateAtom);
  const track = useAtomValueRawSync(currentTrackAtom);
  const classes = useKeyStyles();
  const controls = useViewControlStyles();
  const menu = useNowPlayingMenu(track, SCOPE);
  return (
    <span className={styles.group} data-scene-element="more">
      <Tooltip content={t('player.more')} relationship="label">
        <Button
          appearance="subtle"
          shape="rounded"
          className={mergeClasses(keyClass(classes, size), controls.icon)}
          icon={<MoreHorizontal24Regular />}
          {...menu.more}
        />
      </Tooltip>
      <NowPlayingMenu at={menu.at} extraItems={extraItems} onClose={menu.close} />
    </span>
  );
}
