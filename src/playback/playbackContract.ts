import type { Track } from 'foo-webview-sdk';
import type { fb } from 'foo-webview-sdk/bridge';
import type { HostReadyFace } from '../host/waitForHost.ts';
import type { OrderName } from './playbackOrder.ts';
import { readOnlineAddress } from '../server/onlineAddress.ts';
import { serviceKey } from '../kit/serviceKey.ts';

// 播放服务的对外契约：定义宿主接口、状态、控制命令与曲目唯一标识；供托盘、窗口标题及播放栏统一调用

/** 播放服务用到的宿主接口，类型逐项取自 SDK 的 `fb` */
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

/** 连接态只记本轮初始化的结果，不做持续的健康检测 */
export type PlaybackStatus = 'connecting' | 'connected' | 'disconnected';

export interface PlaybackState {
  readonly status: PlaybackStatus;
  readonly state: 'playing' | 'paused' | 'stopped';
  /** 换地址续播期间（`resuming`）为 false */
  readonly canSeek: boolean;
  /** 标记在线曲目是否处于换地址续播流程（`holdPosition`）；此时 `position` 保持在原位置 */
  readonly resuming: boolean;
  /** 当前装载的曲目。停止播放或无曲目时为 null，暂停时保持原值 */
  readonly track: Track | null;
  /** 确认的播放轮次序号；同一首曲目重新播放时递增，标签更新或位置回读保持不变 */
  readonly trackGeneration: number;
  /** 秒 */
  readonly position: number;
  readonly duration: number;
  /** 宿主回报的音量线性百分比（仅用于展示）；音量滑块依 `volumeDb` 定位 */
  readonly volume: number;
  readonly volumeDb: number;
  readonly muted: boolean;
  /** 还没读到时为 null */
  readonly order: OrderName | null;
  /** 记录最近一次失败的类型（读取或命令）；脱敏处理，不保留可能包含本地路径的宿主原文 */
  readonly failure: 'read' | 'command' | null;
}

/**
 * 生成曲目的唯一标识。本地曲目结合路径与 subsong（与 `getPosition` 回报一致）；在线曲目以平台与曲目 ID 判定，
 * 切换音质或端口后仍识别为同一曲目
 */
export function trackKeyOf(track: Pick<Track, 'path' | 'subsong'> | null): string {
  if (!track) return '';
  const ref = readOnlineAddress(track.path)?.ref;
  return ref
    ? `online:${ref.platform}:${ref.id}|${track.subsong}`
    : `${track.path}|${track.subsong}`;
}

export interface PlaybackService {
  /** 连上宿主后的订阅与初读都发出时兑现，不会拒绝 */
  readonly ready: Promise<void>;
  playOrPause(): Promise<void>;
  stop(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  /** 调整播放进度（单位秒，限制在 0 至总时长之间）；在命令下发及位置回读完成后兑现 */
  seek(seconds: number): Promise<void>;
  /**
   * 收 dB，全服务串行发送，在途时只保留最新待发值。`refresh` 为真时，
   * 这一轮写入完成后回读一次；为假的实时提交不会取消已请求的回读
   */
  setVolume(db: number, refresh?: boolean): Promise<void>;
  /** 触发宿主单步增减音量；更新值由 `volumeChanged` 事件带回 */
  stepVolume(up: boolean): Promise<void>;
  toggleMute(): Promise<void>;
  setOrder(order: OrderName): Promise<void>;
  /**
   * 锁定在线曲目续播进度（适用于换音质或换端口场景）：将进度暂留于 `position` 秒并禁用拖动，地址变更不触发切歌
   * 返回结束暂留的回调函数：`resumed` 为 true 时表示已跳回目标位置，待宿主进度推进后解除锁定；否则立即同步真实进度。无当前曲目时忽略
   */
  holdPosition(position: number): (resumed: boolean) => void;
  /** 仅重试状态读取，避免重复执行已生效的命令；未连接时重新触发初始化 */
  retry(): void;
  dismissFailure(): void;
  dispose(): void;
}

export const playbackKey = serviceKey<PlaybackService>('playback');
