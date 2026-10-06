import type { ApiResponseMap, FBEventPayloadMap, NativeFb2k } from 'foo-webview-sdk';
import { findParamKeyProblem, type ParamKeyProblem } from 'foo-webview-sdk/schema';
import { defaultAnswers, hostFailure, isRecord, type ConfigValue } from './hostAnswers.ts';

// 宿主替身的核心：按方法名应答线协议上的调用。单测经 unitHost.ts、e2e 经 pageHost.ts 接到真实的
// SDK 上，两边共用这里的应答表、调用记录、延迟与扣留。

/** 宿主声明过的方法名，取自 SDK 的 `ApiResponseMap`。 */
export type HostMethod = keyof ApiResponseMap;
/** 方法的应答：成功形状或失败信封。两者都是 resolve；reject 只留给超时、方法不存在这类框架级错误。 */
export type HostResponse<M extends HostMethod> = ApiResponseMap[M];
/** 宿主收到的参数：页面给的对象经过 JSON 往返，值为 undefined 的键已经不在了。 */
export type HostParams = Readonly<Record<string, unknown>>;
export type HostEvent = keyof FBEventPayloadMap;
export type HostEventPayload<K extends HostEvent> = FBEventPayloadMap[K];
export type Listener = (data: unknown) => void;

/**
 * 替身放到 window 上的原生桥。SDK 的 `NativeFb2k.invoke` 让调用方自选应答类型，替身答的是未经类型检查的
 * JSON，照实写成 `Promise<unknown>`，由 SDK 按声明收窄；订阅这一侧与 SDK 的声明逐项对齐。
 */
export type FakeNative = Pick<NativeFb2k, 'on' | 'off' | 'once'> & {
  invoke(method: string, params?: object): Promise<unknown>;
};

/** 固定应答，或按参数现算。函数抛错时调用方收到 reject，用来模拟框架级失败。 */
export type Answer<M extends HostMethod> =
  HostResponse<M> | ((params: HostParams) => HostResponse<M> | Promise<HostResponse<M>>);

type NamespaceOf<M extends string> = M extends `${infer N}.${string}` ? N : never;
type MemberOf<N extends string, M extends string = HostMethod> = M extends `${N}.${infer K}`
  ? K
  : never;
export type HostNamespace = NamespaceOf<HostMethod>;

/** 按命名空间写的应答表；方法名写错编译不过。 */
export type AnswerTable = {
  readonly [N in HostNamespace]?: {
    readonly [K in MemberOf<N>]?: Answer<Extract<`${N}.${K}`, HostMethod>>;
  };
};

export interface HostCall {
  readonly method: string;
  readonly params: HostParams;
}

export interface AnswerOptions {
  /** 应答晚到的毫秒数，走 setTimeout，可配合 `vi.useFakeTimers()`。缺省 0：不经定时器，在微任务里答。 */
  delayMs?: number;
}

/** 扣下的调用，由测试决定按什么顺序、用什么应答放行。 */
export interface HeldCalls<M extends HostMethod> {
  /** 还在等的调用的参数，先到的在前。 */
  readonly pending: readonly HostParams[];
  /** 放行第 index 个还在等的调用；不给 response 就按放行这一刻配置的应答答，不计延迟。 */
  respond(index: number, response?: HostResponse<M>): void;
  /** 不再扣下这个方法，还在等的按先后放行，规则同 respond。 */
  release(): void;
}

export interface FakeHostOptions {
  /** 盖在缺省应答上，按方法逐个覆盖。 */
  answers?: AnswerTable;
  /** config 存储的初值，键是完整的 config 键。 */
  config?: Readonly<Record<string, ConfigValue>>;
}

interface StoredAnswer {
  readonly answer: unknown;
  readonly delayMs: number;
}

