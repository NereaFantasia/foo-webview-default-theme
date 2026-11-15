import { createFrameGovernor } from '../frame/frameGovernor.ts';
import type { FrameClock } from '../frame/frameScheduler.ts';
import type { ImmersiveCoverState } from '../../covers/immersiveCover.ts';
import type { LowFreqDrive, LowFreqFactory, LowFreqMode } from './backdropAudio.ts';
import type { BackdropRendererId } from './backdropChoice.ts';
import type { BackdropOptionPatch, ResolvedBackdropOptions } from './backdropOptions.ts';
import type { BackdropRenderer } from './backdropRegistry.ts';

/**
 * 下发给渲染器的缺省取上游播放器（`react-full`）实际传的值：渲染比例 1、帧率 60、低频音量 1（没有音频数据时的缺省），
 * 渲染器自己的缺省是 0.75、30 与 0。流速、播放状态、有无歌词上游不传，这里也不传。用户设的帧率上限更低时以用户设置为准。
 * 低频音量 1 同时是没开「随音乐律动」时一直保持的值，订阅被拒时也退回它
 */
export const BACKDROP_RENDER_SCALE = 1;
export const BACKDROP_MAX_FPS = 60;
export const BACKDROP_LOW_FREQ = 1;

/**
 * 钛金属随音乐律动的库外增强：上游把低频音量夹在 0 到 1，响应只有变暗 8%、流速加 35%，画面几乎看不出律动。
 * 律动时跟着同一个音量再给整块画面提亮、加快流速，音量 1 时亮度加 25%、流速加 60%；暂停时音量缓回 0，跟着回到原样
 */
export const TITANIUM_PULSE = { brightness: 0.25, flow: 0.6 } as const;

/**
 * 处于暂停或停止等非播放状态时，流动速度按此倍率放缓，渲染循环保持运行：帧率保持基准值，流速在用户设定值的基础上乘以此系数。
 * 进入视图或窗口重新可见时若处于非播放状态，直接应用该流速而不再执行减速过渡
 */
export const PAUSE_SPEED = 0.1;

/**
 * 流速过渡时间常数（毫秒）：经过约三倍时间常数达到平稳状态，暂停衰减约 1.5s，播放恢复约 0.6s。
 * 暂停取较长的常数，让「渐渐停下」看得出来。恢复取较短的常数，避免点击播放后画面像是没有反应
 */
export const PAUSE_TAU_MS = 500;
export const RESUME_TAU_MS = 200;

/** 渲染器进场淡入时长（毫秒）：大面积透明度渐变采用 Windows 11 慢速动画规范，曲线为线性，与 `CoverGlow` 淡入一致 */
export const BACKDROP_REVEAL_MS = 333;
/** 切换渲染器时新图层淡入时长（毫秒），与 `flowBackdrop.ts` 的 `FADE_MS`（流动色场切换封面的渐变）保持一致 */
export const BACKDROP_SWAP_MS = 500;
/** 停用背景渲染时旧画面淡出时长（毫秒）：退场采用 Windows 11 快速动画规范 */
export const BACKDROP_LEAVE_MS = 167;
/**
 * 新渲染器等待首张封面加载的超时阈值（毫秒），超时后直接淡入。封面加载失败时上游持续重试，设置超时可避免背景长期处于隐藏状态。
 * 收到首张封面后执行淡入，确保首帧即呈现封面提取色
 */
export const BACKDROP_REVEAL_WAIT_MS = 600;

/** 流速逼近容差：两值差值小于该阈值即视为达到目标值，结束过渡循环 */
const PACE_SETTLED = 0.002;
/** 步进计算的最大时间步长（毫秒）：避免长休眠唤醒后产生过大的步进量 */
const PACE_MAX_STEP_MS = 100;

/** 性能降级触发后的重试间隔（毫秒）：同一可见周期内再次降级则间隔翻倍，直至 `BACKDROP_RETRY_MAX_MS`，避免性能不足的设备隔一阵就抖动一次 */
export const BACKDROP_RETRY_MS = 30_000;
export const BACKDROP_RETRY_MAX_MS = 480_000;

