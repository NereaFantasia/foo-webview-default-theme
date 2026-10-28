import { PlaybackClock } from 'foo-webview-sdk/bridge';
import { serviceKey } from '../kit/serviceKey.ts';

/** 估算高频逐帧渲染所需的连续播放进度 */
export interface PositionClockService extends Pick<PlaybackClock, 'position' | 'resync'> {
  /** 初始宿主播放位置读取完成时兑现，不会拒绝 */
  readonly ready: Promise<void>;
  dispose(): void;
}

/**
 * 基于 SDK PlaybackClock 按 hostTime 对齐约 100 ms 一拍的高频进度，并在帧间按速率插值估计
 * 跳播、切歌、状态变更及页面恢复可见时自动重新对齐；原子状态仍严格依事件驱动更新，
 * 避免显示层高频读数反向污染业务状态。歌词模块独立持有其实例以支持按需启停
 */
export function startPositionClock(): PositionClockService {
  const clock = new PlaybackClock();
  return {
    ready: clock.ready,
    position: (now) => clock.position(now),
    resync: () => clock.resync(),
    dispose: () => clock.dispose(),
  };
}

export const positionClockKey = serviceKey<PositionClockService>('positionClock');
