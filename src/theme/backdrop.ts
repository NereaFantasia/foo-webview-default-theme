import type {
  WindowActiveBackdropEffect,
  WindowBackdropStateChangedPayload,
} from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import { colorSchemeAtom } from './colorScheme.ts';
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

export const backdropChoiceAtom: Atom<BackdropChoice> = choicePref.atom;

/**
 * 页面按哪种材质配底色浓度。宿主报过实际效果就以它为准；还没报过时用显式选中的档；
 * 跟随首选项而宿主又没报过时为 null，页面取缺省浓度。
 */
export const materialAtom: Atom<BackdropEffect | null> = atom((get) => {
  const reported = get(reportedAtom);
  if (reported) return reported;
  const choice = get(choicePref.atom);
  return choice === 'inherit' ? null : choice;
});

export interface BackdropService {
  /** 连上宿主后的初始化（订阅、首次下发、取窗口 id）做完时兑现，不会拒绝；调用方不必等它。 */
  readonly ready: Promise<void>;
  /** 换材质并记住。连上宿主时立即下发；没连上时只改页面这一侧。 */
  choose(choice: BackdropChoice): void;
  dispose(): void;
}

/**
 * 启动材质服务：读回用户的选择，连上宿主后按「材质 + 深浅」下发，并跟着宿主报的实际效果更新 `materialAtom`。
 * 深浅取 `colorSchemeAtom`，所以要先让它跟随系统，再启动这里。
 */
export function startBackdrop(
  store: Store,
  host: BackdropFace = fb,
  storage?: PrefStorage | null,
): BackdropService {
  choicePref.load(store, storage);
  store.set(reportedAtom, null);
  let disposed = false;
  let connected = false;
  let ownId: string | null = null;
  // 事件广播给所有窗口，要按 windowId 认出自己；id 取回之前到的，按窗口各记最后一条，取回后补用自己那条。
  const early = new Map<string, BackdropEffect>();
  // 已下发的材质与深浅，挡同值重发。
  let sent: { choice: BackdropChoice; darkMode: boolean } | null = null;
  let offEvent: (() => void) | undefined;
  const waiter = waitForHost(host);

  function send(): void {
    if (disposed || !connected) return;
    const choice = store.get(choicePref.atom);
    const darkMode = store.get(colorSchemeAtom) === 'dark';
    if (sent?.choice === choice && sent.darkMode === darkMode) return;
    sent = { choice, darkMode };
    // 失败不重试，下一次材质或深浅变化时整份重发。启动时窗口还没画出来，宿主会答 OPERATION_FAILED，
    // 但覆盖值已经存下。失焦恒 inherit：失焦时沿用激活时的材质、由系统压暗，不必每次切焦点重发。
    void host.ui
      .setBackdropPolicy({ activeEffect: choice, inactiveEffect: 'inherit', darkMode })
      .catch(() => {});
  }

  function onReported(payload: WindowBackdropStateChangedPayload): void {
    if (disposed) return;
    if (ownId === null) early.set(payload.windowId, payload.effect);
    else if (payload.windowId === ownId) store.set(reportedAtom, payload.effect);
  }

  async function connect(): Promise<void> {
    if (!(await waiter.done) || disposed) return;
    offEvent = host.on('window:backdropStateChanged', onReported);
    connected = true;
    send();
    const answer = await host.ui.getCurrentWindowId().catch(() => null);
    if (disposed || !answer || answer.success === false) return;
    ownId = answer.windowId;
    const effect = early.get(ownId);
    early.clear();
    if (effect) store.set(reportedAtom, effect);
  }

  const offScheme = store.sub(colorSchemeAtom, send);

  return {
    ready: connect(),
    choose(choice) {
      if (disposed || !choicePref.set(store, choice, storage)) return;
      send();
    },
    dispose() {
      disposed = true;
      waiter.cancel();
      offEvent?.();
      offScheme();
    },
  };
}

export const backdropKey = serviceKey<BackdropService>('backdrop');
