import type {
  WindowActiveBackdropEffect,
  WindowBackdropStateChangedPayload,
} from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import { settle } from '../host/hostCall.ts';
import { colorSchemeAtom } from './colorScheme.ts';
import { backgroundSourceAtom } from './background/windowBackground.ts';
import { defineLocalPref, type PrefStorage } from '../kit/localPref.ts';
import type { Store } from '../kit/store.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/** 用户选择的窗口原生材质；取值与 `window.setBackdropPolicy` 的 activeEffect 一致；`inherit` 跟随 foobar2000 首选项 */
export type BackdropChoice = WindowActiveBackdropEffect;
/** 宿主回报的实际材质效果：`inherit` 解析完毕，不支持时自动降级回退；`system` 表示由系统承接绘制 */
export type BackdropEffect = WindowBackdropStateChangedPayload['effect'];

/** 材质枚举对照表（严格对照 SDK 类型定义）；读取的本地存档仅认表内有效值 */
const CHOICES: Readonly<Record<BackdropChoice, true>> = {
  inherit: true,
  none: true,
  mica: true,
  'mica-alt': true,
  acrylic: true,
};

/** 材质服务依赖的宿主接口：监听材质状态变更并调用策略下发接口 */
export interface BackdropFace extends HostReadyFace {
  on(
    event: 'window:backdropStateChanged',
    handler: (payload: WindowBackdropStateChangedPayload) => void,
  ): () => void;
  ui: Pick<typeof fb.ui, 'getCurrentWindowId' | 'setBackdropPolicy'>;
}

interface PlatformHints {
  readonly platform: string;
  getHighEntropyValues(hints: string[]): Promise<{ platformVersion?: string }>;
}

type Platform = 'checking' | 'absent' | 'windows10' | 'windows11' | 'unknown';

async function detectPlatform(): Promise<Platform> {
  try {
    const browser: Navigator & { readonly userAgentData?: PlatformHints } = navigator;
    const hints = browser.userAgentData;
    if (!hints || hints.platform !== 'Windows') return 'unknown';
    const { platformVersion } = await hints.getHighEntropyValues(['platformVersion']);
    if (typeof platformVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(platformVersion))
      return 'unknown';
    // 基于 UniversalApiContract 版本判定（非内核构建号）：Windows 10 为 1–10，Windows 11 起步为 13
    const major = Number(platformVersion.split('.')[0]);
    if (major >= 1 && major <= 10) return 'windows10';
    return major >= 13 ? 'windows11' : 'unknown';
  } catch {
    return 'unknown';
  }
}

function isChoice(value: string): value is BackdropChoice {
  return Object.hasOwn(CHOICES, value);
}

/** 材质配置保存在 localStorage：属于窗口级外观偏好，不存入宿主全局 config，避免与主程序首选项相互覆盖 */
export const BACKDROP_STORAGE_KEY = 'default-theme.backdrop.v1';
const choicePref = defineLocalPref<BackdropChoice>({
  key: BACKDROP_STORAGE_KEY,
  fallback: 'inherit',
  parse: (raw) => (isChoice(raw) ? raw : undefined),
  format: (choice) => choice,
});
const reportedAtom = atom<BackdropEffect | null>(null);
const platformAtom = atom<Platform>('checking');
const applicationAtom = atom<'idle' | 'pending' | 'applied' | 'failed'>('idle');
const failureCodeAtom = atom<string | null>(null);
const failureVisibleAtom = atom(false);
const effectiveAtom = atom<BackdropEffect | null>(null);

/** 系统是否为 Windows 10（null 表示版本检测进行中；检测失败不默认判定为 Win10） */
export const windows10Atom: Atom<boolean | null> = atom((get) => {
  const platform = get(platformAtom);
  return platform === 'windows10' ? true : platform === 'windows11' ? false : null;
});

