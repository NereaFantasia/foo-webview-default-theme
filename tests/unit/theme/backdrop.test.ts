import type {
  ApiFailure,
  WindowBackdropPolicyPatch,
  WindowBackdropStateChangedPayload,
} from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  backdropChoiceAtom,
  materialAtom,
  windows10Atom,
  backdropFallbackAtom,
  backdropNoticeAtom,
  backdropSolidAtom,
  backdropDiagnosticsAtom,
  nativeMaterialsAllowedAtom,
  startBackdrop,
  type BackdropFace,
} from '../../../src/theme/backdrop.ts';
import type { PrefStorage } from '../../../src/kit/localPref.ts';
import { watchColorScheme } from '../../../src/theme/colorScheme.ts';
import { chooseBackgroundSource } from '../../../src/theme/background/windowBackground.ts';
import { fakeMedia } from '../../fixtures/fakeMedia.ts';

const DARK = '(prefers-color-scheme: dark)';
const STORAGE_KEY = 'default-theme.backdrop.v1';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

type PolicyAnswer = Awaited<ReturnType<BackdropFace['ui']['setBackdropPolicy']>>;
type WindowIdAnswer = Awaited<ReturnType<BackdropFace['ui']['getCurrentWindowId']>>;

interface HostOptions {
  available?: boolean;
  /** 取窗口 id 先等这个 Promise，用来让事件先于 id 到达。 */
  idGate?: Promise<void>;
  policyFails?: boolean;
  versionGate?: Promise<void>;
  platformVersion?: string;
  platform?: string;
  missingHints?: boolean;
  versionRejects?: boolean;
  policyGate?: Promise<void>;
  policyRejects?: boolean;
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
        const fails = options.policyFails;
        await options.policyGate;
        if (options.policyRejects) throw new Error('unavailable');
        if (fails) return failure;
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
  vi.stubGlobal('navigator', {
    userAgentData: options.missingHints
      ? undefined
      : {
          platform: options.platform ?? 'Windows',
          getHighEntropyValues: async () => {
            await options.versionGate;
            if (options.versionRejects) throw new Error('unavailable');
            return { platformVersion: options.platformVersion ?? '13.0.0' };
          },
        },
  });
  const store = createStore();
  const media = fakeMedia();
  watchColorScheme(store, media.matchMedia);
  const fake = makeHost(options);
  const service = startBackdrop(store, fake.host, storage);
  onTestFinished(() => service.dispose());
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
    await new Promise((resolve) => setTimeout(resolve, 0));
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

describe('自绘背景的原生底', () => {
  it.each(['cover', 'palette', 'image'] as const)(
    '%s 在首次下发前关闭原生材质，切回材质时恢复保存的选择',
    async (source) => {
      const storage = memoryStorage('acrylic');
      const { service, store, sent } = setup({}, storage);
      chooseBackgroundSource(store, source, null);
      await service.ready;
      expect(sent).toEqual([{ activeEffect: 'none', inactiveEffect: 'inherit', darkMode: false }]);
      expect(store.get(backdropChoiceAtom)).toBe('acrylic');
      expect(storage.saved.get(STORAGE_KEY)).toBe('acrylic');
      chooseBackgroundSource(store, 'material', null);
      expect(sent.at(-1)).toEqual({
        activeEffect: 'acrylic',
        inactiveEffect: 'inherit',
        darkMode: false,
      });
      service.dispose();
    },
  );

  it('自绘来源之间不重发，期间修改材质只保存，深浅仍同步，释放后不再监听来源', async () => {
    const storage = memoryStorage('mica');
    const { service, store, sent, media } = setup({}, storage);
    await service.ready;
    chooseBackgroundSource(store, 'cover', null);
    chooseBackgroundSource(store, 'palette', null);
    expect(sent.map(({ activeEffect }) => activeEffect)).toEqual(['mica', 'none']);
    service.choose('mica-alt');
    expect(storage.saved.get(STORAGE_KEY)).toBe('mica-alt');
    expect(sent).toHaveLength(2);
    media.set(DARK, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent.at(-1)).toEqual({
      activeEffect: 'none',
      inactiveEffect: 'inherit',
      darkMode: true,
    });
    chooseBackgroundSource(store, 'material', null);
    expect(sent.at(-1)).toEqual({
      activeEffect: 'mica-alt',
      inactiveEffect: 'inherit',
      darkMode: true,
    });
    expect(sent).toHaveLength(4);
    service.dispose();
    chooseBackgroundSource(store, 'image', null);
    expect(sent).toHaveLength(4);
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

describe('Windows 10 的材质限制', () => {
  const platformVersion = '10.0.0';

  it.each(['inherit', 'acrylic', 'mica', 'mica-alt', 'none'])(
    '存档为 %s 时下发无材质，保留存档并使用纯色',
    async (choice) => {
      const storage = memoryStorage(choice);
      const { service, store, sent, emit, media } = setup({ platformVersion }, storage);
      await service.ready;
      expect(store.get(windows10Atom)).toBe(true);
      expect(sent).toEqual([{ activeEffect: 'none', inactiveEffect: 'inherit', darkMode: false }]);
      expect(store.get(materialAtom)).toBe('none');
      emit('main', 'acrylic');
      expect(store.get(materialAtom)).toBe('none');
      for (const disabled of ['mica', 'mica-alt', 'acrylic', 'inherit'] as const)
        service.choose(disabled);
      expect(store.get(backdropChoiceAtom)).toBe(choice);
      expect(storage.saved.get(STORAGE_KEY)).toBe(choice);
      media.set(DARK, true);
      expect(sent.at(-1)).toEqual({
        activeEffect: 'none',
        inactiveEffect: 'inherit',
        darkMode: true,
      });
      service.dispose();
    },
  );

  it('检测返回前不下发材质，返回后使用用户最新的选择', async () => {
    let release = () => {};
    const versionGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, sent, store } = setup({ versionGate });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.get(windows10Atom)).toBeNull();
    expect(sent).toEqual([]);
    service.choose('acrylic');
    expect(sent).toEqual([]);
    release();
    await service.ready;
    expect(sent.at(-1)?.activeEffect).toBe('acrylic');
    service.dispose();
  });

  it.each([
    ['1.0.0', true],
    ['10.0.0', true],
    ['13.0.0', false],
    ['19.0.0', false],
    ['0.1.0', null],
    ['11.0.0', null],
    ['12.0.0', null],
    ['', null],
    ['10.invalid', null],
  ] as const)('平台版本 %s 的检测结果为 %s', async (platformVersion, expected) => {
    const { service, store, sent } = setup({ platformVersion }, memoryStorage('mica'));
    await service.ready;
    expect(store.get(windows10Atom)).toBe(expected);
    expect(sent.at(-1)?.activeEffect).toBe(expected === false ? 'mica' : 'none');
    service.dispose();
  });

  it.each([false, true])('版本读取失败保留未知状态，reject=%s', async (versionRejects) => {
    const { service, store, sent } = setup(
      {
        versionRejects,
        missingHints: !versionRejects,
      },
      memoryStorage('acrylic'),
    );
    await service.ready;
    expect(store.get(windows10Atom)).toBeNull();
    expect(store.get(materialAtom)).toBe('none');
    expect(sent.at(-1)?.activeEffect).toBe('none');
    expect(store.get(backdropFallbackAtom)).toBe('unknown');
    expect(store.get(backdropChoiceAtom)).toBe('acrylic');
    expect(store.get(nativeMaterialsAllowedAtom)).toBe(false);
    service.dispose();
  });

  it('释放后到达的系统版本不写状态、不下发材质', async () => {
    let release = () => {};
    const versionGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, store, sent, subscribed } = setup({ platformVersion, versionGate });
    await new Promise((resolve) => setTimeout(resolve, 0));
    service.dispose();
    release();
    await service.ready;
    expect(store.get(windows10Atom)).toBeNull();
    expect(sent).toEqual([]);
    expect(subscribed()).toBe(false);
  });

  it('其他平台的同名版本号不会当成 Windows 10', async () => {
    const { service, store, sent } = setup(
      { platform: 'macOS', platformVersion: '10.0.0' },
      memoryStorage('mica'),
    );
    await service.ready;
    expect(store.get(windows10Atom)).toBeNull();
    expect(sent.at(-1)?.activeEffect).toBe('none');
    service.dispose();
  });
});

it('显式主题背景和 Win10 回退共用自绘背景，正常原生材质不启用', async () => {
  for (const platformVersion of ['10.0.0', '13.0.0']) {
    const { store, service } = setup({ platformVersion }, memoryStorage('none'));
    await service.ready;
    expect(store.get(backdropSolidAtom)).toBe(true);
    expect(store.get(materialAtom)).toBe('none');
    expect(store.get(backdropFallbackAtom)).toBe(platformVersion === '10.0.0' ? 'windows10' : null);
  }
  const { store, service } = setup({}, memoryStorage('mica'));
  await service.ready;
  expect(store.get(backdropSolidAtom)).toBe(false);
});

describe('材质应用结果', () => {
  it.each([false, true])('窗口 id 晚到时只允许失败应答后的事件恢复，after=%s', async (after) => {
    let releaseId = () => {};
    let releasePolicy = () => {};
    const idGate = new Promise<void>((resolve) => {
      releaseId = resolve;
    });
    const policyGate = new Promise<void>((resolve) => {
      releasePolicy = resolve;
    });
    const { service, store, emit } = setup(
      { idGate, policyGate, policyFails: true },
      memoryStorage('mica'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!after) emit('main', 'mica');
    releasePolicy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (after) emit('main', 'mica');
    releaseId();
    await service.ready;
    expect(store.get(backdropFallbackAtom)).toBe(after ? null : 'failed');
    expect(store.get(materialAtom)).toBe(after ? 'mica' : 'none');
  });

  it('在途期间合并最新选择，串行完成后显示并保存最新材质', async () => {
    let release = () => {};
    const options: HostOptions = {
      policyGate: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    const storage = memoryStorage('mica');
    const { service, store, sent } = setup(options, storage);
    await service.ready;
    service.choose('acrylic');
    service.choose('mica-alt');
    options.policyGate = undefined;
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent.map((patch) => patch.activeEffect)).toEqual(['mica', 'mica-alt']);
    expect(store.get(materialAtom)).toBe('mica-alt');
    expect(storage.saved.get(STORAGE_KEY)).toBe('mica-alt');
  });

  it('前次请求的成功事件不能覆盖排队中新选择的失败', async () => {
    let release = () => {};
    const options: HostOptions = {
      policyGate: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    const { service, store, emit, sent } = setup(options, memoryStorage('mica'));
    await service.ready;
    options.policyGate = undefined;
    options.policyFails = true;
    service.choose('acrylic');
    expect(sent.at(-1)?.activeEffect).toBe('mica');
    emit('main', 'mica');
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent.at(-1)?.activeEffect).toBe('acrylic');
    expect(store.get(materialAtom)).toBe('none');
    expect(store.get(backdropFallbackAtom)).toBe('failed');
    expect(store.get(backdropChoiceAtom)).toBe('acrylic');
  });

  it('首次下发前缓存的事件不能掩盖随后请求的失败', async () => {
    let release = () => {};
    const versionGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, store, emit } = setup(
      { versionGate, policyFails: true },
      memoryStorage('acrylic'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    emit('main', 'mica');
    release();
    await service.ready;
    expect(store.get(backdropFallbackAtom)).toBe('failed');
    expect(store.get(materialAtom)).toBe('none');
    expect(store.get(backdropDiagnosticsAtom)).toContain('reported=mica, effective=none');
    expect(store.get(backdropDiagnosticsAtom)).toContain('application: failed');
  });

  it.each([false, true])('失败使用纯色并保留选择，reject=%s', async (policyRejects) => {
    vi.useFakeTimers();
    const { service, store, emit } = setup(
      { policyFails: !policyRejects, policyRejects },
      memoryStorage('mica'),
    );
    await service.ready;
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get(backdropFallbackAtom)).toBe('failed');
    expect(store.get(backdropSolidAtom)).toBe(true);
    expect(store.get(materialAtom)).toBe('none');
    expect(store.get(backdropChoiceAtom)).toBe('mica');
    expect(store.get(backdropNoticeAtom)).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.get(backdropNoticeAtom)).toBe('failed');
    emit('main', 'mica');
    expect(store.get(backdropNoticeAtom)).toBeNull();
    expect(store.get(materialAtom)).toBe('mica');
    expect(store.get(backdropDiagnosticsAtom)).toContain('reported=mica, effective=mica');
    expect(store.get(backdropDiagnosticsAtom)).toContain('application: applied');
  });

  it('启动暂时失败后成功事件解除回退，不留下提醒', async () => {
    vi.useFakeTimers();
    const { service, store, emit, sent } = setup({ policyFails: true }, memoryStorage('mica-alt'));
    await service.ready;
    await vi.advanceTimersByTimeAsync(10);
    emit('main', 'mica-alt');
    await vi.advanceTimersByTimeAsync(1500);
    expect(store.get(materialAtom)).toBe('mica-alt');
    expect(store.get(backdropNoticeAtom)).toBeNull();
    expect(sent.at(-1)?.activeEffect).toBe('mica-alt');
  });

  it('旧请求失败不能覆盖后一次选择的成功', async () => {
    let release = () => {};
    const options: HostOptions = {
      policyFails: true,
      policyGate: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    const { service, store } = setup(options, memoryStorage('mica'));
    await service.ready;
    options.policyGate = undefined;
    options.policyFails = false;
    service.choose('acrylic');
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.get(materialAtom)).toBe('acrylic');
    expect(store.get(backdropFallbackAtom)).toBeNull();
  });

  it('应答前的材质事件不能掩盖当前请求失败，后续成功事件可以恢复', async () => {
    let release = () => {};
    const policyGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, store, emit } = setup(
      { policyFails: true, policyGate },
      memoryStorage('mica'),
    );
    await service.ready;
    emit('popup', 'acrylic');
    emit('main', 'mica');
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.get(materialAtom)).toBe('none');
    expect(store.get(backdropFallbackAtom)).toBe('failed');
    emit('main', 'mica');
    expect(store.get(materialAtom)).toBe('mica');
    expect(store.get(backdropFallbackAtom)).toBeNull();
  });

  it('释放后失败应答和提醒计时器不再改变状态', async () => {
    vi.useFakeTimers();
    const { service, store } = setup({ policyFails: true }, memoryStorage('acrylic'));
    await service.ready;
    await vi.advanceTimersByTimeAsync(0);
    service.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.get(backdropNoticeAtom)).toBeNull();
  });
});
