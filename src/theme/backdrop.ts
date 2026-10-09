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

/** 用户选的窗口材质，取值同 `window.setBackdropPolicy` 的 activeEffect；`inherit` 是跟随 foobar2000 首选项。 */
export type BackdropChoice = WindowActiveBackdropEffect;
/** 宿主报的实际效果：`inherit` 已解析，窗口显示不了的档已回退；`system` 表示由系统绘制。 */
export type BackdropEffect = WindowBackdropStateChangedPayload['effect'];

/** 取值表按 SDK 的类型逐项列出，宿主增删档位时这里编译不过；读回的存档只认表里的值。 */
const CHOICES: Readonly<Record<BackdropChoice, true>> = {
  inherit: true,
  none: true,
  mica: true,
  'mica-alt': true,
  acrylic: true,
};

/** 材质服务用到的宿主接口：只订一个事件，方法类型取自 SDK 的 `fb`。 */
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
    // 这是 UniversalApiContract 的版本，非内核构建号；Windows 10 为 1–10，Windows 11 从 13 起。
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

/** 选择存 localStorage：这是窗口级外观偏好，不进宿主 config，免得与 foobar2000 首选项里的同一项互相覆盖。 */
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

/** null 表示尚未取得系统版本；读取失败不会当作 Windows 10。 */
export const windows10Atom: Atom<boolean | null> = atom((get) => {
  const platform = get(platformAtom);
  return platform === 'windows10' ? true : platform === 'windows11' ? false : null;
});

/** 检测未知时不尝试原生材质，窗口与托盘使用同一判断。 */
export const nativeMaterialsAllowedAtom = atom((get) => get(platformAtom) === 'windows11');
export type BackdropFallback = 'windows10' | 'unknown' | 'failed';
export const backdropFallbackAtom: Atom<BackdropFallback | null> = atom((get) => {
  const platform = get(platformAtom);
  if (platform === 'windows10' || platform === 'unknown') return platform;
  return get(applicationAtom) === 'failed' ? 'failed' : null;
});
/** 启动期间的失败可能随后由宿主成功事件解除，提示略后于页面的纯色保护。 */
export const backdropNoticeAtom = atom((get) => {
  const fallback = get(backdropFallbackAtom);
  return fallback === 'failed' && !get(failureVisibleAtom) ? null : fallback;
});
/** 显式主题背景与材质回退共用同一套自绘背景和阅读面参数。 */
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
 * 系统不支持、检测未知或应用失败时使用纯色。成功应答不覆盖已报告的效果；继承值未解析时为 null。
 */
export const materialAtom: Atom<BackdropEffect | null> = atom((get) => {
  if (get(backdropSolidAtom)) return 'none';
  if (get(platformAtom) !== 'absent' && get(applicationAtom) !== 'idle') return get(effectiveAtom);
  const choice = get(choicePref.atom);
  return choice === 'inherit' ? null : choice;
});

export interface BackdropService {
  /** 连上宿主后的初始化（订阅、读系统版本、首次下发、取窗口 id）做完时兑现，不会拒绝；调用方不必等它。 */
  readonly ready: Promise<void>;
  /** 换材质并记住。连上宿主时立即下发；没连上时只改页面这一侧。 */
  choose(choice: BackdropChoice): void;
  dispose(): void;
}

/**
 * 启动材质服务：读回用户的选择，连上宿主后按背景来源、材质与深浅下发，并跟着宿主报的实际效果更新 `materialAtom`。
 * 深浅取 `colorSchemeAtom`，所以要先让它跟随系统，再启动这里。
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
  // 事件广播给所有窗口，要按 windowId 认出自己；id 取回之前到的，按窗口各记最后一条，取回后补用自己那条。
  const early = new Map<string, { effect: BackdropEffect; revision: number; received: number }>();
  // 最近接收的材质与深浅，挡住相同目标重复入队。
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
      // 隐藏窗口也会保存覆盖值，但可能暂答失败；保留它以便宿主显示窗口后继续应用，不自动重写用户请求。
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
    // 自绘背景需要原生 WebView 的不透明底，CSS 铺满颜色不能替代它；透明原生底会让背景模糊透出清晰内容。
    // 只改实际下发的材质，保留用户选择，切回材质来源时恢复。
    const drawn = store.get(backgroundSourceAtom) !== 'material';
    const choice =
      drawn || !store.get(nativeMaterialsAllowedAtom) ? 'none' : store.get(choicePref.atom);
    const darkMode = store.get(colorSchemeAtom) === 'dark';
    if (sent?.choice === choice && sent.darkMode === darkMode) return;
    sent = { choice, darkMode };
    queued = { choice, darkMode, revision: ++revision };
    clearFailure();
    store.set(applicationAtom, 'pending');
    // 事件不带请求标识，串行下发后才能把在途请求的成功事件与下一次选择区分开。
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
    // 首次下发前完成检测，避免继承首选项或旧存档短暂启用不适用的材质。
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
      // 检测期间收到的旧事件可用于诊断，但不能解除后来请求的失败。
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
