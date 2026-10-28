import type { MessageKey } from '../i18n/en.ts';
import type { LyricsState } from './lyricsService.ts';

/**
 * 歌词缺省/异常空状态展示模型与操作契约（供右侧卡与沉浸视图共享）
 *
 * 宿主连接中断或曲目元数据加载失败状态优先于歌词自身状态展示
 */

export interface LyricsEmptyFacts {
  readonly connected: boolean;
  readonly trackStatus: 'pending' | 'ready' | 'failed';
}

export interface LyricsEmpty {
  readonly message: MessageKey;
  /** 数据加载或检索中状态标志（呈现加载指示器） */
  readonly loading: boolean;
  /** 重试操作目标类型：宿主或曲目异常重试播放服务，歌词异常重试歌词服务 */
  readonly retry: 'playback' | 'lyrics';
  /** 是否允许触发重试操作 */
  readonly canRetry: boolean;
  /** 是否允许触发在线歌词检索入口 */
  readonly canSearchOnline: boolean;
}

function stateMessage(state: LyricsState): MessageKey {
  switch (state.status) {
    case 'idle':
      return 'lyrics.idle';
    case 'waiting':
      return 'lyrics.searching';
    case 'loading':
      return state.stage === 'local' ? 'lyrics.loading' : 'lyrics.searching';
    case 'failed':
      return state.stage === 'local' ? 'lyrics.localFailed' : 'lyrics.onlineFailed';
    case 'missing':
      return state.reason === 'metadata'
        ? 'lyrics.metadataMissing'
        : state.reason === 'local'
          ? 'lyrics.localMissing'
          : 'lyrics.onlineMissing';
    case 'ready':
      return 'lyrics.region';
  }
}

export function lyricsEmpty(state: LyricsState, facts: LyricsEmptyFacts): LyricsEmpty {
  const { connected, trackStatus } = facts;
  const hostProblem = !connected || trackStatus === 'failed';
  const loading = connected && (state.status === 'loading' || trackStatus === 'pending');
  return {
    message: !connected
      ? 'host.unavailable'
      : trackStatus === 'failed'
        ? 'lyrics.trackFailed'
        : trackStatus === 'pending'
          ? 'lyrics.loading'
          : stateMessage(state),
    loading,
    retry: hostProblem ? 'playback' : 'lyrics',
    canRetry: !loading && (state.status === 'failed' || hostProblem),
    canSearchOnline: connected && (state.status === 'missing' || state.status === 'failed'),
  };
}
