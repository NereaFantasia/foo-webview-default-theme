import type { Atom } from 'jotai/vanilla';
import { choiceCodec, defineLocalPref, type PrefStorage } from '../kit/localPref.ts';
import type { Store } from '../kit/store.ts';

/**
 * 音量条的刻度：条上的位置（0–100）与 fb2k 音量（dB）怎样换算。
 *
 * fb2k 的音量是 dB，0 为满，−100 即静音。宿主的 `playback.setVolume` 只收线性幅度百分比
 * `100·10^(dB/20)`，读取与事件两边都带 `volumeDb`；所以读数一律从 dB 换位置，写入把位置换成 dB
 * 再换成幅度，不经过宿主报的百分比再换一次。
 *
 * - `perceptual`：`dB = 50·log10(0.99p + 0.01)`（p 取 0–1），日常音量落在条的中段。
 *   曲线出自 foobox 的音量条（dreamawake，GPL-3.0）。
 * - `db`：−100 至 0 dB 线性铺满整条。
 */
export const VOLUME_SCALES = ['perceptual', 'db'] as const;
export type VolumeScale = (typeof VOLUME_SCALES)[number];

export const DEFAULT_VOLUME_SCALE: VolumeScale = 'perceptual';
export const MUTE_DB = -100;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** dB 换位置。−100 及以下（含 NaN）都是 0：那就是 fb2k 的静音。 */
export function positionOf(db: number, scale: VolumeScale): number {
  if (!(db > MUTE_DB)) return 0;
  if (scale === 'db') return clamp(db - MUTE_DB, 0, 100);
  return clamp(((10 ** (db / 50) - 0.01) / 0.99) * 100, 0, 100);
}

/** 位置换 dB。两档在 0 处都恰为 −100。 */
export function dbOf(position: number, scale: VolumeScale): number {
  const clamped = clamp(position, 0, 100);
  if (scale === 'db') return clamped + MUTE_DB;
  return 50 * Math.log10(0.99 * (clamped / 100) + 0.01);
}

/** 给 `playback.setVolume` 的幅度百分比；宿主把 ≤ 0 记为 −100 dB。 */
export function amplitudeOf(db: number): number {
  return db <= MUTE_DB ? 0 : clamp(100 * 10 ** (db / 20), 0, 100);
}

/** 刻度是界面偏好，存 localStorage，不进宿主 config；没有存档、存储被禁或取值不在表里都回到缺省。 */
export const VOLUME_SCALE_STORAGE_KEY = 'default-theme.volume-scale.v1';
const scalePref = defineLocalPref<VolumeScale>({
  key: VOLUME_SCALE_STORAGE_KEY,
  fallback: DEFAULT_VOLUME_SCALE,
  ...choiceCodec(VOLUME_SCALES),
});

/** 此刻的刻度。各处音量条、托盘的音量条都按它换算，换了刻度即时跟着变。 */
export const volumeScaleAtom: Atom<VolumeScale> = scalePref.atom;

/** 读存档写进 `store`；在首帧之前调。 */
export function loadVolumeScale(store: Store, storage?: PrefStorage | null): void {
  scalePref.load(store, storage);
}

/** 换刻度并记住，立即生效；和此刻一样就不写。fb2k 的音量不动，只是条上的位置按新刻度重算。 */
export function chooseVolumeScale(
  store: Store,
  scale: VolumeScale,
  storage?: PrefStorage | null,
): void {
  scalePref.set(store, scale, storage);
}
