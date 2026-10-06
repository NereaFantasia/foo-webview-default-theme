import type { Atom } from 'jotai/vanilla';
import {
  browserStorage,
  choiceCodec,
  defineLocalPref,
  ON_OFF,
  type PrefCodec,
  type PrefStorage,
} from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import { setPaintFpsCap } from '../frame/frameScheduler.ts';
import { isWaveformMode, type WaveformMode } from '../waveform/waveformModes.ts';

/**
 * 沉浸视图的几项偏好：背景山脊图、封面底色、进视图时宿主全屏、重画帧率上限、整轨波形画法与场景。
 * 整页一份，设置页与沉浸视图读写同一组 atom。存 localStorage、不进宿主 config：进视图之前同步读得到，
 * 不等宿主。性能小窗的开关另在 `perfOverlay.ts`。
 *
 * 每项导出只读的 atom 与 `readX`、`chooseX`，`loadImmersivePrefs` 一次把全部存档读进 store。
 * 开关存 `on` / `off`，其余存取值本身；没有存档、存储被禁或取值不认得都回缺省。
 * 帧率上限读进来与改了都立即交给 `frameScheduler.ts` 的重画上限。
 */

/** 封面底色：`flow` 流动（WebGL，用不了时要退成静态）、`static` 静态、`off` 不画。 */
export type WashChoice = 'flow' | 'static' | 'off';
export const WASH_CHOICES: readonly WashChoice[] = ['flow', 'static', 'off'];

/** 沉浸视图 canvas 重画的帧率上限：0 是不封顶、跟显示器刷新率走，其余覆盖常见的显示器刷新率。 */
export const FPS_CAPS = [0, 240, 180, 165, 144, 120, 100, 90, 75, 60, 30] as const;
export type FpsCap = (typeof FPS_CAPS)[number];

/**
 * 沉浸视图的场景。目前只有图纸一档，山脊图是它的背景层，不是另一个场景；加场景时在 `ImmersiveScene`
 * 与 `IMMERSIVE_SCENES` 里加值，存档照用。
 */
export type ImmersiveScene = 'paper';
export const IMMERSIVE_SCENES = ['paper'] as const;
export const DEFAULT_SCENE: ImmersiveScene = 'paper';

const KEYS = {
  terrain: 'default-theme.immersive.terrain.v1',
  wash: 'default-theme.immersive.wash.v1',
  hostFullscreen: 'default-theme.immersive.hostFullscreen.v1',
  fpsCap: 'default-theme.immersive.fpsCap.v1',
  waveformMode: 'default-theme.immersive.waveformMode.v1',
  scene: 'default-theme.immersive.scene.v1',
} as const;
const WAVEFORM_MODE: PrefCodec<WaveformMode> = {
  parse: (raw) => (isWaveformMode(raw) ? raw : undefined),
  format: (mode) => mode,
};

const terrain = defineLocalPref({ key: KEYS.terrain, fallback: true, ...ON_OFF });
const wash = defineLocalPref<WashChoice>({
  key: KEYS.wash,
  fallback: 'flow',
  ...choiceCodec(WASH_CHOICES),
});
const hostFullscreen = defineLocalPref({ key: KEYS.hostFullscreen, fallback: false, ...ON_OFF });
const fpsCap = defineLocalPref<FpsCap>({ key: KEYS.fpsCap, fallback: 0, ...choiceCodec(FPS_CAPS) });
const waveformMode = defineLocalPref<WaveformMode>({
  key: KEYS.waveformMode,
  fallback: 'rms',
  ...WAVEFORM_MODE,
});
const scene = defineLocalPref<ImmersiveScene>({
  key: KEYS.scene,
  fallback: DEFAULT_SCENE,
  ...choiceCodec(IMMERSIVE_SCENES),
});

/**
 * 背景山脊图，缺省开。关掉时不画山脊图，也不订它那份长窗频谱；频谱柱与声场照旧，
 * 柱那份短窗订阅改当主订阅（`spectrumHistory.ts`）。
 */
export const immersiveTerrainAtom: Atom<boolean> = terrain.atom;
export const readImmersiveTerrain = terrain.read;
export const chooseImmersiveTerrain = terrain.set;

/** 封面底色，缺省 `flow`。 */
export const immersiveWashAtom: Atom<WashChoice> = wash.atom;
export const readImmersiveWash = wash.read;
export const chooseImmersiveWash = wash.set;

/** 进沉浸视图时让宿主主窗一起全屏，缺省关；关着时视图只盖住整窗，不进宿主全屏。 */
export const immersiveHostFullscreenAtom: Atom<boolean> = hostFullscreen.atom;
export const readImmersiveHostFullscreen = hostFullscreen.read;
export const chooseImmersiveHostFullscreen = hostFullscreen.set;

/** 重画的帧率上限，缺省 0（不封顶）；交给重画调度时 0 换成 `null`。 */
export const immersiveFpsCapAtom: Atom<FpsCap> = fpsCap.atom;
export const readImmersiveFpsCap = fpsCap.read;

function applyFpsCap(fps: FpsCap): void {
  setPaintFpsCap(fps === 0 ? null : fps);
}

export function chooseImmersiveFpsCap(
  store: Store,
  fps: FpsCap,
  storage?: PrefStorage | null,
): void {
  if (fpsCap.set(store, fps, storage)) applyFpsCap(fps);
}

/** 整轨波形的画法，缺省 `rms`（全频包络）；下次进沉浸视图还是上次选的这一种。 */
export const waveformModeAtom: Atom<WaveformMode> = waveformMode.atom;
export const readWaveformMode = waveformMode.read;
export const chooseWaveformMode = waveformMode.set;

/** 沉浸视图的场景，缺省图纸；取值不在 `IMMERSIVE_SCENES` 里（含已不再用的旧场景名）回缺省。 */
export const immersiveSceneAtom: Atom<ImmersiveScene> = scene.atom;
export const readImmersiveScene = scene.read;
export const chooseImmersiveScene = scene.set;

/**
 * 把全部存档读进 `store`，帧率上限随之交给重画调度。整页在首帧之前或头一次进沉浸视图之前调一次：
 * 再调会拿存档盖掉 store 里的值，存储被禁时这次启动里改过的几项就丢了。
 */
export function loadImmersivePrefs(
  store: Store,
  storage: PrefStorage | null = browserStorage(),
): void {
  terrain.load(store, storage);
  wash.load(store, storage);
  hostFullscreen.load(store, storage);
  applyFpsCap(fpsCap.load(store, storage));
  waveformMode.load(store, storage);
  scene.load(store, storage);
}
