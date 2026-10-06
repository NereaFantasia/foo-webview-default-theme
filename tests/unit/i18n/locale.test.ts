import type { ApiErrorCode, ApiFailure } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../../src/i18n/en.ts';
import {
  localeAtom,
  localeSaveAtom,
  startLocale as startLocaleService,
  translateAtom,
  type LocaleFace,
} from '../../../src/i18n/locale.ts';
import { READY_TIMEOUT_MS } from '../../../src/host/waitForHost.ts';
import { createMemoryDataWriter } from '../../fixtures/dataWriter.ts';
import { DATA_GENERATION_PREFIX } from '../../../src/kit/dataWrite.ts';

function startLocale(
  store: ReturnType<typeof createStore>,
  host: LocaleFace,
  language: string,
  writer = createMemoryDataWriter().writer,
) {
  return startLocaleService(store, host, language, writer);
}

type ConfigValue = Parameters<LocaleFace['config']['set']>[1];

// 宿主给的 profile 路径可能带结尾的分隔符，拼目录时要去掉。
const PROFILE = 'E:\\FB2K\\foobar2000\\profile\\';
const DIR = 'E:\\FB2K\\foobar2000\\profile\\webview-ui-locales';
const KEY = 'defaultTheme.locale';

function failure(code: ApiErrorCode): ApiFailure {
  return { success: false, error: code, code };
}

interface HostOptions {
  /** 宿主报的语言；null 表示 getLocale 答失败信封。 */
  hostLocale?: string | null;
  /** 外部语言目录里的文件，文件名到内容，按调用时的内容答。缺省时目录不存在。 */
  files?: Record<string, string>;
  saved?: ConfigValue;
  /** 为假时宿主要等 `connect()` 才就绪。 */
  available?: boolean;
  /** 读文件先等这个 Promise，用来排出应答的先后。 */
  readGate?: Promise<void>;
  /** 问宿主语言先等这个 Promise，用来在初读中途插进用户操作。 */
  localeGate?: Promise<void>;
}

