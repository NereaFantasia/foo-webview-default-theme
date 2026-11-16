import { serviceKey } from '../kit/serviceKey.ts';

export type LyricsView = 'main' | 'immersive';

/** 打开设置页「歌词」分区的服务，由 `app/` 装配。沉浸视图等不在设置页中的歌词组件经它跳转 */
export interface LyricsSettingsOpener {
  open(): void;
}

export const lyricsSettingsKey = serviceKey<LyricsSettingsOpener>('lyricsSettings');