/**
 * 背景封面可用性判定：无封面或加载失败时回退为中性色。已获取地址且解码中（loading）同样采用，
 * 由渲染器自主加载解码。本层未挂载封面 DOM 元素，状态将保持在 loading
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
  /** 用户对当前渲染器的可调项，已合并缺省；换了渲染器时跟着换成新渲染器认得的那一组 */
  readonly options: ResolvedBackdropOptions;
  /** 正在播放；没在播放时流速缓降到 `PAUSE_SPEED` 倍，随音乐律动只在播放时订音频、音量缓动回 0 */
  readonly playing: boolean;
}

/** 透明度渐变接口。调用 `cancel()` 后 `finished` Promise 被拒绝，Web Animations 的 `Animation` 符合该契约 */
export interface Fade {
  readonly finished: Promise<unknown>;
  cancel(): void;
}

/**
 * 为指定图层播放透明度渐变并返回动画实例。环境不支持 Web Animations 时返回 null，调用方直接呈现终态。
 * 淡出结束后图层保持透明并由调用方移除，淡入结束后恢复图层默认不透明度
 */
function layerFade(layer: HTMLElement, from: number, to: number, ms: number): Fade | null {
  if (!Reflect.has(layer, 'animate')) return null;
  return layer.animate([{ opacity: from }, { opacity: to }], {
    duration: ms,
    easing: 'linear',
    fill: to === 0 ? 'forwards' : 'none',
  });
}

export interface BackdropDeps {
  create(id: BackdropRendererId): BackdropRenderer;
  /** 渲染器创建失败回调（着色器编译失败或上下文创建异常）。调用方据此将其标记为不可用 */
  onUnavailable(id: BackdropRendererId): void;
  /** 帧率守门判定性能过载回调。调用方记录状态并停止动态流动 */
  onDegrade(): void;
  /** 性能过载恢复周期到期回调：调用方清除降级记录并重新评估 */
  onRecover(): void;
  /** 帧率监控时钟源，默认使用 `requestAnimationFrame` */
  clock?: FrameClock;
  /** 低频音量驱动工厂。未提供时不接入音频，「随音乐律动」不起作用 */
  openLowFreq?: LowFreqFactory;
  /** 图层透明度渐变实现。默认使用 Web Animations，返回 null 表示跳过动画 */
  fade?(layer: HTMLElement, from: number, to: number, ms: number): Fade | null;
}

export interface Backdrop {
  /** 向渲染器同步最新输入参数。仅分派变更项，重复调用幂等 */
  update(inputs: BackdropInputs): void;
  dispose(): void;
}

interface Applied {
  options?: BackdropOptionPatch;
  audio?: LowFreqMode;
  flowRate?: number;
  /** 最近一次提交给渲染器的流速：用户流速、暂停衰减系数与钛金属律动增益三者之积 */
  speed?: number;
  filter?: string;
  fps?: number;
  still?: boolean;
  hasLyric?: boolean;
  cover?: string;
}

/** 流速衰减状态：`factor` 逐帧逼近 `target`，播放状态下为 1，非播放状态下为 `PAUSE_SPEED` */
interface Pace {
  factor: number;
  target: number;
  handle: number | undefined;
  last: number | undefined;
}

interface Running {
  readonly id: BackdropRendererId;
  readonly renderer: BackdropRenderer;
  /** 承载渲染器 canvas 的独立图层。进场与切换渲染器的透明度渐变作用于该图层，不修改 canvas 自身样式 */
  readonly layer: HTMLElement;
  /**
   * 图层呈现生命周期：呈现前保持透明。`revealed` 表示已完成淡入呈现，`waiting` 表示处于等待首张封面阶段，
   * `wait` 为等待超时计时器
   */
  readonly life: {
    revealed: boolean;
    waiting: boolean;
    wait: ReturnType<typeof setTimeout> | undefined;
  };
  readonly applied: Applied;
  readonly drive?: LowFreqDrive;
  /** 钛金属律动增强状态：启用律动且存在有效音频输入或处于恢复阶段。`volume` 为最近采样的低频音量 */
  readonly pulse: { on: boolean; volume: number };
  readonly pace: Pace;
  /** 计算当前有效流速并提交给渲染器。数值未变更时避免重复分派 */
  readonly push: () => void;
}