/** 仅在已确认的 Windows 11 环境下允许尝试原生亚克力/云母材质；窗口与托盘共用判定 */
export const nativeMaterialsAllowedAtom = atom((get) => get(platformAtom) === 'windows11');
export type BackdropFallback = 'windows10' | 'unknown' | 'failed';
export const backdropFallbackAtom: Atom<BackdropFallback | null> = atom((get) => {
  const platform = get(platformAtom);
  if (platform === 'windows10' || platform === 'unknown') return platform;
  return get(applicationAtom) === 'failed' ? 'failed' : null;
});
/** 材质应用失败提示原子：启动阶段的失败可由后续成功事件自动解除，提示略后于纯色回退保护以防闪烁 */
export const backdropNoticeAtom = atom((get) => {
  const fallback = get(backdropFallbackAtom);
  return fallback === 'failed' && !get(failureVisibleAtom) ? null : fallback;
});
/** 标记是否采用纯色自绘底色（显式选择 none、降级回退或实际生效为 none 时激活） */
export const backdropSolidAtom = atom(
  (get) =>
    get(backdropFallbackAtom) !== null ||
    get(choicePref.atom) === 'none' ||
    get(effectiveAtom) === 'none',
);
export const backdropDiagnosticsAtom = atom((get) =>
  [
    `Window platform: ${get(platformAtom)}`,
    `Backdrop: requested=${get(choicePref.atom)}, reported=${get(reportedAtom) ?? 'unknown'}, effective=${get(materialAtom) ?? 'unknown'}`,
    `Backdrop application: ${get(applicationAtom)}${get(failureCodeAtom) ? ` (${get(failureCodeAtom)})` : ''}`,
  ].join('\n'),
);

export const backdropChoiceAtom: Atom<BackdropChoice> = choicePref.atom;

/**
 * 当前生效的窗口材质效果
 * 系统不支持、检测未知或应用失败时强制降级为 none（纯色）；成功时采用已上报效果；未完成解析的继承值返回 null
 */
export const materialAtom: Atom<BackdropEffect | null> = atom((get) => {
  if (get(backdropSolidAtom)) return 'none';
  if (get(platformAtom) !== 'absent' && get(applicationAtom) !== 'idle') return get(effectiveAtom);
  const choice = get(choicePref.atom);
  return choice === 'inherit' ? null : choice;
});

export interface BackdropService {
  /** 初始化完成时兑现（包括事件监听、系统版本检测、首次策略下发及窗口 ID 绑定）；调用方无需阻塞等待 */
  readonly ready: Promise<void>;
  /** 切换材质偏好并持久化；宿主连接就绪时立即下发，未就绪时先更新本地状态 */
  choose(choice: BackdropChoice): void;
  dispose(): void;
}

/**
 * 启动窗口材质服务：读取用户持久化偏好，连上宿主后根据背景来源、材质与深浅模式下发策略，
 * 并依宿主状态变更事件同步更新 `materialAtom`。深浅模式关联 `colorSchemeAtom`
 */
