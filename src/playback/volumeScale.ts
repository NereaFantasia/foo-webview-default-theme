import type { Atom } from 'jotai/vanilla';
import { choiceCodec, defineLocalPref, type PrefStorage } from '../kit/localPref.ts';
import type { Store } from '../kit/store.ts';

/**
 * 音量滑块换算刻度：定义滑块位置（0–100）与 fb2k 音量（dB）的双向映射
 *
 * fb2k 音量单位为 dB（0 为最大音量，−100 为静音）。宿主 `playback.setVolume` 接口接收线性幅度百分比
 * `100·10^(dB/20)`，而读取与事件通知均提供 `volumeDb`；因此位置计算始终以 dB 为基准换算，
 * 写入时将滑块位置转为 dB 再计算线性幅度，避免经由宿主百分比二次转换产生精度损失
 *
 * - `perceptual`：听觉对数刻度 `dB = 50·log10(0.99p + 0.01)`（p 为 0–1），使常用听音范围分布在滑块居中区域
 * - `db`：线性刻度，−100 至 0 dB 均匀分布
 */
export const VOLUME_SCALES = ['perceptual', 'db'] as const;
export type VolumeScale = (typeof VOLUME_SCALES)[number];

export const DEFAULT_VOLUME_SCALE: VolumeScale = 'perceptual';
export const MUTE_DB = -100;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 将分贝值换算为滑块百分比位置；−100 及以下（含 NaN）映射为 0（静音状态） */
export function positionOf(db: number, scale: VolumeScale): number {
  if (!(db > MUTE_DB)) return 0;
  if (scale === 'db') return clamp(db - MUTE_DB, 0, 100);
  return clamp(((10 ** (db / 50) - 0.01) / 0.99) * 100, 0, 100);
}

/** 将滑块百分比位置换算为分贝值；两档刻度在 0 位置均严格对应 −100 dB */
export function dbOf(position: number, scale: VolumeScale): number {
  const clamped = clamp(position, 0, 100);
  if (scale === 'db') return clamped + MUTE_DB;
  return 50 * Math.log10(0.99 * (clamped / 100) + 0.01);
}

/** 换算为传给 `playback.setVolume` 的线性幅度百分比；≤ −100 dB 输出为 0 */
export function amplitudeOf(db: number): number {
  return db <= MUTE_DB ? 0 : clamp(100 * 10 ** (db / 20), 0, 100);
}

/** 刻度属于纯界面偏好，保存在 localStorage，不写入宿主 config；缺失或非法时回退默认档位 */
export const VOLUME_SCALE_STORAGE_KEY = 'default-theme.volume-scale.v1';
const scalePref = defineLocalPref<VolumeScale>({
  key: VOLUME_SCALE_STORAGE_KEY,
  fallback: DEFAULT_VOLUME_SCALE,
  ...choiceCodec(VOLUME_SCALES),
});

/** 当前激活的刻度模式；各处播放栏与托盘音量条据此换算 */
export const volumeScaleAtom: Atom<VolumeScale> = scalePref.atom;

/** 读取刻度存档并同步至 `store`（在界面首帧渲染前调用） */
export function loadVolumeScale(store: Store, storage?: PrefStorage | null): void {
  scalePref.load(store, storage);
}

/** 切换刻度模式并持久化，即时生效；宿主实际音量保持不变，仅滑块视觉位置按新刻度重算 */
export function chooseVolumeScale(
  store: Store,
  scale: VolumeScale,
  storage?: PrefStorage | null,
): void {
  scalePref.set(store, scale, storage);
}
