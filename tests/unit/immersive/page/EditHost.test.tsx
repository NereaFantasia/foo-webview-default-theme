// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditCard } from '../../../../src/immersive/page/EditCard.tsx';
import { EditHost, type EditSpec } from '../../../../src/immersive/page/EditHost.tsx';
import {
  chooseEditCategory,
  editCategoryAtom,
  editOpenAtom,
  enterEdit,
  finishEdit,
} from '../../../../src/immersive/page/editSession.ts';
import { SliderRow } from '../../../../src/immersive/page/SettingsRows.tsx';
import { ControlSlotsContext } from '../../../../src/immersive/scene/sceneContext.ts';
import { presetOptionsPref } from '../../../../src/immersive/scene/scenePrefs.ts';
import { startSceneEnv, type SceneEnv } from '../../../fixtures/sceneEnv.ts';

// 设置编辑的宿主：编辑条经控制层的挂载点放到顶部，卡片画当前分类；卡片里按住滑块拖动时只留那一行

const CATEGORIES: readonly [EditSpec, ...EditSpec[]] = [
  { id: 'view', label: 'immersive.edit.view', dock: 'end', content: <p data-content="view" /> },
  {
    id: 'immersive.group.mask',
    label: 'immersive.group.mask',
    dock: 'start',
    content: <p data-content="mask" />,
  },
];

beforeEach(() => {
  // jsdom 没有 matchMedia（Fluent 的页签与动效要用）
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function mountHost(env: SceneEnv) {
  const slot = document.createElement('div');
  document.body.append(slot);
  const root = env.mount(
    <ControlSlotsContext value={{ tabs: null, views: null, edit: slot }}>
      <EditHost categories={CATEGORIES} />
    </ControlSlotsContext>,
  );
  return { slot, root };
}

const card = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-edit-card]');

describe('EditHost', () => {
  it('不在编辑里时编辑条与卡片都不画', async () => {
    const env = await startSceneEnv();
    const { slot, root } = mountHost(env);
    expect(slot.childElementCount).toBe(0);
    expect(card(root)).toBeNull();
  });

  it('进入编辑：编辑条进控制层的挂载点，选中第一个分类；卡片停右边，画它的内容', async () => {
    const env = await startSceneEnv();
    const { slot, root } = mountHost(env);
    act(() => enterEdit(env.store));
    expect(slot.querySelectorAll('[data-edit-category]')).toHaveLength(2);
    expect(slot.querySelector('[data-edit-category="view"]')?.getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(card(root)?.dataset['dock']).toBe('end');
    expect(card(root)?.querySelector('[data-content="view"]')).not.toBeNull();
  });

  it('点页签换分类：卡片换内容、换到另一侧，停留的分类记下', async () => {
    const env = await startSceneEnv();
    const { slot, root } = mountHost(env);
    act(() => enterEdit(env.store));
    act(() =>
      slot.querySelector<HTMLElement>('[data-edit-category="immersive.group.mask"]')?.click(),
    );
    expect(env.store.get(editCategoryAtom)).toBe('immersive.group.mask');
    expect(card(root)?.dataset['dock']).toBe('start');
    expect(card(root)?.querySelector('[data-content="mask"]')).not.toBeNull();
  });

  it('停留的分类不在这个场景的表里时退回第一个', async () => {
    const env = await startSceneEnv();
    const { root } = mountHost(env);
    act(() => chooseEditCategory(env.store, 'waveform'));
    act(() => enterEdit(env.store));
    expect(card(root)?.querySelector('[data-content="view"]')).not.toBeNull();
  });

  it('「完成」关上编辑并保留改动；「取消」把进入时的值写回去', async () => {
    const env = await startSceneEnv();
    const { slot } = mountHost(env);
    act(() => enterEdit(env.store));
    act(() => presetOptionsPref.set(env.store, { bleed: { blur: 4 } }, null));
    act(() => slot.querySelector<HTMLElement>('[data-edit-done]')?.click());
    expect(env.store.get(editOpenAtom)).toBe(false);
    expect(env.store.get(presetOptionsPref.atom)).toEqual({ bleed: { blur: 4 } });

    act(() => enterEdit(env.store));
    act(() => presetOptionsPref.set(env.store, { bleed: { blur: 9 } }, null));
    act(() => slot.querySelector<HTMLElement>('[data-edit-cancel]')?.click());
    expect(env.store.get(editOpenAtom)).toBe(false);
    expect(env.store.get(presetOptionsPref.atom)).toEqual({ bleed: { blur: 4 } });
  });
});

describe('EditHost：拖动途中退出', () => {
  const pointer = (type: string, x: number) =>
    new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 10 });

  it('拖拖柄、按住滑块的途中退出编辑：下次进来卡片不让位，画面那一层也不藏', async () => {
    const env = await startSceneEnv();
    const slot = document.createElement('div');
    document.body.append(slot);
    const categories: readonly [EditSpec, ...EditSpec[]] = [
      {
        id: 'view',
        label: 'immersive.edit.view',
        dock: 'end',
        content: (
          <SliderRow
            label="Blur"
            value={7}
            min={0}
            max={16}
            step={1}
            option="blur"
            onChange={() => {}}
          />
        ),
      },
    ];
    const root = env.mount(
      <ControlSlotsContext value={{ tabs: null, views: null, edit: slot }}>
        <EditHost
          categories={categories}
          layer={(props) => (
            <button
              type="button"
              data-drag
              data-quiet={props.quiet || undefined}
              onClick={() => props.onDragging(true)}
            />
          )}
        />
      </ControlSlotsContext>,
    );
    act(() => enterEdit(env.store));
    act(() => root.querySelector<HTMLElement>('[data-drag]')?.click());
    const input = root.querySelector<HTMLInputElement>('input[data-option="blur"]')!;
    act(() => {
      input.dispatchEvent(pointer('pointerdown', 10));
      document.dispatchEvent(pointer('pointermove', 30));
    });
    expect(card(root)?.hasAttribute('data-yielded')).toBe(true);
    expect(root.querySelector('[data-drag]')?.hasAttribute('data-quiet')).toBe(true);

    act(() => finishEdit(env.store));
    act(() => enterEdit(env.store));
    expect(card(root)?.hasAttribute('data-yielded')).toBe(false);
    expect(root.querySelector('[data-drag]')?.hasAttribute('data-quiet')).toBe(false);
  });
});