// 替身按 SDK 声明填全字段、不做断言：宿主声明增删字段时这里会编译失败。
function makeHost(options: HostOptions = {}) {
  let available = options.available ?? true;
  let arrive = () => {};
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  const config = new Map<string, ConfigValue>();
  if (options.saved !== undefined) config.set(KEY, options.saved);
  const files = options.files;
  const calls: string[] = [];
  const host: LocaleFace = {
    isAvailable: () => available,
    ready: () => arrived,
    system: {
      getLocale: async () => {
        await options.localeGate;
        return options.hostLocale === null
          ? failure('OPERATION_FAILED')
          : { success: true, locale: options.hostLocale ?? 'en-US', language: '', country: '' };
      },
    },
    misc: { getProfilePath: async () => ({ success: true, path: PROFILE, value: PROFILE }) },
    file: {
      list: async (path, opts) => {
        calls.push(`list ${path} ${opts?.pattern ?? ''}`);
        if (!files || path !== DIR) return failure('NOT_FOUND');
        const names = Object.keys(files);
        return { success: true, files: names, directories: [], items: names };
      },
      read: async (path) => {
        await options.readGate;
        const name = path.startsWith(`${DIR}\\`) ? path.slice(DIR.length + 1) : '';
        const content = files && Object.hasOwn(files, name) ? files[name] : undefined;
        if (content === undefined) return failure('NOT_FOUND');
        return { success: true, content, size: content.length };
      },
    },
    config: {
      get: async (key) => ({
        success: true,
        key,
        value: config.get(key) ?? null,
        found: config.has(key),
      }),
      set: async (key, value) => {
        calls.push(`set ${key}=${String(value)}`);
        config.set(key, value);
        return { success: true, key };
      },
      remove: async (key) => {
        calls.push(`remove ${key}`);
        return { success: true, key, existed: config.delete(key) };
      },
    },
  };
  const connect = () => {
    available = true;
    arrive();
  };
  return { host, config, calls, connect };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('startLocale', () => {
  it('按浏览器语言同步起步，首帧不等宿主', () => {
    const store = createStore();
    startLocale(store, makeHost({ available: false }).host, 'zh-CN');
    expect(store.get(localeAtom).active).toBe('zh-CN');
    expect(store.get(translateAtom)('host.unavailable')).toBe('未连接 foobar2000');
  });

  it('连上后改按宿主语言，并列出外部语言文件', async () => {
    const store = createStore();
    const { host, calls } = makeHost({
      hostLocale: 'en-US',
      files: { 'fr.json': '{}', 'de-DE.json': '{}', 'notes.txt.json': '{}' },
    });
    await startLocale(store, host, 'zh-CN').ready;
    const state = store.get(localeAtom);
    expect(state).toMatchObject({ base: 'en', active: 'en', chosen: null });
    expect(state.available).toEqual(['en', 'zh-CN', 'fr', 'de-DE']);
    expect(calls).toContain(`list ${DIR} *.json`);
  });

  it('宿主语言与外部目录都拿不到时停在上一层', async () => {
    const store = createStore();
    await startLocale(store, makeHost({ hostLocale: null }).host, 'zh-CN').ready;
    expect(store.get(localeAtom)).toMatchObject({ base: 'zh-CN', active: 'zh-CN' });
    expect(store.get(localeAtom).available).toEqual(['en', 'zh-CN']);
  });

  it('等不到宿主时不调宿主，停在浏览器语言', async () => {
    vi.useFakeTimers();
    const store = createStore();
    const { host, calls } = makeHost({ available: false, saved: 'en' });
    const service = startLocale(store, host, 'zh-CN');
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    await service.ready;
    expect(store.get(localeAtom).active).toBe('zh-CN');
    expect(calls).toEqual([]);
  });

  it('应用存档里选定的内置语言', async () => {
    const store = createStore();
    await startLocale(store, makeHost({ saved: 'zh-CN' }).host, 'en-US').ready;
    expect(store.get(localeAtom)).toMatchObject({ active: 'zh-CN', chosen: 'zh-CN', base: 'en' });
    expect(store.get(translateAtom)('host.readFailed')).toBe('组件版本读取失败');
  });

  it('外部语言包只收已知键与字符串值，缺的键回落基准语言', async () => {
    const store = createStore();
    const content = JSON.stringify({
      'host.unavailable': 'Pas connecté',
      'host.readFailed': 42,
      'no.such.key': 'x',
    });
    const { host } = makeHost({ saved: 'fr', files: { 'fr.json': content } });
    await startLocale(store, host, 'en-US').ready;
    const t = store.get(translateAtom);
    expect(store.get(localeAtom)).toMatchObject({ active: 'fr', chosen: 'fr' });
    expect(store.get(localeAtom).overlay).toEqual({ 'host.unavailable': 'Pas connecté' });
    expect(t('host.unavailable')).toBe('Pas connecté');
    expect(t('host.readFailed')).toBe(en['host.readFailed']);
  });

  it('存档指向读不到或不成形的文件、或存了坏值时仍跟随宿主', async () => {
    for (const [saved, files] of [
      ['fr', {}],
      ['fr', { 'fr.json': '{ not json' }],
      ['fr', { 'fr.json': '{"no.such.key":"x"}' }],
      ['../../evil', {}],
      [42, {}],
    ] as const) {
      const store = createStore();
      await startLocale(store, makeHost({ saved, files }).host, 'en-US').ready;
      expect(store.get(localeAtom), String(saved)).toMatchObject({ active: 'en', chosen: null });
    }
  });
});

describe('语言选择的持久化', () => {
  it('启动期间外部语言选择未能生效时，仍恢复原先保存的语言', async () => {
    const store = createStore();
    let release = () => {};
    const localeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { host } = makeHost({ saved: 'zh-CN', files: { 'fr.json': '' }, localeGate });
    const service = startLocale(store, host, 'en');
    await Promise.resolve();
    await service.refresh();
    expect(store.get(localeAtom).available).toContain('fr');
    expect(await service.choose('fr')).toBe(false);
    release();
    await service.ready;
    expect(store.get(localeAtom)).toMatchObject({ active: 'zh-CN', chosen: 'zh-CN' });
    expect(store.get(localeSaveAtom)).toBe('idle');
    service.dispose();
  });

  it('之后的外部语言读不到时，仍接收当前选择的保存结果', async () => {
    const store = createStore();
    const { host } = makeHost();
    let release = () => {};
    let entered = () => {};
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    host.config.set = async () => {
      entered();
      await gate;
      return failure('OPERATION_FAILED');
    };
    const service = startLocale(store, host, 'en');
    await service.ready;
    const selected = service.choose('zh-CN');
    await ready;
    expect(await service.choose('fr')).toBe(false);
    release();
    await selected;
    expect(store.get(localeAtom).active).toBe('zh-CN');
    expect(store.get(localeSaveAtom)).toBe('failed');
    service.dispose();
  });

  it('旧选择的保存失败晚到时，不覆盖新选择的成功状态', async () => {
    const store = createStore();
    const { host, config } = makeHost();
    const { writer, values } = createMemoryDataWriter();
    let release = () => {};
    let entered = () => {};
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = host.config.set;
    host.config.set = async (key, value) => {
      if (value === 'zh-CN') {
        entered();
        await gate;
        return failure('OPERATION_FAILED');
      }
      return original(key, value);
    };
    const service = startLocale(store, host, 'en', writer);
    await service.ready;
    const first = service.choose('zh-CN');
    await ready;
    const second = service.choose('en');
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(store.get(localeAtom).active).toBe('en');
    expect(store.get(localeSaveAtom)).toBe('saved');
    expect(config.get(KEY)).toBe('en');
    expect(values.get(`${DATA_GENERATION_PREFIX}config:${KEY}`)).toBe('1');
    service.dispose();
  });

  it('等不到宿主时把待保存改为失败，之后的选择也只在内存生效', async () => {
    vi.useFakeTimers();
    const store = createStore();
    const { host, config } = makeHost({ available: false });
    const service = startLocale(store, host, 'en');
    await service.choose('zh-CN');
    expect(store.get(localeSaveAtom)).toBe('pending');
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    await service.ready;
    expect(store.get(localeSaveAtom)).toBe('failed');
    await service.choose('en');
    expect(store.get(localeSaveAtom)).toBe('failed');
    expect(config.has(KEY)).toBe(false);
    service.dispose();
  });

  it('保存失败时保留当前语言并记录失败，重试成功后清除错误', async () => {
    const store = createStore();
    const { host, config } = makeHost();
    const { writer, values } = createMemoryDataWriter();
    const original = host.config.set;
    host.config.set = async () => failure('OPERATION_FAILED');
    const service = startLocale(store, host, 'en', writer);
    await service.ready;
    expect(await service.choose('zh-CN')).toBe(true);
    expect(store.get(localeAtom).active).toBe('zh-CN');
    expect(store.get(localeSaveAtom)).toBe('failed');
    expect(config.has(KEY)).toBe(false);
    expect(values.size).toBe(0);
    host.config.set = original;
    expect(await service.choose('zh-CN')).toBe(true);
    expect(store.get(localeSaveAtom)).toBe('saved');
    expect(config.get(KEY)).toBe('zh-CN');
    expect(values.get(`${DATA_GENERATION_PREFIX}config:${KEY}`)).toBe('1');
    await service.followHost();
    expect(config.has(KEY)).toBe(false);
    expect(values.get(`${DATA_GENERATION_PREFIX}config:${KEY}`)).toBe('2');
    service.dispose();
  });

  it('跟随宿主的清除失败仍切回基准语言，但不能推进代数', async () => {
    const store = createStore();
    const { host, config } = makeHost({ saved: 'zh-CN' });
    const { writer, values } = createMemoryDataWriter();
    host.config.remove = async () => failure('OPERATION_FAILED');
    const service = startLocale(store, host, 'en', writer);
    await service.ready;
    await service.followHost();
    expect(store.get(localeAtom)).toMatchObject({ active: 'en', chosen: null });
    expect(store.get(localeSaveAtom)).toBe('failed');
    expect(config.get(KEY)).toBe('zh-CN');
    expect(values.size).toBe(0);
    service.dispose();
  });

  it('释放时取消排队写入，持锁的操作仍能结束', async () => {
    const store = createStore();
    const { host, config } = makeHost();
    const { writer, values } = createMemoryDataWriter();
    let release = () => {};
    let entered = () => {};
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = startLocale(store, host, 'en', writer);
    await service.ready;
    const blocker = writer.run(async () => {
      entered();
      await gate;
    });
    await ready;
    const selection = service.choose('zh-CN');
    await Promise.resolve();
    expect(store.get(localeSaveAtom)).toBe('pending');
    service.dispose();
    expect(await selection).toBe(true);
    expect(config.has(KEY)).toBe(false);
    expect(values.size).toBe(0);
    release();
    await blocker;
    await service.followHost();
    expect(await service.choose('en')).toBe(false);
    expect(values.size).toBe(0);
  });

  it('用户选择正在等锁时，初读完成不能把旧存档重新显示出来', async () => {
    const store = createStore();
    let releaseLocale = () => {};
    const localeGate = new Promise<void>((resolve) => {
      releaseLocale = resolve;
    });
    const { host } = makeHost({ saved: 'en', localeGate });
    const { writer } = createMemoryDataWriter();
    let entered = () => {};
    let release = () => {};
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = writer.run(async () => {
      entered();
      await gate;
    });
    await ready;
    const service = startLocale(store, host, 'en', writer);
    await Promise.resolve();
    const selection = service.choose('zh-CN');
    await Promise.resolve();
    releaseLocale();
    await service.ready;
    expect(store.get(localeAtom)).toMatchObject({ active: 'zh-CN', chosen: 'zh-CN' });
    expect(store.get(localeSaveAtom)).toBe('pending');
    release();
    await blocker;
    await selection;
    expect(store.get(localeSaveAtom)).toBe('saved');
    service.dispose();
  });

  it('没有注入写入助手时只切换内存状态，不绕过代数写宿主', async () => {
    const store = createStore();
    const { host, config } = makeHost();
    const service = startLocaleService(store, host, 'en');
    await service.ready;
    expect(await service.choose('zh-CN')).toBe(true);
    expect(store.get(localeAtom).active).toBe('zh-CN');
    expect(store.get(localeSaveAtom)).toBe('failed');
    expect(config.has(KEY)).toBe(false);
    service.dispose();
  });
});

describe('选择语言', () => {
  it('连上后选择立即生效并记进 config；回到跟随宿主时删掉存档', async () => {
    const store = createStore();
    const { host, config, calls } = makeHost();
    const service = startLocale(store, host, 'en-US');
    await service.ready;
    expect(await service.choose('zh-CN')).toBe(true);
    expect(store.get(localeAtom)).toMatchObject({ active: 'zh-CN', chosen: 'zh-CN' });
    expect(config.get(KEY)).toBe('zh-CN');

    await service.followHost();
    expect(store.get(localeAtom)).toMatchObject({ active: 'en', chosen: null });
    expect(config.has(KEY)).toBe(false);
    expect(calls.filter((call) => !call.startsWith('list'))).toEqual([
      `set ${KEY}=zh-CN`,
      `remove ${KEY}`,
    ]);
  });

  it('就绪前的选择为准：存档让位，连上后补写一次', async () => {
    const store = createStore();
    const { host, config, calls, connect } = makeHost({ available: false, saved: 'en' });
    const service = startLocale(store, host, 'en-US');
    expect(await service.choose('zh-CN')).toBe(true);
    expect(store.get(localeAtom).active).toBe('zh-CN');
    expect(calls).toEqual([]);

    connect();
    await service.ready;
    expect(store.get(localeAtom)).toMatchObject({ active: 'zh-CN', chosen: 'zh-CN' });
    expect(config.get(KEY)).toBe('zh-CN');
    expect(calls.filter((call) => call.startsWith('set'))).toEqual([`set ${KEY}=zh-CN`]);
  });

  it('就绪前记下的选择还没补写时又选了一次，只写后来的那次', async () => {
    let release = () => {};
    const localeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = createStore();
    const { host, config, calls, connect } = makeHost({ available: false, localeGate });
    const service = startLocale(store, host, 'en-US');
    await service.choose('zh-CN');
    connect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await service.followHost();
    release();
    await service.ready;
    expect(store.get(localeAtom)).toMatchObject({ active: 'en', chosen: null });
    expect(config.has(KEY)).toBe(false);
    expect(calls.filter((call) => !call.startsWith('list'))).toEqual([`remove ${KEY}`]);
  });

  it('连点只认最后一次：晚到的外部语言包不覆盖后来的选择', async () => {
    let release = () => {};
    const readGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = createStore();
    const files = { 'fr.json': '{"host.unavailable":"Pas connecté"}' };
    const { host, config } = makeHost({ files, readGate });
    const service = startLocale(store, host, 'en-US');
    await service.ready;
    const slow = service.choose('fr');
    expect(await service.choose('zh-CN')).toBe(true);
    release();
    expect(await slow).toBe(false);
    expect(store.get(localeAtom)).toMatchObject({ active: 'zh-CN', chosen: 'zh-CN' });
    expect(config.get(KEY)).toBe('zh-CN');
  });

  it('外部语言在连上宿主前选不了', async () => {
    const store = createStore();
    const service = startLocale(store, makeHost({ available: false }).host, 'en-US');
    expect(await service.choose('fr')).toBe(false);
    expect(store.get(localeAtom).active).toBe('en');
  });

  it('释放后晚到的初读不再改状态', async () => {
    const store = createStore();
    const { host, connect } = makeHost({ available: false, hostLocale: 'zh-CN' });
    const service = startLocale(store, host, 'en-US');
    service.dispose();
    connect();
    await service.ready;
    expect(store.get(localeAtom).active).toBe('en');
  });

  it('refresh 重新列出外部语言文件', async () => {
    const store = createStore();
    const files: Record<string, string> = {};
    const { host } = makeHost({ files });
    const service = startLocale(store, host, 'en-US');
    await service.ready;
    expect(store.get(localeAtom).available).toEqual(['en', 'zh-CN']);
    files['ja.json'] = '{}';
    await service.refresh();
    expect(store.get(localeAtom).available).toEqual(['en', 'zh-CN', 'ja']);
  });
});