interface ParkedCall {
  readonly params: HostParams;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

/** 按线协议的样子复制一份：值为 undefined 的键丢掉，替身与调用方不共享对象。 */
export function toWire(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export class FakeHost {
  /** 收到的每次调用，按到达先后；被拒收的也记。 */
  readonly calls: HostCall[] = [];
  /** `config.get` / `set` / `remove` 读写的存储。 */
  readonly config: Map<string, ConfigValue>;
  private readonly answers = new Map<string, StoredAnswer>();
  private readonly held = new Map<string, ParkedCall[]>();

  constructor(options: FakeHostOptions = {}) {
    this.config = new Map(Object.entries(options.config ?? {}));
    this.answerAll(defaultAnswers(this.config));
    this.answerAll(options.answers ?? {});
  }

  /** 换掉一个方法的应答；已经在路上的调用仍按收到时的配置答。 */
  answer<M extends HostMethod>(method: M, answer: Answer<M>, options: AnswerOptions = {}): void {
    this.answers.set(method, { answer, delayMs: options.delayMs ?? 0 });
  }

  answerAll(table: AnswerTable): void {
    for (const [namespace, members] of Object.entries(table)) {
      for (const [member, answer] of Object.entries(members ?? {})) {
        this.answers.set(`${namespace}.${member}`, { answer, delayMs: 0 });
      }
    }
  }

  /** 某个方法收到过的参数，按到达先后。 */
  callsTo(method: HostMethod): HostParams[] {
    return this.calls.filter((call) => call.method === method).map((call) => call.params);
  }

  /** 从现在起扣下这个方法的调用，直到 release。同一方法不能同时扣两次。 */
  hold<M extends HostMethod>(method: M): HeldCalls<M> {
    if (this.held.has(method)) throw new Error(`${method} 已经被扣下了`);
    const parked: ParkedCall[] = [];
    this.held.set(method, parked);
    return {
      get pending() {
        return parked.map((call) => call.params);
      },
      respond: (index, response) => {
        const call = index >= 0 ? parked.splice(index, 1)[0] : undefined;
        if (!call) throw new Error(`${method} 没有第 ${index} 个在等的调用`);
        if (response === undefined) this.answerParked(method, call);
        else call.resolve(toWire(response));
      },
      release: () => {
        this.held.delete(method);
        for (const call of parked.splice(0)) this.answerParked(method, call);
      },
    };
  }

  /**
   * 线协议的入口，与宿主注入的 `fb2k.invoke` 同一约定。没有配置应答的方法 reject，好让缺口在测试里
   * 露出来（宿主对没注册的方法也是 reject）。参数先过 JSON，再按 SDK 的参数声明查键：不是对象、
   * 带了声明外的键、缺了必填键，都答 INVALID_PARAMS 的失败信封，报错文字与宿主一致。只查键名，
   * 值的类型与范围不查。
   */
  async invoke(method: string, params?: unknown): Promise<unknown> {
    const wire = toWire(params ?? {});
    const record = isRecord(wire) ? wire : {};
    this.calls.push({ method, params: record });
    const stored = this.answers.get(method);
    if (!stored) throw new Error(`替身没有 ${method} 的应答`);
    if (!isRecord(wire)) return hostFailure('INVALID_PARAMS', 'params must be an object');
    const problem = findParamKeyProblem(method, record);
    if (problem) return hostFailure('INVALID_PARAMS', paramKeyError(problem));
    const parked = this.held.get(method);
    if (parked) {
      return new Promise((resolve, reject) => parked.push({ params: record, resolve, reject }));
    }
    return settle(stored, record);
  }

  private answerParked(method: string, call: ParkedCall): void {
    const stored = this.answers.get(method);
    if (!stored) {
      call.reject(new Error(`替身没有 ${method} 的应答`));
      return;
    }
    settle({ answer: stored.answer, delayMs: 0 }, call.params).then(call.resolve, call.reject);
  }
}

/** 与宿主 `src/api/ApiParams.h` 里 `Reader` 的 `IsObject`、`OnlyKeys`、`Required` 报的文字一致。 */
function paramKeyError({ path, reason }: ParamKeyProblem): string {
  switch (reason) {
    case 'unknown':
      return `unknown parameter '${path}'`;
    case 'missing':
      return `${path} is required`;
    case 'notObject':
      return path ? `${path} must be an object` : 'params must be an object';
  }
}

async function settle(stored: StoredAnswer, params: HostParams): Promise<unknown> {
  const { answer, delayMs } = stored;
  const value: unknown = typeof answer === 'function' ? await answer(params) : answer;
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  return toWire(value);
}
