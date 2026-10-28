import { createFrameGovernor } from '../frame/frameGovernor.ts';
import type { FrameClock } from '../frame/frameScheduler.ts';
import type { ImmersiveCoverState } from '../../covers/immersiveCover.ts';
import type { BackdropRendererId } from './backdropChoice.ts';
import type { BackdropRenderer } from './backdropRegistry.ts';

/**
 * 下发给渲染器的缺省取上游播放器（`react-full`）实际传的值：渲染比例 1、帧率 60、低频音量 1（没有音频数据时的缺省），
 * 渲染器自己的缺省是 0.75、30 与 0。流速、播放状态、有无歌词上游不传，这里也不传。用户设的帧率上限更低时听用户的
 */
export const BACKDROP_RENDER_SCALE = 1;
export const BACKDROP_MAX_FPS = 60;
export const BACKDROP_LOW_FREQ = 1;

/** 守门跳闸后隔多久撤销判定重新量；同一段可见期里再跳闸就翻倍，到上限为止，真扛不住的机器不会隔一阵抖一下 */
export const BACKDROP_RETRY_MS = 30_000;
export const BACKDROP_RETRY_MAX_MS = 480_000;

/**
 * 背景要不要用这张封面：没有图、缺图、读取失败时退回中性色。地址已取到、图还在解码（`loading`）也用，
 * 渲染器自己加载；这一层不挂封面元素，没人回报解码结果，状态会一直停在 `loading`
 */
export function backdropCover(state: ImmersiveCoverState): string | null {
  return state.status === 'loading' || state.status === 'shown' ? state.url : null;
}

export interface BackdropInputs {
  /** 已解出的渲染器；null 不画，只留底色 */
  readonly renderer: BackdropRendererId | null;
  /** 封面地址；null 退回渲染器的中性色 */
  readonly cover: string | null;
  /** 有无歌词；不传就不下发，渲染器用自己的缺省（上游播放器也不传，钛金属因此不为歌词压暗） */
  readonly hasLyric?: boolean;
  readonly reducedMotion: boolean;
  /** 这次运行里帧率守门已判定扛不住 */
  readonly degraded: boolean;
  /** 窗口看不见时置假：渲染器连同 canvas 一起释放，可见后重建 */
  readonly visible: boolean;
  /** 用户的重画上限，null 是不封顶 */
  readonly fpsCap: number | null;
}

export interface BackdropDeps {
  create(id: BackdropRendererId): BackdropRenderer;
  /** 建渲染器时抛错（着色器编译失败、建不出上下文）；调用方据此不再试它 */
  onUnavailable(id: BackdropRendererId): void;
  /** 帧率守门判定扛不住；调用方记下，之后不再流动 */
  onDegrade(): void;
  /** 跳闸后到了重试的时候：调用方撤销记下的判定，之后重新量 */
  onRecover(): void;
  /** 守门用的帧时钟，缺省 `requestAnimationFrame` */
  clock?: FrameClock;
}

export interface Backdrop {
  /** 把此刻的输入交给渲染器；只发有变化的那几项，重复调用无害 */
  update(inputs: BackdropInputs): void;
  dispose(): void;
}

interface Applied {
  fps?: number;
  still?: boolean;
  hasLyric?: boolean;
  cover?: string;
}

interface Running {
  readonly id: BackdropRendererId;
  readonly renderer: BackdropRenderer;
  readonly applied: Applied;
}

const browserClock: FrameClock = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/**
 * AMLL 背景渲染器生命周期适配层
 *
 * 托管背景渲染器生命周期：窗口不可见时释放渲染器与 canvas 实例，恢复可见时按最新状态重建；
 * 帧率受制于最大帧率常数与用户偏好设定下限；减弱动效或性能守门跳闸时切换为静态模式（过渡收尾后停帧）；
 *
 * 性能守门在渲染器外部统计页面的 requestAnimationFrame 间隔（仅在动态渲染期间采样）；
 * 负载过高判定跳闸后停帧且保持实例，窗口隐藏时重置判定，保持可见时按重试周期撤销降级并重新评估
 */
export function createBackdrop(host: HTMLElement, deps: BackdropDeps): Backdrop {
  const clock = deps.clock ?? browserClock;
  let inputs: BackdropInputs | null = null;
  let running: Running | null = null;
  let tripped = false;
  let trips = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let meter: { handle: number } | null = null;

  function resetTrip(): void {
    clearTimeout(retry);
    retry = undefined;
    tripped = false;
    trips = 0;
  }

  function scheduleRetry(): void {
    const delay = Math.min(BACKDROP_RETRY_MAX_MS, BACKDROP_RETRY_MS * 2 ** trips);
    trips += 1;
    retry = setTimeout(() => {
      retry = undefined;
      tripped = false;
      deps.onRecover();
    }, delay);
  }

  function stopMeter(): void {
    if (!meter) return;
    clock.cancel(meter.handle);
    meter = null;
  }

  function startMeter(): void {
    if (meter) return;
    const governor = createFrameGovernor();
    const state = { handle: 0 };
    let last: number | undefined;
    meter = state;
    const tick = (now: number): void => {
      if (meter !== state) return;
      if (last !== undefined && governor.record(now - last)) {
        stopMeter();
        tripped = true;
        deps.onDegrade();
        scheduleRetry();
        if (running && inputs) sync(running, inputs);
        return;
      }
      last = now;
      state.handle = clock.request(tick);
    };
    state.handle = clock.request(tick);
  }

  function sync(state: Running, next: BackdropInputs): void {
    const { renderer, applied } = state;
    const fps = next.fpsCap === null ? BACKDROP_MAX_FPS : Math.min(BACKDROP_MAX_FPS, next.fpsCap);
    if (applied.fps !== fps) {
      applied.fps = fps;
      renderer.setFPS(fps);
    }
    const still = next.reducedMotion || next.degraded || tripped;
    if (applied.still !== still) {
      applied.still = still;
      renderer.setStaticMode(still);
    }
    if (next.hasLyric !== undefined && applied.hasLyric !== next.hasLyric) {
      applied.hasLyric = next.hasLyric;
      renderer.setHasLyric(next.hasLyric);
    }
    const cover = next.cover ?? '';
    if (applied.cover !== cover) {
      applied.cover = cover;
      // 加载失败渲染器自己重试并留着上一张的颜色，晚到的结果它也会丢，这里不用等
      renderer.setAlbum(cover).catch(() => {});
    }
    if (still) stopMeter();
    else startMeter();
  }

  function teardown(): void {
    stopMeter();
    if (!running) return;
    const { renderer } = running;
    running = null;
    try {
      renderer.dispose();
    } catch {
      // 渲染器已经坏了，canvas 照样撤掉
    }
    renderer.getElement().remove();
  }

  function build(id: BackdropRendererId): void {
    let renderer: BackdropRenderer;
    try {
      renderer = deps.create(id);
    } catch {
      deps.onUnavailable(id);
      return;
    }
    renderer.setRenderScale(BACKDROP_RENDER_SCALE);
    renderer.setLowFreqVolume(BACKDROP_LOW_FREQ);
    host.append(renderer.getElement());
    running = { id, renderer, applied: {} };
  }

  return {
    update(next) {
      inputs = next;
      if (!next.visible) resetTrip();
      const wanted = next.visible ? next.renderer : null;
      if (running && running.id !== wanted) teardown();
      if (wanted && !running) build(wanted);
      if (running) sync(running, next);
    },
    dispose() {
      teardown();
      resetTrip();
      inputs = null;
    },
  };
}
