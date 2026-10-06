/**
 * 进度线拖动时显示哪个位置。拖动中显示指针拖到的位置，宿主每拍报来的进度一概不理；松手发出 seek 之后
 * 还接着显示拖到的位置，等宿主报回的位置落到它附近（或等够 `SEEK_SETTLE_MS`）才交还给宿主的进度，
 * 否则松手那一刻会先跳回旧位置再跳过去。
 */
export type SeekDraft =
  | { readonly phase: 'idle' }
  | { readonly phase: 'dragging' | 'settling'; readonly seconds: number };

export const SEEK_IDLE: SeekDraft = { phase: 'idle' };

/** 松手后最多等宿主多久，毫秒；seek 失败时靠它交还。 */
export const SEEK_SETTLE_MS = 1000;
/** 宿主报回的位置离拖到的位置在这个秒数以内，就算已经跳过去了。 */
const SETTLE_TOLERANCE_S = 1.5;
/** 键盘上 ← / → 一下跳多少秒。 */
export const SEEK_KEY_STEP_S = 5;

export function clampSeconds(seconds: number, duration: number): number {
  if (!(duration > 0) || !Number.isFinite(seconds)) return 0;
  return Math.min(duration, Math.max(0, seconds));
}

/** 指针横坐标换成秒：`left`、`width` 是进度线轨道的位置与宽，CSS 像素。 */
export function secondsAt(clientX: number, left: number, width: number, duration: number): number {
  if (!(width > 0)) return 0;
  return clampSeconds(((clientX - left) / width) * duration, duration);
}

/** 此刻该显示的秒数。 */
export function shownSeconds(draft: SeekDraft, hostPosition: number): number {
  return draft.phase === 'idle' ? hostPosition : draft.seconds;
}

/** 宿主报来新的位置：拖动中不理；松手后落到拖到的位置附近才交还。没变时原样返回同一个对象。 */
export function settleWith(draft: SeekDraft, hostPosition: number): SeekDraft {
  if (draft.phase !== 'settling') return draft;
  return Math.abs(hostPosition - draft.seconds) <= SETTLE_TOLERANCE_S ? SEEK_IDLE : draft;
}

/**
 * 键盘换算：← / → 各退、进 5 秒，夹在曲目之内；Home 回到开头。End 不接：跳到曲尾就是换下一首，
 * 那是下一首键的事。别的键答 null。
 */
export function keySeek(key: string, position: number, duration: number): number | null {
  if (key === 'ArrowLeft') return clampSeconds(position - SEEK_KEY_STEP_S, duration);
  if (key === 'ArrowRight') return clampSeconds(position + SEEK_KEY_STEP_S, duration);
  if (key === 'Home') return 0;
  return null;
}

/** 读屏念的进度：「1:05 / 4:10」。 */
export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}
