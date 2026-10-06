import type { PlaybackOrder } from 'foo-webview-sdk';
import type { MessageKey } from '../i18n/en.ts';

/** 七种播放顺序，名字取自 SDK。fb2k 里它是七选一的枚举，不是「乱序 × 重复」两个开关。 */
export type OrderName = PlaybackOrder;

/** 菜单自上而下的顺序，与宿主的顺序编号 0–6 同序：`playback:orderChanged` 只带编号，按它回查名字。 */
export const ORDER_IDS: readonly OrderName[] = [
  'default',
  'repeat-playlist',
  'repeat-track',
  'random',
  'shuffle-tracks',
  'shuffle-albums',
  'shuffle-folders',
];

/** 存键不存文字：语言随时可切，用到它的菜单跟着换。 */
export const ORDER_LABEL_KEYS: Readonly<Record<OrderName, MessageKey>> = {
  default: 'order.default',
  'repeat-playlist': 'order.repeatPlaylist',
  'repeat-track': 'order.repeatTrack',
  random: 'order.random',
  'shuffle-tracks': 'order.shuffleTracks',
  'shuffle-albums': 'order.shuffleAlbums',
  'shuffle-folders': 'order.shuffleFolders',
};

export function isOrderName(value: unknown): value is OrderName {
  return typeof value === 'string' && ORDER_IDS.some((id) => id === value);
}
