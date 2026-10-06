import { fb } from 'foo-webview-sdk/bridge';
import { onTestFinished } from 'vitest';
import {
  FakeHost,
  toWire,
  type FakeHostOptions,
  type FakeNative,
  type HostEvent,
  type HostEventPayload,
  type Listener,
} from './fakeHost.ts';

// 单测里把替身接到真实的 SDK 上：SDK 每次调用、订阅都现取全局 window 上的原生桥，这里在 Node 的
// 全局对象上临时放一个只有原生桥的 window，服务模块拿到的 `fb` 就是 SDK 自己的命名空间，
// 参数怎么拼、应答怎么解包都走 SDK 的真实代码。

export interface UnitHostOptions extends FakeHostOptions {
  /**
   * 缺省为 true。为 false 时宿主还没到：SDK 找不到原生桥，调用走它自带的 mock（100 ms 后
   * resolve `{ mock: true }`），订阅被静默丢掉；`ready()` 一直等到 `connect()`。
   */
  available?: boolean;
}

export class UnitHost extends FakeHost {
  /** 交给服务模块的宿主入口：SDK 的 `fb`，只有 `isAvailable` 与 `ready` 换成替身控制的。 */
  readonly fb: typeof fb;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly native: FakeNative;
  private readonly arrived: Promise<void>;
  private arrive: () => void = () => {};
  private available = false;
  private installed = false;
  private readonly previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

  constructor(options: UnitHostOptions = {}) {
    super(options);
    this.native = {
      invoke: (method, params) => this.invoke(method, params),
      on: (event, handler) => {
        this.listenersOf(event).add(handler);
        return () => this.native.off(event, handler);
      },
      off: (event, handler) => {
        this.listeners.get(event)?.delete(handler);
      },
      once: (event, handler) => {
        const wrapper: Listener = (data) => {
          this.native.off(event, wrapper);
          handler(data);
        };
        return this.native.on(event, wrapper);
      },
    };
    this.arrived = new Promise((resolve) => {
      this.arrive = resolve;
    });
    this.fb = { ...fb, isAvailable: () => this.available, ready: () => this.arrived };
    if (options.available !== false) this.connect();
  }

  /** 宿主到了：放上原生桥，`isAvailable()` 转真，`ready()` 完成。之前的订阅不会补上，与 SDK 一致。 */
  connect(): void {
    if (this.available) return;
    Object.defineProperty(globalThis, 'window', {
      value: { fb2k: this.native },
      configurable: true,
      writable: true,
    });
    this.installed = true;
    this.available = true;
    this.arrive();
  }

  listenerCount(event: HostEvent): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /**
   * 推一条宿主事件，载荷先过 JSON。监听器按订阅先后收到；有监听器抛错时其余照收，
   * 推完再把错误抛出来（宿主只记进控制台），免得服务里的异常在单测中被吞掉。
   */
  emit<K extends HostEvent>(event: K, payload: HostEventPayload<K>): void {
    const data = toWire(payload);
    const errors: unknown[] = [];
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try {
        listener(data);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, `${event} 的监听器抛错`);
  }

  /** 撤掉全局 window，还原成安装前的样子。`installFakeHost` 在测试结束时自动调用。 */
  dispose(): void {
    this.listeners.clear();
    if (!this.installed) return;
    this.installed = false;
    if (this.previousWindow) Object.defineProperty(globalThis, 'window', this.previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }

  private listenersOf(event: string): Set<Listener> {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    return set;
  }
}

/** 在当前测试里装一台宿主替身，测试结束时自动撤掉。一个测试只装一台。 */
export function installFakeHost(options: UnitHostOptions = {}): UnitHost {
  const host = new UnitHost(options);
  onTestFinished(() => host.dispose());
  return host;
}