describe('EditCard', () => {
  function mountCard(env: SceneEnv) {
    return env.mount(
      <EditCard id="mask" dock="end" label="Mask">
        <SliderRow
          label="Blur"
          value={7}
          min={0}
          max={16}
          step={1}
          option="blur"
          onChange={() => {}}
        />
        <SliderRow
          label="Width"
          value={42}
          min={20}
          max={60}
          step={1}
          option="width"
          onChange={() => {}}
        />
      </EditCard>,
    );
  }

  const pointer = (type: string, x: number) =>
    new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 10 });

  it('按住滑块拖动：卡片让位，只留那一行；松手后恢复', async () => {
    const env = await startSceneEnv();
    const root = mountCard(env);
    const input = root.querySelector<HTMLInputElement>('input[data-option="blur"]')!;
    act(() => {
      input.dispatchEvent(pointer('pointerdown', 10));
    });
    expect(card(root)?.hasAttribute('data-holding')).toBe(false);
    act(() => {
      document.dispatchEvent(pointer('pointermove', 30));
    });
    expect(card(root)?.hasAttribute('data-holding')).toBe(true);
    const held = root.querySelectorAll('[data-held]');
    expect(held).toHaveLength(1);
    expect(held[0]?.contains(input)).toBe(true);
    act(() => {
      document.dispatchEvent(pointer('pointerup', 30));
    });
    expect(card(root)?.hasAttribute('data-holding')).toBe(false);
    expect(root.querySelectorAll('[data-held]')).toHaveLength(0);
  });

  it('点一下不挪：不让位', async () => {
    const env = await startSceneEnv();
    const root = mountCard(env);
    const input = root.querySelector<HTMLInputElement>('input[data-option="blur"]')!;
    act(() => {
      input.dispatchEvent(pointer('pointerdown', 10));
      document.dispatchEvent(pointer('pointermove', 11));
      document.dispatchEvent(pointer('pointerup', 11));
    });
    expect(card(root)?.hasAttribute('data-holding')).toBe(false);
  });
});
