import { atom, type Atom } from 'jotai/vanilla';
import { flushSync } from 'react-dom';
import { defineLocalPref, type LocalPref, type PrefStorage } from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import {
  browse,
  initialSceneState,
  selectPage,
  setMode,
  setSidebar,
  type SceneMode,
  type SceneState,
  type SidebarMode,
  type SidebarPage,
} from './sceneState.ts';
import { createSceneTransition, type SceneTransition } from './sceneTransition.ts';

/**
 * 场景动作调度中心：管理侧栏、展开模式、场景模式与浏览选择等交互状态及预设切换入口
 *
 * 状态写入统一经过过渡包装与同步提交，避免布局瞬移
 */

export type PresetOrientation = 'landscape' | 'portrait';

const stateAtom = atom<SceneState>(initialSceneState('lyrics'));

/** 场景交互状态（侧栏页、展开方式、模式与浏览条目），只读 */
export const sceneStateAtom: Atom<SceneState> = atom((get) => get(stateAtom));

/** 预设标识编解码契约（空字符串表示未指定，具体合法性由预设注册表校验） */
const presetId = {
  fallback: '',
  parse: (raw: string) => raw || undefined,
  format: (value: string) => value,
};

const PRESET_PREFS: Readonly<Record<PresetOrientation, LocalPref<string>>> = {
  landscape: defineLocalPref({ key: 'default-theme.immersive.presetLandscape.v1', ...presetId }),
  portrait: defineLocalPref({ key: 'default-theme.immersive.presetPortrait.v1', ...presetId }),
};

/** 横竖屏方向各自持久化的预设标识原子，只读 */
export const presetIdAtoms: Readonly<Record<PresetOrientation, Atom<string>>> = {
  landscape: PRESET_PREFS.landscape.atom,
  portrait: PRESET_PREFS.portrait.atom,
};

/** 加载横竖屏预设持久化记录 */
export function loadPresetChoices(store: Store, storage?: PrefStorage | null): void {
  PRESET_PREFS.landscape.load(store, storage);
  PRESET_PREFS.portrait.load(store, storage);
}

/** 进入视图时重置场景交互状态为初始态（不执行过渡动效） */
export function resetScene(store: Store, startPage: SidebarPage): void {
  store.set(stateAtom, initialSceneState(startPage));
}

/**
 * 历史记录场景快照：包含侧栏页、展开方式与当前模式
 *
 * 用于页面后退离开与前进恢复时还原视图版式；队列浏览选中项受队列动态变化影响，不纳入快照
 */
export interface SceneSnapshot {
  readonly page: SidebarPage;
  readonly sidebar: SidebarMode;
  readonly mode: SceneMode;
}

export function captureScene(store: Store): SceneSnapshot {
  const { page, sidebar, mode } = store.get(stateAtom);
  return { page, sidebar, mode };
}

/** 历史记录回退时恢复场景快照（不触发过渡动效） */
export function restoreScene(store: Store, snapshot: SceneSnapshot): void {
  store.set(stateAtom, { ...snapshot, browsed: null });
}

export interface SceneActions {
  /** 点页签：切页，强制收起着就退回自动 */
  selectPage(page: SidebarPage): void;
  /** 展开或收起侧栏；`auto` 退回按有没有歌词算 */
  setSidebar(sidebar: SidebarMode): void;
  setMode(mode: SceneMode): void;
  /** Coverflow 里浏览到某个条目，null 回到跟随正在播放；浏览自带动效，不起视图过渡 */
  browse(key: string | null): void;
  /** 换某个方向的预设；存档写回，下次进视图还是它 */
  switchPreset(orientation: PresetOrientation, id: string, storage?: PrefStorage | null): void;
}

/** 真实环境里的过渡：减弱动效跟页面的设置走，窗口看不见时直接改 */
export function browserSceneTransition(store: Store): SceneTransition {
  return createSceneTransition({
    document: typeof document === 'undefined' ? null : document,
    flush: (update) => flushSync(update),
    reduced: () => store.get(reducedMotionAtom),
  });
}

function sameState(a: SceneState, b: SceneState): boolean {
  return (
    a.page === b.page && a.sidebar === b.sidebar && a.mode === b.mode && a.browsed === b.browsed
  );
}

export function createSceneActions(
  store: Store,
  transition: SceneTransition = browserSceneTransition(store),
): SceneActions {
  /**
   * 更新放进过渡回调里才执行，所以按回调执行那一刻的状态算下一步，连点时各次叠加；
   * 按此刻的状态看是原地不动的不起过渡
   */
  function change(next: (state: SceneState) => SceneState): void {
    const current = store.get(stateAtom);
    if (sameState(current, next(current))) return;
    transition(() => store.set(stateAtom, next));
  }

  return {
    selectPage: (page) => change((state) => selectPage(state, page)),
    setSidebar: (sidebar) => change((state) => setSidebar(state, sidebar)),
    setMode: (mode) => change((state) => setMode(state, mode)),
    browse: (key) => store.set(stateAtom, (state) => browse(state, key)),
    switchPreset(orientation, id, storage) {
      const pref = PRESET_PREFS[orientation];
      if (store.get(pref.atom) === id) return;
      transition(() => void pref.set(store, id, storage));
    },
  };
}
