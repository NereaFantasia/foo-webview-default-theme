import { createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import {
  backdropChoiceAtom,
  backdropOptionsAtom,
  chooseBackdrop,
  chooseBackdropFlowSpeed,
} from '../../../../src/immersive/backdrop/backdropState.ts';
import {
  EDIT_VIEW,
  cancelEdit,
  chooseEditCategory,
  editCategoryAtom,
  editOpenAtom,
  enterEdit,
  finishEdit,
} from '../../../../src/immersive/page/editSession.ts';
import {
  chooseImmersiveScene,
  immersiveSceneAtom,
} from '../../../../src/immersive/page/immersivePrefs.ts';
import { createSceneActions, presetIdAtoms } from '../../../../src/immersive/scene/sceneActions.ts';
import { presetOptionsPref } from '../../../../src/immersive/scene/scenePrefs.ts';

// 设置编辑的「完成」与「取消」：改动即时写存档，「取消」把进入时的值写回去

function setup() {
  const store = createStore();
  const actions = createSceneActions(store, (update) => update());
  return { store, actions };
}

describe('设置编辑', () => {
  it('取消：编辑里改过的预设可调项、背景、视图样式都回到进入时的值，编辑关上', () => {
    const { store } = setup();
    presetOptionsPref.set(store, { bleed: { blur: 12 } }, null);
    chooseImmersiveScene(store, 'presets', null);
    enterEdit(store);
    expect(store.get(editOpenAtom)).toBe(true);
    presetOptionsPref.set(store, { bleed: { blur: 4, coverWidth: 64 } }, null);
    chooseBackdrop(store, 'titanium', null);
    chooseBackdropFlowSpeed(store, 150, null);
    chooseImmersiveScene(store, 'paper', null);
    cancelEdit(store);
    expect(store.get(editOpenAtom)).toBe(false);
    expect(store.get(presetOptionsPref.atom)).toEqual({ bleed: { blur: 12 } });
    expect(store.get(backdropChoiceAtom)).toBe('mesh');
    expect(store.get(backdropOptionsAtom).flowSpeed).toBeUndefined();
    expect(store.get(immersiveSceneAtom)).toBe('presets');
  });

  it('完成：改动保留，编辑关上；之后再取消也不会写回', () => {
    const { store } = setup();
    enterEdit(store);
    presetOptionsPref.set(store, { bleed: { blur: 4 } }, null);
    finishEdit(store);
    cancelEdit(store);
    expect(store.get(editOpenAtom)).toBe(false);
    expect(store.get(presetOptionsPref.atom)).toEqual({ bleed: { blur: 4 } });
  });

  it('已经在编辑里再进入一次：保留第一次记下的值', () => {
    const { store } = setup();
    enterEdit(store);
    presetOptionsPref.set(store, { bleed: { blur: 4 } }, null);
    enterEdit(store);
    cancelEdit(store);
    expect(store.get(presetOptionsPref.atom)).toEqual({});
  });

  it('取消时换回预设：给了场景动作就走它（带场景过渡），没给就直接写', () => {
    const { store, actions } = setup();
    enterEdit(store);
    actions.switchPreset('landscape', 'bleed', null);
    const switchPreset = vi.fn();
    cancelEdit(store, switchPreset);
    expect(switchPreset).toHaveBeenCalledWith('landscape', '');

    enterEdit(store);
    actions.switchPreset('landscape', 'split', null);
    cancelEdit(store);
    expect(store.get(presetIdAtoms.landscape)).toBe('bleed');
  });

  it('停在哪个分类记在本次运行里：退出再进来还是它；缺省是「视图」', () => {
    const { store } = setup();
    expect(store.get(editCategoryAtom)).toBe(EDIT_VIEW);
    enterEdit(store);
    chooseEditCategory(store, 'immersive.group.mask');
    finishEdit(store);
    enterEdit(store);
    expect(store.get(editCategoryAtom)).toBe('immersive.group.mask');
  });
});
