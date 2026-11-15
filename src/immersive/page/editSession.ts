import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../../kit/store.ts';
import {
  backdropChoiceAtom,
  backdropOptionsAtom,
  chooseBackdrop,
  restoreBackdropOptions,
} from '../backdrop/backdropState.ts';
import { choosePerfOverlay, perfOverlayEnabledAtom } from '../perf/perfOverlay.ts';
import { choosePresetId, presetIdAtoms, type PresetOrientation } from '../scene/sceneActions.ts';
import {
  collapseWithoutLyricsPref,
  presetOptionsPref,
  startPagePref,
} from '../scene/scenePrefs.ts';
import {
  chooseImmersiveFpsCap,
  chooseImmersiveHostFullscreen,
  chooseImmersiveScene,
  chooseImmersiveTerrain,
  chooseImmersiveWash,
  chooseOnlineAnalysis,
  chooseWaveformMode,
  immersiveFpsCapAtom,
  immersiveHostFullscreenAtom,
  immersiveSceneAtom,
  immersiveTerrainAtom,
  immersiveWashAtom,
  onlineAnalysisAtom,
  waveformModeAtom,
} from './immersivePrefs.ts';

/**
 * 沉浸视图的设置编辑：开没开、停在哪个分类、进入时记下的值
 *
 * 只在本次运行里记着，不存档：离开视图按「完成」结束，下次进来不在编辑里；分类记到下次进编辑。
 * 改动是即时写存档的，「取消」把进入时记下的各项写回去（只写变了的）。编辑状态只给宿主用，元素不读它
 */

/** 宿主自己定义的分类；预设的各组用组的标题键作标识 */
export const EDIT_VIEW = 'view';
export const EDIT_BACKGROUND = 'background';
export const EDIT_WAVEFORM = 'waveform';
export const EDIT_MORE = 'more';

/** 写回预设的办法：在预设场景里走场景动作（带场景过渡），不在时直接写偏好 */
export type SwitchPreset = (orientation: PresetOrientation, id: string) => void;

interface Plan {
  readonly restore: (switchPreset?: SwitchPreset) => void;
}

const openAtom = atom(false);
const categoryAtom = atom<string>(EDIT_VIEW);
const planAtom = atom<Plan | null>(null);

export const editOpenAtom: Atom<boolean> = atom((get) => get(openAtom));
export const editCategoryAtom: Atom<string> = atom((get) => get(categoryAtom));

const ORIENTATIONS: readonly PresetOrientation[] = ['landscape', 'portrait'];

/** 记下一项此刻的值，返回写回它的函数；值没变时不写 */
function keep<T>(store: Store, source: Atom<T>, write: (store: Store, value: T) => unknown) {
  const value = store.get(source);
  return () => {
    if (!Object.is(store.get(source), value)) write(store, value);
  };
}

/** 编辑能改到的全部偏好：视图样式、预设与它的可调项、共用两项、背景与它的可调项、性能、图纸的几项 */
function snapshot(store: Store): Plan {
  const prefs = [
    keep(store, immersiveSceneAtom, chooseImmersiveScene),
    keep(store, presetOptionsPref.atom, presetOptionsPref.set),
    keep(store, collapseWithoutLyricsPref.atom, collapseWithoutLyricsPref.set),
    keep(store, startPagePref.atom, startPagePref.set),
    keep(store, backdropChoiceAtom, chooseBackdrop),
    keep(store, backdropOptionsAtom, restoreBackdropOptions),
    keep(store, immersiveHostFullscreenAtom, chooseImmersiveHostFullscreen),
    keep(store, immersiveFpsCapAtom, chooseImmersiveFpsCap),
    keep(store, perfOverlayEnabledAtom, choosePerfOverlay),
    keep(store, immersiveWashAtom, chooseImmersiveWash),
    keep(store, immersiveTerrainAtom, chooseImmersiveTerrain),
    keep(store, waveformModeAtom, chooseWaveformMode),
    keep(store, onlineAnalysisAtom, chooseOnlineAnalysis),
  ];
  const presets = ORIENTATIONS.map((orientation) => ({
    orientation,
    id: store.get(presetIdAtoms[orientation]),
  }));
  return {
    restore(switchPreset) {
      for (const write of prefs) write();
      for (const { orientation, id } of presets) {
        if (store.get(presetIdAtoms[orientation]) === id) continue;
        if (switchPreset) switchPreset(orientation, id);
        else choosePresetId(store, orientation, id);
      }
    },
  };
}

/** 进入编辑：记下此刻的值；已经在编辑里时什么也不做 */
export function enterEdit(store: Store): void {
  if (store.get(openAtom)) return;
  store.set(planAtom, snapshot(store));
  store.set(openAtom, true);
}

/** 「完成」与 Esc：保留改动，退出编辑 */
export function finishEdit(store: Store): void {
  store.set(openAtom, false);
  store.set(planAtom, null);
}

/** 「取消」：把进入时记下的值写回去，再退出编辑 */
export function cancelEdit(store: Store, switchPreset?: SwitchPreset): void {
  store.get(planAtom)?.restore(switchPreset);
  finishEdit(store);
}

export function chooseEditCategory(store: Store, id: string): void {
  store.set(categoryAtom, id);
}
