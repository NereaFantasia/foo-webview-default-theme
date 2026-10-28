/**
 * 封面流浏览位置的弹簧阻尼补间计算
 *
 * 仅对归一化位置标量进行单轴插值，各卡片的空间位移、缩放、偏转与不透明度均映射自该标量；
 * 采用临界阻尼弹簧模型替代固定贝塞尔曲线，在中途重定向（如连击或滚轮）时继承瞬时动量，平滑衔接且不产生过冲；
 * 动效耗时与位移跨度非线性解耦，保障长距回位与单步微调均具备舒适节奏
 */

/**
 * 弹簧角频率（rad/s）
 *
 * 决定阻尼响应刚度与收敛速率；在临界阻尼下约 300 ms 达到 90% 位移，单步约 0.65 s 完全收敛
 */
export const OMEGA = 13;
/**
 * 重定向动量继承系数
 *
 * 中途切换目标位置时保留该比例的瞬时速度，平衡连续滚动的平滑感与停止交互时的响应跟手度
 */
export const CARRY = 0.6;
/** 判定收敛到位的位移阈值（条目单位，约合千分之二封面宽）与速度阈值 */
const POSITION_EPSILON = 0.002;
const VELOCITY_EPSILON = 0.05;
/** 单次补间模拟最大时长（毫秒），防范异常初速度导致的发散死循环 */
export const MAX_GLIDE_MS = 3000;
const SAMPLE_MS = 16;

export interface Glide {
  readonly from: number;
  readonly to: number;
  /** 起始时间戳（毫秒），与时钟同步 */
  readonly start: number;
  /** 起始初速度（条目/秒），符号指示朝向 */
  readonly v0: number;
  /** 完全收敛所需估算时长（毫秒） */
  readonly duration: number;
}

/** 计算弹簧在指定耗时后的位移位置与瞬时速度 */
function springAt(glide: Pick<Glide, 'from' | 'to' | 'v0'>, ms: number): [number, number] {
  const t = ms / 1000;
  const a = glide.from - glide.to;
  const b = glide.v0 + OMEGA * a;
  const decay = Math.exp(-OMEGA * t);
  return [glide.to + (a + b * t) * decay, (b * (1 - OMEGA * t) - OMEGA * a) * decay];
}

/**
 * 启动一段由 from 至 to 的弹簧阻尼补间
 *
 * 若初速度朝向终点且超出不越界阈值，则钳制上限以防止冲过终点；背离终点的反向初速度予以保留以呈现惯性折返
 */
export function startGlide(from: number, to: number, now: number, v0 = 0): Glide {
  const remaining = Math.abs(to - from);
  const toward = Math.sign(to - from);
  const speed = toward !== 0 && v0 * toward > OMEGA * remaining ? toward * OMEGA * remaining : v0;
  const spring = { from, to, v0: speed };
  let duration = 0;
  while (duration < MAX_GLIDE_MS) {
    const [position, velocity] = springAt(spring, duration);
    if (Math.abs(position - to) < POSITION_EPSILON && Math.abs(velocity) < VELOCITY_EPSILON) break;
    duration += SAMPLE_MS;
  }
  return { ...spring, start: now, duration: Math.min(duration, MAX_GLIDE_MS) };
}

export function glideDone(glide: Glide, now: number): boolean {
  return now - glide.start >= glide.duration;
}

/** 计算当前时戳对应的位移位置；收敛后固定为目标位置 */
export function glideAt(glide: Glide, now: number): number {
  if (glideDone(glide, now)) return glide.to;
  return springAt(glide, Math.max(0, now - glide.start))[0];
}

/** 计算当前时戳对应的瞬时速度（条目/秒）；用于重定向时传递动量 */
export function glideVelocity(glide: Glide, now: number): number {
  if (glideDone(glide, now)) return 0;
  return springAt(glide, Math.max(0, now - glide.start))[1];
}
