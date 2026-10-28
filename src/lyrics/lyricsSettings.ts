import { serviceKey } from '../kit/serviceKey.ts';

/** 跳转至设置页歌词分组的服务接口；由 app 装配注入，供沉浸视图等独立歌词组件导航 */
export interface LyricsSettingsOpener {
  open(): void;
}

export const lyricsSettingsKey = serviceKey<LyricsSettingsOpener>('lyricsSettings');