/** 比较两组选项补丁是否逐项相同。有变化时整组下发，上游 `setOptions` 本身按项合并，同值不会重复处理 */
function samePatch(a: BackdropOptionPatch, b: BackdropOptionPatch): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => Object.is(Reflect.get(a, key), Reflect.get(b, key)));
}

const browserClock: FrameClock = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/**
 * AMLL 背景渲染器生命周期适配层
 *
 * 托管背景渲染器的生命周期：窗口不可见时释放渲染器与 canvas 实例，恢复可见时按最新状态重建。
 * 帧率受制于最大帧率常数与用户偏好设定的下限。减弱动效或性能守门跳闸时切换为静态模式（过渡收尾后停帧）。
 * 处于暂停或停止等非播放状态时不停帧，也不进入静态模式，只把流速降到 `PAUSE_SPEED` 倍，背景逐渐放慢但仍在流动
 *
 * 渲染器 canvas 挂载于适配层创建的独立图层中，图层的透明度渐变承担进场淡入、切换渲染器时的交叉渐变和关闭时的淡出。
 * 新渲染器收到首张封面后淡入，最长等待 `BACKDROP_REVEAL_WAIT_MS`。切换渲染器时新层在旧层上方淡入，旧画面静止，
 * 淡入结束后释放旧层与旧渲染器，同一时刻至多保留两个渲染器。
 * 减弱动效或环境不支持 Web Animations 时跳过动画，直接呈现终态。窗口不可见时直接释放全部渲染器
 *
 * 性能守门在渲染器外部统计页面的 requestAnimationFrame 间隔（仅在动态渲染期间采样）。
 * 负载过高判定跳闸后停帧且保持实例，窗口隐藏时重置判定，保持可见时按重试周期撤销降级并重新评估
 */
