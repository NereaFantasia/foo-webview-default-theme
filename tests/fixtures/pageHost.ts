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
import { ONBOARDING_KEY } from '../../src/settings/onboarding/onboarding.ts';

// e2e 里把替身接到页面里真实的 SDK 上：页面脚本运行前放一个原生桥，调用经 Playwright 的绑定回到
// Node 这边的 FakeHost 应答，所以测试里写的应答函数、扣留与调用记录与单测是同一套。事件从 Node
// 推进页面，分发照插件仓库 src/webview/WebViewHost.cpp 注入脚本的 `_emit`：逐个调监听器，抛错只记进
// 控制台，再在 window 上派发 `fb2k:<事件名>` 的 CustomEvent。

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
    super({
      ...options,
      config: { [ONBOARDING_KEY]: { version: 1, outcome: 'completed' }, ...options?.config },
    });
  }

  /** 页面里这个事件的监听器个数。增减经绑定异步报回，刚订阅完要等一下，用 `waitForListener`。 */
  listenerCount(event: HostEvent): number {
    return this.counts.get(event) ?? 0;
  }

  /** 等到页面订阅了这个事件；先订阅再推，推早了页面收不到。 */
  async waitForListener(event: HostEvent, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.listenerCount(event) === 0) {
      if (Date.now() > deadline) throw new Error(`${timeoutMs} ms 内页面没有订阅 ${event}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /** 往页面推一条宿主事件；resolve 时页面的监听器都已经跑完。 */
  async emit<K extends HostEvent>(event: K, payload: HostEventPayload<K>): Promise<void> {
    await this.page.evaluate(
      ({ type, name, data }) => {
        window.dispatchEvent(new CustomEvent(type, { detail: { name, data } }));
      },
      { type: NAMES.emit, name: event, data: toWire(payload) },
    );
  }

  /** 页面上的订阅增减由 installPageHost 经绑定接到这里，测试不直接调。 */
  track(event: unknown, delta: unknown): void {
    if (typeof event !== 'string' || typeof delta !== 'number') return;
    this.counts.set(event, Math.max(0, (this.counts.get(event) ?? 0) + delta));
  }
}

/**
 * 在页面加载前装上宿主替身，要在 `page.goto` 之前调用。不装就是普通浏览器：SDK 找不到宿主，
 * 页面应当报未连接。
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
  return host;
}

/** 收集页面错误与控制台 error；断言零错误时比较它是否为空数组。 */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

// 在页面里执行：Playwright 把函数源码序列化后注入，不能引用这个文件里的其他绑定。
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
      // 与宿主注入脚本一样：参数经 postMessage 走的是 JSON，缺省为空对象。
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
