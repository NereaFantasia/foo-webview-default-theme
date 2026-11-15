import { atom, type Atom, type createStore } from 'jotai/vanilla';
import type { AppleMotionClip } from '../apple/appleMedia.ts';
import { resolveAppleMotionVideo, type MotionVideoResult } from './appleMotionVideo.ts';

export interface BiographyMotionState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  /** 可直接作为 `<video src>` 的 mp4 播放地址，仅在 ready 状态下有效 */
  readonly url: string | null;
}

const IDLE: BiographyMotionState = { status: 'idle', url: null };

export interface BiographyMotionDeps {
  /** 艺人头部宽幅动态艺术照对象；缺失或非对应来源时为 null */
  readonly clip: Atom<AppleMotionClip | null>;
  /** 在线内容已启用、当前源为 Apple、动态艺术照开关已开启且系统未启用减弱动态效果 */
  readonly enabled: Atom<boolean>;
  /** 艺人页面处于激活显示状态 */
  readonly active: Atom<boolean>;
  /** 头部视口宽度（CSS 像素），用于匹配画质分档 */
  readonly width: () => number;
}

/**
 * 将动态艺术照 HLS 主列表转换为 mp4 播放地址：
 * 仅解析播放列表文本元数据，不下载视频二进制流；解析结果按主列表 URL 缓存在内存中避免重复请求，失败后按退避策略延迟重试
 */
export function startBiographyMotion(
  store: ReturnType<typeof createStore>,
  deps: BiographyMotionDeps,
  resolve: (master: string, headerWidth: number) => Promise<MotionVideoResult> = (
    master,
    headerWidth,
  ) => resolveAppleMotionVideo(master, headerWidth),
) {
  const state = atom<BiographyMotionState>(IDLE);
  const known = new Map<string, MotionVideoResult>();
  let generation = 0;
  let disposed = false;

  function publish(next: BiographyMotionState): void {
    if (!disposed) store.set(state, next);
  }

  function update(): void {
    generation += 1;
    const mine = generation;
    const clip = store.get(deps.clip);
    if (!clip || !store.get(deps.enabled) || !store.get(deps.active)) return publish(IDLE);
    const result = known.get(clip.video);
    if (result?.ok) return publish({ status: 'ready', url: result.url });
    if (result && result.retryAt > Date.now()) return publish({ status: 'failed', url: null });
    publish({ status: 'loading', url: null });
    // 首轮解析锁动画质分档，窗口后续宽度变化不再重新拉取以避免播放中断
    void resolve(clip.video, deps.width()).then((answer) => {
      if (disposed || mine !== generation) return;
      known.set(clip.video, answer);
      publish(answer.ok ? { status: 'ready', url: answer.url } : { status: 'failed', url: null });
    });
  }

  const stops = [deps.clip, deps.enabled, deps.active].map((source) => store.sub(source, update));
  update();
  return {
    state,
    dispose(): void {
      disposed = true;
      generation += 1;
      stops.forEach((stop) => stop());
    },
  };
}

export type BiographyMotion = ReturnType<typeof startBiographyMotion>;
