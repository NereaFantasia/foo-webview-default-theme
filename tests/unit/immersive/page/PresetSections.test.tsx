// @vitest-environment jsdom
import { Provider } from 'jotai/react';
import { createStore } from 'jotai/vanilla';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GeneralSection,
  PresetChoiceSection,
  PresetGroupSection,
} from '../../../../src/immersive/page/PresetSections.tsx';
import { PRESETS } from '../../../../src/immersive/presets/presets.ts';
import { createSceneActions } from '../../../../src/immersive/scene/sceneActions.ts';
import {
  SceneActionsContext,
  SceneFrameContext,
} from '../../../../src/immersive/scene/sceneContext.ts';
import {
  collapseWithoutLyricsPref,
  presetOptionsPref,
} from '../../../../src/immersive/scene/scenePrefs.ts';

// 设置编辑里「视图」分类的预设单选与共用两项，以及预设的一组可调项：改了立刻写存档

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

let host: HTMLDivElement;

function mount(
  store: ReturnType<typeof createStore>,
  content: ReactNode,
  width = 1280,
  height = 800,
) {
  const actions = createSceneActions(store, (update) => update());
  const root = createRoot(host);
  act(() =>
    root.render(
      createElement(
        Provider,
        { store },
        createElement(
          SceneActionsContext,
          { value: actions },
          createElement(
            SceneFrameContext,
            { value: { width, height, visible: true, degraded: false } },
            content,
          ),
        ),
      ),
    ),
  );
}

const BLEED = PRESETS.find((entry) => entry.id === 'bleed')!;
const groupOf = (title: string) => BLEED.panel.find((group) => group.title === title)!;
const LAYOUT = groupOf('immersive.group.layout');
const MASK = groupOf('immersive.group.mask');

beforeEach(() => {
  (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  host.remove();
});

describe('预设单选与共用两项', () => {
  it('横版：两个预设都能选，打勾的是存档里选的那个；点满幅封面写进存档', () => {
    const store = createStore();
    mount(store, createElement(PresetChoiceSection));
    expect(host.querySelectorAll('[data-preset-choice]')).toHaveLength(2);
    const bleed = host.querySelector<HTMLElement>('[data-preset-choice="bleed"]')!;
    expect(bleed.getAttribute('aria-pressed')).toBe('false');
    act(() => bleed.click());
    expect(host.querySelector('[data-preset-choice="bleed"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('竖版只有缺省预设：预设单选整组不画', () => {
    mount(createStore(), createElement(PresetChoiceSection), 800, 1280);
    expect(host.querySelectorAll('[data-preset-choice]')).toHaveLength(0);
    expect(host.textContent).toBe('');
  });

  it('共用开关写自己的偏好：打开后偏好为真', () => {
    const store = createStore();
    mount(store, createElement(GeneralSection));
    const input = host.querySelector<HTMLInputElement>('[data-setting="collapse-without-lyrics"]')!;
    expect(store.get(collapseWithoutLyricsPref.atom)).toBe(false);
    act(() => input.click());
    expect(store.get(collapseWithoutLyricsPref.atom)).toBe(true);
  });
});

describe('预设的一组可调项', () => {
  /** 存档里满幅封面改过几项 */
  function bleedStore(stored: Record<string, unknown>) {
    const store = createStore();
    presetOptionsPref.set(store, { bleed: stored }, null);
    return store;
  }

  const input = (key: string) =>
    host.querySelector<HTMLInputElement>(`input[data-option="${key}"]`);
  const doubleClick = (key: string) => {
    act(() => {
      input(key)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
  };
  const reset = () => host.querySelector<HTMLButtonElement>('[data-group-reset]')!;

  it('只画这一组的项，读数带单位；底部边距在布局组里', () => {
    mount(bleedStore({}), createElement(PresetGroupSection, { entry: BLEED, group: LAYOUT }));
    expect(input('coverWidth')).not.toBeNull();
    expect(input('capsuleBottom')).not.toBeNull();
    expect(input('blur')).toBeNull();
    expect(host.textContent).toContain('58%');
    expect(host.textContent).toContain('36px');
  });

  it('滑块读出存档里的值；双击回到缺省：这一项从存档里拿掉，别的项不动', () => {
    const store = bleedStore({ coverWidth: 64, sideStart: 52 });
    mount(store, createElement(PresetGroupSection, { entry: BLEED, group: LAYOUT }));
    expect(input('coverWidth')?.value).toBe('64');
    doubleClick('coverWidth');
    expect(store.get(presetOptionsPref.atom)).toEqual({ bleed: { sideStart: 52 } });
    expect(input('coverWidth')?.value).toBe('58');
  });

  it('拿光了：整个预设的存档也拿掉，不留一个空的；别的预设不受影响', () => {
    const store = createStore();
    presetOptionsPref.set(store, { bleed: { blur: 12 }, other: { x: 1 } }, null);
    mount(store, createElement(PresetGroupSection, { entry: BLEED, group: MASK }));
    doubleClick('blur');
    expect(store.get(presetOptionsPref.atom)).toEqual({ other: { x: 1 } });
  });

  it('双击一个本来就是缺省的滑块：存档不变，不会把缺省值写进去', () => {
    const store = bleedStore({ coverWidth: 64 });
    mount(store, createElement(PresetGroupSection, { entry: BLEED, group: MASK }));
    doubleClick('blur');
    expect(store.get(presetOptionsPref.atom)).toEqual({ bleed: { coverWidth: 64 } });
  });

  it('恢复默认只恢复这一组：别的组改过的项留着；这一组没改过时置灰', () => {
    const store = bleedStore({ blur: 12, coverWidth: 64 });
    mount(store, createElement(PresetGroupSection, { entry: BLEED, group: MASK }));
    expect(reset().disabled).toBe(false);
    act(() => reset().click());
    expect(store.get(presetOptionsPref.atom)).toEqual({ bleed: { coverWidth: 64 } });
    expect(reset().disabled).toBe(true);
  });
});
