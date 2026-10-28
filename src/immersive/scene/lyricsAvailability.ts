import type { LyricsState } from '../../lyrics/lyricsService.ts';
import type { LyricsAvailability } from './sceneState.ts';

/**
 * 将歌词服务生命周期状态映射为场景版式可用性三态
 *
 * 聚合为 pending、present 或 absent；当服务处于 idle 且已连接有曲目时映射为 pending，防止进入视图首帧产生居中回弹闪烁
 */
export function lyricsAvailability(
  state: LyricsState,
  context: { readonly hasTrack: boolean; readonly connected: boolean },
): LyricsAvailability {
  switch (state.status) {
    case 'waiting':
    case 'loading':
      return 'pending';
    case 'ready':
      return 'present';
    case 'missing':
    case 'failed':
      return 'absent';
    case 'idle':
      return context.hasTrack && context.connected ? 'pending' : 'absent';
  }
}
