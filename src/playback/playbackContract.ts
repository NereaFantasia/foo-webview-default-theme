import type { Track } from 'foo-webview-sdk';
import type { fb } from 'foo-webview-sdk/bridge';
import type { HostReadyFace } from '../host/waitForHost.ts';
import type { OrderName } from './playbackOrder.ts';
import { serviceKey } from '../kit/serviceKey.ts';

// 播放服务对外的形状：用到的宿主接口、状态、命令与曲目身份。托盘、窗口标题与以后的播放栏都按它读写。

/** 播放服务用到的宿主接口，类型逐项取自 SDK 的 `fb`。 */
export interface PlaybackFace extends HostReadyFace {
  on: typeof fb.on;
  player: Pick<
    typeof fb.player,
    | 'getState'
    | 'getCurrentTrack'
    | 'getPosition'
    | 'getVolume'
    | 'getOrder'
    | 'setOrder'
    | 'setVolume'
    | 'volumeUp'
    | 'volumeDown'
    | 'toggleMute'
    | 'toggle'
    | 'stop'
    | 'next'
    | 'prev'
    | 'seek'
  >;
}

/** 连接态只记本轮初始化的结果，不做持续的健康检测。 */
export type PlaybackStatus = 'connecting' | 'connected' | 'disconnected';

export interface PlaybackState {
  readonly status: PlaybackStatus;
  readonly state: 'playing' | 'paused' | 'stopped';
  readonly canSeek: boolean;
  /** 装载着的曲目；停止或没有曲目时为 null。暂停时仍在。 */
  readonly track: Track | null;
  /** 秒。 */
  readonly position: number;
  readonly duration: number;
  /** 宿主报的线性百分比，只作显示；音量条按 `volumeDb` 换位置。 */
  readonly volume: number;
  readonly volumeDb: number;
  readonly muted: boolean;
  /** 还没读到时为 null。 */
  readonly order: OrderName | null;
  /** 最近一次失败的是读取还是命令；不带宿主原文，那里可能有路径。 */
  readonly failure: 'read' | 'command' | null;
}

/** 曲目身份：路径加 subsong。`getPosition` 只给这两项，不给 `handle`，两边按同一个口径比。 */
export function trackKeyOf(track: Pick<Track, 'path' | 'subsong'> | null): string {
  return track ? `${track.path}|${track.subsong}` : '';
}

export interface PlaybackService {
  /** 连上宿主后的订阅与初读都发出时兑现，不会拒绝。 */
  readonly ready: Promise<void>;
  playOrPause(): Promise<void>;
  stop(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  /** 秒，夹在 0 与曲长之间。 */
  seek(seconds: number): Promise<void>;
  /**
   * 收 dB，全服务串行发送，在途时只保留最新待发值。`refresh` 为真时，
   * 这一轮写入完成后回读一次；为假的实时提交不会取消已请求的回读。
   */
  setVolume(db: number, refresh?: boolean): Promise<void>;
  /** fb2k 自己的一步升降；新值由 `volumeChanged` 带回。 */
  stepVolume(up: boolean): Promise<void>;
  toggleMute(): Promise<void>;
  setOrder(order: OrderName): Promise<void>;
  /** 只重新读取，不重放可能已经执行过的命令；没连上时重新初始化。 */
  retry(): void;
  dismissFailure(): void;
  dispose(): void;
}

export const playbackKey = serviceKey<PlaybackService>('playback');
