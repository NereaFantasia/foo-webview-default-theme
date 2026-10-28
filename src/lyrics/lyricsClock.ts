import { serviceKey } from '../kit/serviceKey.ts';
import type { LyricsClockFace } from './lyricsDriver.ts';

/** 歌词播放时钟与行跳转服务接口；供沉浸视图等独立歌词组件驱动 LyricsPlayer */
export interface LyricsClockAccess {
  readonly clock: LyricsClockFace;
  /**
   * 跳转至指定行起始播放时间，单位秒
   * key 标识歌词所属曲目：曲目已切换、宿主未就绪或曲目不支持跳转时静默忽略；跳转后自动对齐时钟
   */
  seek(key: string, seconds: number): Promise<void>;
}

export const lyricsClockKey = serviceKey<LyricsClockAccess>('lyricsClock');
