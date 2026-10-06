import type { PlaybackService } from '../../../playback/playbackContract.ts';
import { clamp } from '../../../playback/volumeScale.ts';

// 音量条与滚轮的换算，以及控件最近提交的目标。位置是音量条上的 0–100，换 dB 用 `volumeScale.ts`。

/** 滚轮一格、键盘一下挪多少个位置单位。 */
export const VOLUME_STEP = 1;
/** 连着滚时，上一次发出的音量在这段时间里仍当作起点，毫秒：宿主的音量事件晚到，别拿旧值再加一步。 */
export const VOLUME_MEMORY_MS = 400;
/** 滑条松手后最多等宿主报回多久才交还，毫秒；提交失败时靠它。 */
export const VOLUME_SETTLE_MS = 1000;
/** 宿主报回的位置离松手的位置在这个位置单位以内，就算追上了。 */
export const VOLUME_SETTLE_TOLERANCE = 1;

/** 图标分四档：静音（或音量到底）、低、中、高。 */
export type VolumeLevel = 'muted' | 'low' | 'mid' | 'high';

export function volumeLevel(position: number, muted: boolean): VolumeLevel {
  if (muted || position <= 0) return 'muted';
  if (position < 34) return 'low';
  return position < 67 ? 'mid' : 'high';
}

/**
 * 挪 `steps` 步后的位置，夹在 0–100：为正往上、为负往下，每步 `VOLUME_STEP`。键盘一下是 ±1，滚轮的步数由
 * `wheelSteps.ts` 换算。
 */
export function steppedPosition(position: number, steps: number): number {
  if (steps === 0) return position;
  return clamp(position + steps * VOLUME_STEP, 0, 100);
}

/**
 * 从哪个音量起挪下一步，dB：连着滚、连着按时用最近发出的那个，宿主的音量事件还没追上；否则用宿主报的。
 */
export function stepBase(sender: Pick<VolumeSender, 'recent'>, hostDb: number): number {
  return sender.recent() ?? hostDb;
}

export interface VolumeSender {
  /** 拖动与滚轮的实时提交：不回读，新值由宿主的音量事件带回。 */
  live(db: number): void;
  /** 松手时的最后一下：提交后回读，以宿主为准。 */
  commit(db: number): void;
  /** 最近 `VOLUME_MEMORY_MS` 内发出（或排着要发）的音量；更早的答 null，调用方改用宿主报的值。 */
  recent(): number | null;
}

/**
 * 控件只记最近提交的音量，供连续滚轮步进使用；发送队列由播放服务持有，
 * 切换布局、重建控件后，旧控件不会再补发自己的待发值。
 */
export function createVolumeSender(
  playback: Pick<PlaybackService, 'setVolume'>,
  now: () => number = Date.now,
): VolumeSender {
  let last: { db: number; at: number } | null = null;

  function request(db: number, refresh: boolean): void {
    last = { db, at: now() };
    void playback.setVolume(db, refresh);
  }

  return {
    live: (db) => request(db, false),
    commit: (db) => request(db, true),
    recent: () => (last && now() - last.at <= VOLUME_MEMORY_MS ? last.db : null),
  };
}