export function createBackdrop(host: HTMLElement, deps: BackdropDeps): Backdrop {
  const clock = deps.clock ?? browserClock;
  let inputs: BackdropInputs | null = null;
  let running: Running | null = null;
  /** 切换渲染器或停用背景时暂存于下层的旧渲染器：画面冻结，过渡完成后统一释放 */
  let leaving: Running | null = null;
  /** 当前正在执行的透明度渐变动画，同一时刻至多保持一段 */
  let fade: Fade | null = null;
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

  /** 逐帧更新流速衰减系数：播放时快速恢复，暂停时平滑衰减。达到目标值后停止循环 */
  function stepPace(state: Running, time: number): void {
    const { pace } = state;
    pace.handle = undefined;
    const elapsed =
      pace.last === undefined ? 0 : Math.min(PACE_MAX_STEP_MS, Math.max(0, time - pace.last));
    pace.last = time;
    const tau = pace.target < pace.factor ? PAUSE_TAU_MS : RESUME_TAU_MS;
    pace.factor += (pace.target - pace.factor) * (1 - Math.exp(-elapsed / tau));
    if (Math.abs(pace.target - pace.factor) < PACE_SETTLED) {
      pace.factor = pace.target;
      pace.last = undefined;
    } else {
      pace.handle = clock.request((now) => stepPace(state, now));
    }
    state.push();
  }

  /**
   * 更新流速衰减目标值。静态模式下画面静止，缓动没有可见效果，直接更新至目标值，恢复流动时即为正确的速度。
   * 动态模式下从当前值继续逼近，中途反向也不会突变
   */
  function retarget(state: Running, target: number, snap: boolean): void {
    const { pace } = state;
    pace.target = target;
    if (snap) {
      if (pace.handle !== undefined) clock.cancel(pace.handle);
      pace.handle = undefined;
      pace.last = undefined;
      pace.factor = target;
      state.push();
      return;
    }
    if (pace.factor === target || pace.handle !== undefined) return;
    pace.last = undefined;
    pace.handle = clock.request((now) => stepPace(state, now));
  }

  function sync(state: Running, next: BackdropInputs): void {
    const { renderer, applied } = state;
    // 优先下发选项再分派封面：取色方式变更时上游将基于当前封面重新提取颜色，提前更新选项可避免冗余提取
    if (!applied.options || !samePatch(applied.options, next.options.patch)) {
      applied.options = next.options.patch;
      if (Object.keys(next.options.patch).length > 0) renderer.setOptions(next.options.patch);
    }
    if (applied.flowRate !== next.options.flowRate) {
      applied.flowRate = next.options.flowRate;
      state.push();
    }
    // 滤镜挂载于渲染器自身元素上，切换渲染器时随元素解绑。滤镜为恒等变换时移除样式以降低合成开销
    if (applied.filter !== next.options.filter) {
      applied.filter = next.options.filter;
      renderer.getElement().style.filter = next.options.filter;
    }
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
    retarget(state, next.playing ? 1 : PAUSE_SPEED, still);
    // 静态模式下画面保持静止，取消音频监听订阅
    const audio: LowFreqMode = !next.options.audio
      ? 'constant'
      : still
        ? 'hold'
        : next.playing
          ? 'follow'
          : 'pause';
    if (applied.audio !== audio) {
      applied.audio = audio;
      state.drive?.set(audio);
      const pulsing = state.id === 'titanium' && audio !== 'constant';
      if (state.pulse.on && !pulsing) {
        // 停用律动增强：滤镜与流速恢复为基础配置
        renderer.getElement().style.filter = applied.filter ?? '';
        state.pulse.volume = 0;
      }
      state.pulse.on = pulsing;
      state.push();
    }
    if (next.hasLyric !== undefined && applied.hasLyric !== next.hasLyric) {
      applied.hasLyric = next.hasLyric;
      renderer.setHasLyric(next.hasLyric);
    }
    const cover = next.cover ?? '';
    if (applied.cover !== cover) {
      applied.cover = cover;
      // 渲染器加载封面失败时自行重试并沿用上一张颜色，过期结果由渲染器丢弃。
      // 此处仅等待首个 setAlbum 结束无论成功与否
      awaitFirstCover(
        state,
        renderer.setAlbum(cover).catch(() => {}),
      );
    }
    if (still) stopMeter();
    else startMeter();
  }

  /** 执行图层渐变动画并在完成后回调 done。减弱动效或环境不支持时直接同步回调 done */
  function begin(layer: HTMLElement, from: number, to: number, ms: number, done: () => void): void {
    const start = deps.fade ? deps.fade.bind(deps) : layerFade;
    const playing = inputs?.reducedMotion ? null : start(layer, from, to, ms);
    if (!playing) {
      done();
      return;
    }
    fade = playing;
    playing.finished.then(
      () => {
        if (fade !== playing) return;
        fade = null;
        done();
      },
      () => {},
    );
  }

  /** 结算在途的渐变动画：取消动画并释放下层旧渲染器，上层图层直接呈现终态 */
  function settle(): void {
    fade?.cancel();
    fade = null;
    if (!leaving) return;
    release(leaving);
    leaving = null;
  }

  /** 销毁指定渲染器并移除对应 DOM 图层 */
  function release(state: Running): void {
    clearTimeout(state.life.wait);
    const { renderer, drive, pace } = state;
    if (pace.handle !== undefined) clock.cancel(pace.handle);
    drive?.dispose();
    try {
      renderer.dispose();
    } catch {
      // 渲染器异常损坏时仍强制移除 DOM 节点
    }
    renderer.getElement().remove();
    state.layer.remove();
  }

  /** 冻结下层旧渲染器：停止画面刷新与流速及音频更新 */
  function freeze(state: Running): void {
    if (state.pace.handle !== undefined) clock.cancel(state.pace.handle);
    state.pace.handle = undefined;
    state.drive?.set('hold');
    state.renderer.setStaticMode(true);
  }

  /** 淡入呈现当前渲染器。下层存在旧渲染器时执行交叉渐变，结束后释放旧渲染器 */
  function reveal(state: Running): void {
    const { life, layer } = state;
    clearTimeout(life.wait);
    if (running !== state || life.revealed) return;
    life.revealed = true;
    layer.style.opacity = '';
    begin(layer, 0, 1, leaving ? BACKDROP_SWAP_MS : BACKDROP_REVEAL_MS, settle);
  }

  /** 首次 setAlbum 完成后呈现渲染器。超过 BACKDROP_REVEAL_WAIT_MS 仍未完成则超时强制呈现 */
  function awaitFirstCover(state: Running, loaded: Promise<void>): void {
    const { life } = state;
    if (life.revealed || life.waiting) return;
    life.waiting = true;
    life.wait = setTimeout(() => reveal(state), BACKDROP_REVEAL_WAIT_MS);
    void loaded.then(() => reveal(state));
  }

  /** 退役当前活动渲染器：已呈现图层移至底层冻结并随过渡销毁。未呈现图层立即释放 */
  function retire(wanted: BackdropRendererId | null): void {
    const old = running;
    if (!old) return;
    running = null;
    stopMeter();
    if (!old.life.revealed) {
      release(old);
      return;
    }
    settle();
    freeze(old);
    leaving = old;
    if (wanted === null) begin(old.layer, 1, 0, BACKDROP_LEAVE_MS, settle);
  }

  /** 立即销毁所有渲染器图层而不播放过渡动画：窗口隐藏或适配层释放时调用 */
  function teardown(): void {
    stopMeter();
    fade?.cancel();
    fade = null;
    if (leaving) release(leaving);
    leaving = null;
    if (running) release(running);
    running = null;
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
    // 呈现前保持透明。后创建的图层在 DOM 结构中居后，切换渲染器时自然覆盖旧图层
    const layer = host.ownerDocument.createElement('div');
    layer.dataset['backdropLayer'] = id;
    layer.style.opacity = '0';
    layer.append(renderer.getElement());
    host.append(layer);
    const applied: Applied = {};
    const pulse = { on: false, volume: 0 };
    // 初始化时若处于非播放状态则直接应用低速模式
    const rest = inputs?.playing === false ? PAUSE_SPEED : 1;
    const pace: Pace = { factor: rest, target: rest, handle: undefined, last: undefined };
    const push = (): void => {
      const lift = pulse.on ? 1 + TITANIUM_PULSE.flow * pulse.volume : 1;
      const speed = (applied.flowRate ?? 1) * pace.factor * lift;
      if (applied.speed === speed) return;
      applied.speed = speed;
      renderer.setFlowSpeed(speed);
    };
    const drive = deps.openLowFreq?.({
      clock,
      restVolume: BACKDROP_LOW_FREQ,
      gain: () => inputs?.options.audioGain ?? 1,
      onVolume: (volume) => {
        renderer.setLowFreqVolume(volume);
        if (!pulse.on) return;
        pulse.volume = volume;
        // 律动提亮叠加在调色之后。钛金属目前没有调色，保持这个次序是为了日后加上调色时二者不互相覆盖
        const lift = `brightness(${1 + TITANIUM_PULSE.brightness * volume})`;
        renderer.getElement().style.filter = applied.filter ? `${applied.filter} ${lift}` : lift;
        push();
      },
    });
    const life: Running['life'] = { revealed: false, waiting: false, wait: undefined };
    running = { id, renderer, layer, life, applied, drive, pulse, pace, push };
  }

  return {
    update(next) {
      inputs = next;
      if (!next.visible) resetTrip();
      const wanted = next.visible ? next.renderer : null;
      if (!next.visible) teardown();
      else if (running && running.id !== wanted) retire(wanted);
      // 停用背景时旧渲染器若暂留底层，补充分派淡出动画
      if (!wanted && !running && leaving && !fade) {
        begin(leaving.layer, 1, 0, BACKDROP_LEAVE_MS, settle);
      }
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
