import type { Page } from '@playwright/test';
import {
  FakeHost,
  toWire,
  type FakeHostOptions,
  type FakeNative,
  type HostEvent,
  type HostEventPayload,
  type Listener,
} from './fakeHost.ts';
import { BIOGRAPHY_SOURCE_KEY } from '../../src/library/biography/biographySourcePrefs.ts';
import { LIBRARY_MIRROR_PREF_KEY } from '../../src/library/mirror/libraryMirror.ts';
import { START_PLACE_STORAGE_KEY } from '../../src/nav/startPlace.ts';
import { ONBOARDING_KEY } from '../../src/settings/onboarding/onboarding.ts';

// e2e 里把替身接到页面里真实的 SDK 上：页面脚本运行前先放一个原生桥，调用经 Playwright 的绑定回到
// Node 一侧的 FakeHost 应答，因此测试里写的应答函数、扣留与调用记录与单测是同一套。事件从 Node 推进页面，
// 分发方式与插件仓库 src/webview/WebViewHost.cpp 注入脚本的 `_emit` 一致：逐个调用监听器，抛错只记进控制台，
// 再在 window 上派发 `fb2k:<事件名>` 的 CustomEvent

interface BridgeNames {
  readonly invoke: string;
  readonly listen: string;
  readonly emit: string;
}

const NAMES: BridgeNames = {
  invoke: '__fakeHostInvoke',
  listen: '__fakeHostListen',
  emit: 'fake-host:emit',
};

export class PageHost extends FakeHost {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly page: Page,
    options?: FakeHostOptions,
  ) {
    // 缺省当作已经走完新人引导，不然每条用例的首屏都被引导挡住；测引导的用例自己把这条删掉。
    // 缺省关掉媒体库镜像：浏览器测试里没有本地后端，镜像开着时各页第一次读媒体库要先等后端连接，
    // 等满 3 秒才退回宿主，既拖慢每条用例，也让不等这 3 秒就操作的用例成了竞态。镜像的同步与读取由单测
    // 配真实后端覆盖。
    // 缺省预存简介来源 Apple。来源未保存而在线简介已开启时，主题会认定用户在升级前已开启在线简介，
    // 来源沿用 Last.fm。测试这项迁移的用例自行删除这一项
    super({
      ...options,
      config: {
        [ONBOARDING_KEY]: { version: 1, outcome: 'completed' },
        [LIBRARY_MIRROR_PREF_KEY]: { version: 1, enabled: false },
        [BIOGRAPHY_SOURCE_KEY]: { version: 1, source: 'apple', identities: [] },
        ...options?.config,
      },
    });
  }

  /** 页面里这个事件的监听器个数。增减经绑定异步回报，刚订阅完需要等待，用 `waitForListener` */
  listenerCount(event: HostEvent): number {
    return this.counts.get(event) ?? 0;
  }

  /** 等到页面订阅了这个事件。须先订阅再推送，推送过早页面收不到 */
  async waitForListener(event: HostEvent, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.listenerCount(event) === 0) {
      if (Date.now() > deadline) throw new Error(`${timeoutMs} ms 内页面没有订阅 ${event}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /** 往页面推送一条宿主事件，resolve 时页面的监听器都已执行完毕 */
  async emit<K extends HostEvent>(event: K, payload: HostEventPayload<K>): Promise<void> {
    await this.page.evaluate(
      ({ type, name, data }) => {
        window.dispatchEvent(new CustomEvent(type, { detail: { name, data } }));
      },
      { type: NAMES.emit, name: event, data: toWire(payload) },
    );
  }

  /** 页面上的订阅增减由 installPageHost 经绑定转到这里，测试不直接调用 */
  track(event: unknown, delta: unknown): void {
    if (typeof event !== 'string' || typeof delta !== 'number') return;
    this.counts.set(event, Math.max(0, (this.counts.get(event) ?? 0) + delta));
  }
}

/**
 * 在页面加载前装上宿主替身，须在 `page.goto` 之前调用。不装则等同普通浏览器：SDK 找不到宿主，
 * 页面应报未连接
 */
export async function installPageHost(page: Page, options?: FakeHostOptions): Promise<PageHost> {
  const host = new PageHost(page, options);
  await page.exposeFunction(NAMES.invoke, (method: unknown, params: unknown) =>
    typeof method === 'string'
      ? host.invoke(method, params)
      : Promise.reject(new Error('方法名不是字符串')),
  );
  await page.exposeFunction(NAMES.listen, (event: unknown, delta: unknown) =>
    host.track(event, delta),
  );
  await page.addInitScript(installPageBridge, NAMES);
  // 启动落点缺省为首页，而多数用例从专辑墙开始：页面打开前没有存档时预存专辑
  // 测缺省落点的用例须在此之后再注册初始脚本，删除该存档项。
  // 初始脚本在每个文档上都执行，about:blank 读 localStorage 会抛错，跳过
  await page.addInitScript((key) => {
    if (location.protocol === 'about:') return;
    if (localStorage.getItem(key) === null) localStorage.setItem(key, 'albums');
  }, START_PLACE_STORAGE_KEY);
  return host;
}

/** 收集页面错误与控制台 error，断言零错误时检查返回的数组是否为空 */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

// 在页面里执行：Playwright 把函数源码序列化后注入，因此不能引用这个文件里的其他绑定
function installPageBridge(names: BridgeNames): void {
  const listeners = new Map<string, Set<Listener>>();
  const binding = (name: string): unknown => Reflect.get(window, name);
  const report = (event: string, delta: number): void => {
    const listen = binding(names.listen);
    if (typeof listen === 'function') void listen(event, delta);
  };
  const native: FakeNative = {
    invoke(method, params) {
      const forward = binding(names.invoke);
      if (typeof forward !== 'function') return Promise.reject(new Error('替身绑定缺失'));
      // 与宿主注入脚本一致：参数经 postMessage 以 JSON 传递，缺省为空对象
      return Promise.resolve(forward(method, JSON.parse(JSON.stringify(params ?? {}))));
    },
    on(event, handler) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      if (!set.has(handler)) report(event, 1);
      set.add(handler);
      return () => native.off(event, handler);
    },
    off(event, handler) {
      if (listeners.get(event)?.delete(handler)) report(event, -1);
    },
    once(event, handler) {
      const wrapper: Listener = (data) => {
        native.off(event, wrapper);
        handler(data);
      };
      return native.on(event, wrapper);
    },
  };
  Object.defineProperty(window, 'fb2k', { value: native, configurable: true, writable: true });
  window.addEventListener(names.emit, (event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail: unknown = event.detail;
    if (typeof detail !== 'object' || detail === null) return;
    const name: unknown = Reflect.get(detail, 'name');
    const data: unknown = Reflect.get(detail, 'data');
    if (typeof name !== 'string') return;
    for (const handler of [...(listeners.get(name) ?? [])]) {
      try {
        handler(data);
      } catch (error) {
        console.error(error);
      }
    }
    window.dispatchEvent(new CustomEvent(`fb2k:${name}`, { detail: data, bubbles: true }));
  });
}
