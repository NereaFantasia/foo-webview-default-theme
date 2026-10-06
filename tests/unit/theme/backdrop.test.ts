import type {
  ApiFailure,
  WindowBackdropPolicyPatch,
  WindowBackdropStateChangedPayload,
} from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  backdropChoiceAtom,
  materialAtom,
  startBackdrop,
  type BackdropFace,
} from '../../../src/theme/backdrop.ts';
import type { PrefStorage } from '../../../src/kit/localPref.ts';
import { watchColorScheme } from '../../../src/theme/colorScheme.ts';
import { fakeMedia } from '../../fixtures/fakeMedia.ts';

const DARK = '(prefers-color-scheme: dark)';
const STORAGE_KEY = 'default-theme.backdrop.v1';

type PolicyAnswer = Awaited<ReturnType<BackdropFace['ui']['setBackdropPolicy']>>;
type WindowIdAnswer = Awaited<ReturnType<BackdropFace['ui']['getCurrentWindowId']>>;

interface HostOptions {
  available?: boolean;
  /** 取窗口 id 先等这个 Promise，用来让事件先于 id 到达。 */
  idGate?: Promise<void>;
  policyFails?: boolean;
}

// 替身按 SDK 声明填全字段、不做断言：宿主声明增删字段时这里会编译失败。
function makeHost(options: HostOptions = {}) {
  const sent: WindowBackdropPolicyPatch[] = [];
  let handler: ((payload: WindowBackdropStateChangedPayload) => void) | null = null;
  const failure: ApiFailure = { success: false, error: 'hidden', code: 'OPERATION_FAILED' };
  const host: BackdropFace = {
    isAvailable: () => options.available ?? true,
    ready: () => new Promise(() => {}),
    on: (_event, next) => {
      handler = next;
      return () => {
        handler = null;
      };
    },
    ui: {
      getCurrentWindowId: async (): Promise<WindowIdAnswer> => {
        await options.idGate;
        return { success: true, windowId: 'main' };
      },
      setBackdropPolicy: async (patch): Promise<PolicyAnswer> => {
        sent.push(patch);
        if (options.policyFails) return failure;
        return {
          success: true,
          windowId: 'main',
          backdropPolicy: {},
          resolvedBackdropPolicy: {
            activeEffect: patch.activeEffect ?? 'inherit',
            inactiveEffect: 'inherit',
            darkMode: patch.darkMode ?? false,
            reapplyOnActivate: false,
          },
        };
      },
    },
  };
  const emit = (windowId: string, effect: WindowBackdropStateChangedPayload['effect']) =>
    handler?.({ windowId, active: true, mode: 'active', effect });
  return { host, sent, emit, subscribed: () => handler !== null };
}

function memoryStorage(initial?: string): PrefStorage & { saved: Map<string, string> } {
  const saved = new Map<string, string>(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
  return {
    saved,
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => void saved.set(key, value),
  };
}

function setup(options: HostOptions = {}, storage: PrefStorage | null = memoryStorage()) {
  const store = createStore();
  const media = fakeMedia();
  watchColorScheme(store, media.matchMedia);
  const fake = makeHost(options);
  const service = startBackdrop(store, fake.host, storage);
  return { store, media, service, ...fake };
}

describe('读回选择', () => {
  it('存档里的合法档位生效；陌生值、缺失与读不了都回到跟随首选项', () => {
    expect(setup({}, memoryStorage('acrylic')).store.get(backdropChoiceAtom)).toBe('acrylic');
    expect(setup({}, memoryStorage('glass')).store.get(backdropChoiceAtom)).toBe('inherit');
    expect(setup({}, memoryStorage()).store.get(backdropChoiceAtom)).toBe('inherit');
    const broken: PrefStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
    };
    expect(setup({}, broken).store.get(backdropChoiceAtom)).toBe('inherit');
    expect(setup({}, null).store.get(backdropChoiceAtom)).toBe('inherit');
  });
});

describe('下发', () => {
  it('连上后按材质与深浅下发一次，失焦恒 inherit', async () => {
    const { service, sent } = setup({}, memoryStorage('mica'));
    await service.ready;
    expect(sent).toEqual([{ activeEffect: 'mica', inactiveEffect: 'inherit', darkMode: false }]);
  });

  it('深浅或材质变了才重发，同值不重发', async () => {
    const { service, sent, media } = setup();
    await service.ready;
    media.set(DARK, true);
    service.choose('acrylic');
    service.choose('acrylic');
    media.set(DARK, true);
    expect(sent.map(({ activeEffect, darkMode }) => [activeEffect, darkMode])).toEqual([
      ['inherit', false],
      ['inherit', true],
      ['acrylic', true],
    ]);
  });

  it('换材质记进存档', async () => {
    const storage = memoryStorage();
    const { service } = setup({}, storage);
    await service.ready;
    service.choose('mica-alt');
    expect(storage.saved.get(STORAGE_KEY)).toBe('mica-alt');
  });

  it('宿主答失败不重试，下一次变化照常下发', async () => {
    const { service, sent, media } = setup({ policyFails: true });
    await service.ready;
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    media.set(DARK, true);
    expect(sent).toHaveLength(2);
  });

  it('没连上宿主时不下发，页面按显式选中的档配浓度', () => {
    const { service, sent, store } = setup({ available: false });
    expect(store.get(materialAtom)).toBeNull();
    service.choose('acrylic');
    expect(store.get(materialAtom)).toBe('acrylic');
    expect(sent).toEqual([]);
    service.dispose();
  });
});

describe('宿主报的实际效果', () => {
  it('只认自己窗口的，以它为准覆盖显式选择', async () => {
    const { service, store, emit } = setup({}, memoryStorage('acrylic'));
    await service.ready;
    expect(store.get(materialAtom)).toBe('acrylic');
    emit('popup-1', 'none');
    expect(store.get(materialAtom)).toBe('acrylic');
    emit('main', 'mica');
    expect(store.get(materialAtom)).toBe('mica');
  });

  it('跟随首选项时只有宿主报了才知道实际材质', async () => {
    const { service, store, emit } = setup();
    await service.ready;
    expect(store.get(materialAtom)).toBeNull();
    emit('main', 'acrylic');
    expect(store.get(materialAtom)).toBe('acrylic');
  });

  it('窗口 id 取回之前到的事件，取回后补用自己那条', async () => {
    let release = () => {};
    const idGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, store, emit } = setup({ idGate });
    await new Promise((resolve) => setTimeout(resolve, 0));
    emit('main', 'mica-alt');
    emit('popup-1', 'none');
    expect(store.get(materialAtom)).toBeNull();
    release();
    await service.ready;
    expect(store.get(materialAtom)).toBe('mica-alt');
  });
});

describe('释放', () => {
  it('摘掉事件订阅，深浅再变也不下发', async () => {
    const { service, sent, media, subscribed } = setup();
    await service.ready;
    expect(subscribed()).toBe(true);
    service.dispose();
    expect(subscribed()).toBe(false);
    media.set(DARK, true);
    service.choose('mica');
    expect(sent).toHaveLength(1);
  });
});
