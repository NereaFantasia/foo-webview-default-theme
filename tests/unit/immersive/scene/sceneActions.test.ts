import { createStore, type Atom } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import type { PrefStorage } from '../../../../src/kit/localPref.ts';
import * as sceneActionsModule from '../../../../src/immersive/scene/sceneActions.ts';
import {
  captureScene,
  createSceneActions,
  loadPresetChoices,
  presetIdAtoms,
  resetScene,
  restoreScene,
  sceneStateAtom,
} from '../../../../src/immersive/scene/sceneActions.ts';
import type { SceneTransition } from '../../../../src/immersive/scene/sceneTransition.ts';

const direct: SceneTransition = (update) => update();

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  const storage: PrefStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
  return { storage, map };
}

describe('场景动作', () => {
  it('点页签切页并把强制收起退回自动', () => {
    const store = createStore();
    const actions = createSceneActions(store, direct);
    actions.setSidebar('closed');
    expect(store.get(sceneStateAtom).sidebar).toBe('closed');
    actions.selectPage('queue');
    expect(store.get(sceneStateAtom)).toEqual({
      page: 'queue',
      sidebar: 'auto',
      mode: 'none',
      browsed: null,
    });
  });

  it('强制展开不被点页签收回', () => {
    const store = createStore();
    const actions = createSceneActions(store, direct);
    actions.setSidebar('open');
    actions.selectPage('history');
    expect(store.get(sceneStateAtom).sidebar).toBe('open');
  });

  it('进出模式不动页签', () => {
    const store = createStore();
    const actions = createSceneActions(store, direct);
    actions.selectPage('history');
    actions.setMode('coverflow');
    expect(store.get(sceneStateAtom)).toEqual({
      page: 'history',
      sidebar: 'auto',
      mode: 'coverflow',
      browsed: null,
    });
    actions.setMode('none');
    expect(store.get(sceneStateAtom).page).toBe('history');
  });

  it('浏览选中直接写，不起过渡；退出模式时清掉', () => {
    const store = createStore();
    const transition = vi.fn<SceneTransition>((update) => update());
    const actions = createSceneActions(store, transition);
    resetScene(store, 'lyrics');
    actions.browse('a');
    expect(store.get(sceneStateAtom).browsed).toBeNull();
    actions.setMode('coverflow');
    transition.mockClear();
    actions.browse('a');
    actions.browse('b');
    expect(store.get(sceneStateAtom).browsed).toBe('b');
    expect(transition).not.toHaveBeenCalled();
    actions.setMode('none');
    expect(store.get(sceneStateAtom).browsed).toBeNull();
  });

  it('每次改动都经过渡，原地不动的不起过渡', () => {
    const store = createStore();
    const transition = vi.fn<SceneTransition>((update) => update());
    const actions = createSceneActions(store, transition);
    resetScene(store, 'lyrics');
    actions.selectPage('lyrics');
    actions.setMode('none');
    expect(transition).not.toHaveBeenCalled();
    actions.setSidebar('auto');
    expect(transition).not.toHaveBeenCalled();
    actions.selectPage('queue');
    actions.setSidebar('closed');
    actions.setMode('coverflow');
    expect(transition).toHaveBeenCalledTimes(3);
  });

  it('过渡把更新压后执行时，连点按回调执行那一刻的状态叠加', () => {
    const store = createStore();
    const pending: (() => void)[] = [];
    const actions = createSceneActions(store, (update) => void pending.push(update));
    actions.setSidebar('closed');
    actions.setSidebar('open');
    expect(store.get(sceneStateAtom).sidebar).toBe('auto');
    expect(pending).toHaveLength(2);
    pending[0]!();
    expect(store.get(sceneStateAtom).sidebar).toBe('closed');
    pending[1]!();
    expect(store.get(sceneStateAtom).sidebar).toBe('open');
  });

  it('换预设：写回存档，下次读得到；同一个预设不起过渡', () => {
    const store = createStore();
    const { storage, map } = fakeStorage();
    const transition = vi.fn<SceneTransition>((update) => update());
    const actions = createSceneActions(store, transition);
    actions.switchPreset('landscape', 'split', storage);
    expect(store.get(presetIdAtoms.landscape)).toBe('split');
    expect(store.get(presetIdAtoms.portrait)).toBe('');
    expect(map.get('default-theme.immersive.presetLandscape.v1')).toBe('split');
    actions.switchPreset('landscape', 'split', storage);
    expect(transition).toHaveBeenCalledTimes(1);

    const next = createStore();
    loadPresetChoices(next, storage);
    expect(next.get(presetIdAtoms.landscape)).toBe('split');
    expect(next.get(presetIdAtoms.portrait)).toBe('');
  });

  it('进视图时复位到起始页，侧栏回自动，模式关掉', () => {
    const store = createStore();
    const actions = createSceneActions(store, direct);
    actions.selectPage('history');
    actions.setSidebar('open');
    actions.setMode('coverflow');
    actions.browse('a');
    resetScene(store, 'queue');
    expect(store.get(sceneStateAtom)).toEqual({
      page: 'queue',
      sidebar: 'auto',
      mode: 'none',
      browsed: null,
    });
  });

  it('各个 store 的状态互不影响', () => {
    const a = createStore();
    const b = createStore();
    createSceneActions(a, direct).setSidebar('closed');
    expect(a.get(sceneStateAtom).sidebar).toBe('closed');
    expect(b.get(sceneStateAtom).sidebar).toBe('auto');
  });
});

describe('历史快照', () => {
  it('取页、侧栏展开方式与模式，放回去时复原，浏览选中不存', () => {
    const store = createStore();
    const actions = createSceneActions(store, direct);
    resetScene(store, 'lyrics');
    actions.selectPage('queue');
    actions.setSidebar('open');
    actions.setMode('coverflow');
    actions.browse('queued:1');
    const snapshot = captureScene(store);
    expect(snapshot).toEqual({ page: 'queue', sidebar: 'open', mode: 'coverflow' });
    resetScene(store, 'lyrics');
    expect(store.get(sceneStateAtom).page).toBe('lyrics');
    restoreScene(store, snapshot);
    expect(store.get(sceneStateAtom)).toEqual({
      page: 'queue',
      sidebar: 'open',
      mode: 'coverflow',
      browsed: null,
    });
  });

  it('各个 store 的快照互不影响', () => {
    const a = createStore();
    const b = createStore();
    createSceneActions(a, direct).selectPage('history');
    expect(captureScene(a).page).toBe('history');
    expect(captureScene(b).page).toBe('lyrics');
  });
});

describe('唯一的修改入口', () => {
  it('模块对外不给能写的 atom：状态与预设选择都只读', () => {
    const exposed: Atom<unknown>[] = [];
    for (const value of Object.values(sceneActionsModule)) {
      if (typeof value === 'object' && value !== null && 'read' in value) {
        exposed.push(value as Atom<unknown>);
      }
    }
    exposed.push(...Object.values(presetIdAtoms));
    expect(exposed.length).toBeGreaterThan(2);
    for (const exportedAtom of exposed) expect('write' in exportedAtom).toBe(false);
  });
});
