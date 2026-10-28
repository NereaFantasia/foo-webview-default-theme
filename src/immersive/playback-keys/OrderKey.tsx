import { useAtomValueRawSync } from 'jotai/react';
import { OrderMenuButton } from '../../playback/order/OrderMenuButton.tsx';
import { playbackConnectedAtom } from '../../playback/playerAtoms.ts';
import { ORDER_KEY_ICONS_XLARGE } from '../../playback/playerIcons.ts';
import { keyClass, useKeyStyles } from './keyStyles.ts';
import type { KeysProps } from './Transport.tsx';
import styles from './Transport.module.css';

/**
 * 播放顺序切换键
 *
 * 图标状态同步当前播放模式，左键点击或右键打开模式选择菜单；选择后向宿主发送切换命令，待宿主状态同步后再更新图标；
 * 复用 OrderMenuButton 核心逻辑并配置沉浸视图尺寸规格与按键外观
 */
export function OrderKey({ size = 'regular' }: KeysProps) {
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  const classes = useKeyStyles();
  return (
    <span className={styles.group} data-scene-element="order">
      <OrderMenuButton
        className={keyClass(classes, size)}
        disabled={!connected}
        keyIcons={ORDER_KEY_ICONS_XLARGE}
      />
    </span>
  );
}
