import { DURATION_MS } from '../../motion/timing.ts';

const FLOW_RATE = 1.3;

export interface FlowMotion {
  time: number;
  rotation: number;
  direction: number;
  breathingPhase: number;
  breathing: number;
  gradient: number;
  remainder: number;
  speed: number;
  speedFrom: number;
  speedTarget: number;
  speedElapsed: number;
}

export function createFlowMotion(): FlowMotion {
  return {
    time: 0,
    rotation: 1,
    direction: 1,
    breathingPhase: 0,
    breathing: 1,
    gradient: 0,
    remainder: 0,
    speed: 1,
    speedFrom: 1,
    speedTarget: 1,
    speedElapsed: DURATION_MS.slow,
  };
}

/** 反向时从当前速度开始；初次显示、静止或休眠恢复时可直接采用当前播放状态。 */
export function setFlowPaused(state: FlowMotion, paused: boolean, immediate = false): void {
  const target = paused ? 0.08 : 1;
  if (immediate) {
    state.speed = state.speedFrom = state.speedTarget = target;
    state.speedElapsed = DURATION_MS.slow;
  } else if (target !== state.speedTarget) {
    state.speedFrom = state.speed;
    state.speedTarget = target;
    state.speedElapsed = 0;
  }
}

/** 固定为 120 BPM、60 Hz 的运动配方；绘制限帧不改变速度，休眠时间由调用方排除。 */
export function advanceFlowMotion(state: FlowMotion, milliseconds: number): void {
  const elapsed = Math.max(0, Math.min(100, milliseconds));
  const changing = Math.min(elapsed, DURATION_MS.slow - state.speedElapsed);
  const previousSpeed = state.speed;
  state.speedElapsed += changing;
  state.speed =
    state.speedElapsed >= DURATION_MS.slow
      ? state.speedTarget
      : state.speedFrom +
        ((state.speedTarget - state.speedFrom) * state.speedElapsed) / DURATION_MS.slow;
  // 速度线性变化时按梯形面积积分；跨过过渡终点的余下时间按目标速度推进。
  state.remainder +=
    ((changing * (previousSpeed + state.speed)) / 2 + (elapsed - changing) * state.speedTarget) *
    FLOW_RATE;
  const step = 1000 / 60;
  while (state.remainder + 1e-9 >= step) {
    state.remainder = Math.max(0, state.remainder - step);
    state.time += 0.016;
    state.breathingPhase += 0.016 / 120;
    state.breathing = 1 + Math.sin(state.breathingPhase) * 0.1;
    state.gradient += 0.002;
    if (Math.abs(state.rotation) > Math.PI * 2) state.direction *= -1;
    state.rotation += 0.001 * state.direction * state.breathing;
  }
}