export function startBackdrop(
  store: Store,
  host: BackdropFace = fb,
  storage?: PrefStorage | null,
): BackdropService {
  choicePref.load(store, storage);
  store.set(reportedAtom, null);
  store.set(effectiveAtom, null);
  store.set(platformAtom, 'checking');
  store.set(applicationAtom, 'idle');
  store.set(failureCodeAtom, null);
  store.set(failureVisibleAtom, false);
  let disposed = false;
  let connected = false;
  let ownId: string | null = null;
  // 材质状态事件面向所有窗口广播，需依据 windowId 过滤本窗口事件；窗口 ID 获取前收到的事件暂存，获取后对齐补放
  const early = new Map<string, { effect: BackdropEffect; revision: number; received: number }>();
  // 记录最近一次下发的材质与深浅参数，防止相同配置重复排队
  let sent: { choice: BackdropChoice; darkMode: boolean } | null = null;
  let offEvent: (() => void) | undefined;
  let revision = 0;
  let reports = 0;
  let received = 0;
  let failureReceived = 0;
  let sending = false;
  let activeRevision: number | null = null;
  let queued: { choice: BackdropChoice; darkMode: boolean; revision: number } | null = null;
  let failureTimer: ReturnType<typeof setTimeout> | undefined;
  const waiter = waitForHost(host);

  function clearFailure(): void {
    clearTimeout(failureTimer);
    failureTimer = undefined;
    store.set(failureVisibleAtom, false);
    store.set(failureCodeAtom, null);
  }

  function accept(effect: BackdropEffect): void {
    reports += 1;
    clearFailure();
    store.set(reportedAtom, effect);
    store.set(effectiveAtom, effect);
    store.set(applicationAtom, 'applied');
  }

  async function flush(): Promise<void> {
    if (sending || disposed) return;
    sending = true;
    while (queued && !disposed) {
      const { choice, darkMode, revision: mine } = queued;
      queued = null;
      activeRevision = mine;
      const previousReports = reports;
      // 隐藏窗口下发策略可能暂报失败；保留该请求以便窗口显示时继续应用，不篡改用户预期
      const answer = await settle(() =>
        host.ui.setBackdropPolicy({ activeEffect: choice, inactiveEffect: 'inherit', darkMode }),
      );
      if (disposed || mine !== revision) continue;
      if (answer?.success) {
        if (reports === previousReports)
          store.set(effectiveAtom, choice === 'inherit' ? null : choice);
        store.set(applicationAtom, 'applied');
      } else {
        failureReceived = received;
        store.set(failureCodeAtom, answer?.code ?? 'NO_RESPONSE');
        store.set(applicationAtom, 'failed');
        failureTimer = setTimeout(() => {
          if (!disposed && mine === revision && store.get(applicationAtom) === 'failed')
            store.set(failureVisibleAtom, true);
        }, 1000);
      }
    }
    activeRevision = null;
    sending = false;
  }

  function send(): void {
    if (disposed || !connected) return;
    // 自绘背景需原生 WebView 提供不透明背景；若底层透明则自绘模糊层会穿透暴露底层内容；仅改写下发的策略材质，用户持久化偏好保持不变
    const drawn = store.get(backgroundSourceAtom) !== 'material';
    const choice =
      drawn || !store.get(nativeMaterialsAllowedAtom) ? 'none' : store.get(choicePref.atom);
    const darkMode = store.get(colorSchemeAtom) === 'dark';
    if (sent?.choice === choice && sent.darkMode === darkMode) return;
    sent = { choice, darkMode };
    queued = { choice, darkMode, revision: ++revision };
    clearFailure();
    store.set(applicationAtom, 'pending');
    // 状态事件不带请求 ID，通过串行排队下发隔离各版本响应
    void flush();
  }

  function onReported(payload: WindowBackdropStateChangedPayload): void {
    if (disposed) return;
    received += 1;
    if (ownId === null)
      early.set(payload.windowId, {
        effect: payload.effect,
        revision: activeRevision ?? revision,
        received,
      });
    else if (payload.windowId === ownId) {
      store.set(reportedAtom, payload.effect);
      if (activeRevision === null || activeRevision === revision) accept(payload.effect);
    }
  }

  async function connect(): Promise<void> {
    const arrived = await waiter.done;
    if (disposed) return;
    if (!arrived) {
      store.set(platformAtom, 'absent');
      return;
    }
    offEvent = host.on('window:backdropStateChanged', onReported);
    // 首次下发前完成平台检测，避免继承首选项或旧存档短暂应用不适用的材质
    const platform = await detectPlatform();
    if (disposed) return;
    store.set(platformAtom, platform);
    connected = true;
    send();
    const answer = await settle(() => host.ui.getCurrentWindowId());
    if (disposed || !answer || answer.success === false) return;
    ownId = answer.windowId;
    const report = early.get(ownId);
    early.clear();
    if (report) {
      // 异步检测期间收到的历史事件仅供诊断，不能解除后续请求的失败状态
      store.set(reportedAtom, report.effect);
      if (
        report.revision === revision &&
        (store.get(applicationAtom) !== 'failed' || report.received > failureReceived)
      )
        accept(report.effect);
    }
  }

  const offScheme = store.sub(colorSchemeAtom, send);
  const offSource = store.sub(backgroundSourceAtom, send);

  return {
    ready: connect(),
    choose(choice) {
      if (
        !store.get(nativeMaterialsAllowedAtom) &&
        store.get(platformAtom) !== 'checking' &&
        choice !== 'none'
      )
        return;
      if (disposed || !choicePref.set(store, choice, storage)) return;
      send();
    },
    dispose() {
      disposed = true;
      waiter.cancel();
      clearTimeout(failureTimer);
      offEvent?.();
      offScheme();
      offSource();
    },
  };
}

export const backdropKey = serviceKey<BackdropService>('backdrop');
