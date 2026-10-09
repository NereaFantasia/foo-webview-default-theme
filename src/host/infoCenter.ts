import type { ConfigWriter } from './configWrite.ts';
import type { ConfigGetVersionInfoSuccess } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import {
  defineConfigPref,
  startConfigPrefs,
  configSaveFailuresAtom,
  type ConfigPersistence,
  type ConfigPrefFace,
} from './configPref.ts';
import { onMissingMethod, settle } from './hostCall.ts';
import {
  diagnosticsOf,
  REQUIRED_HOST_VERSION,
  versionAtLeast,
  type Diagnostics,
} from './hostInfo.ts';
import { waitForHost } from './waitForHost.ts';
import type { TranslateParams } from '../i18n/translate.ts';
import type { Store } from '../kit/store.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import {
  prefSaveStatesAtom,
  prefStorageAvailableAtom,
  type PagePrefStorage,
} from '../kit/prefStorage.ts';

/**
 * 信息中心：汇总会一直存在、要用户去处理的问题，按种类去重。瞬时的操作结果不归这里，照旧走 Toast。
 *
 * 阻断级是宿主缺能力，主题有的功能用不了：插件版本低于 `REQUIRED_HOST_VERSION`、读不到版本、连不上宿主
 * （宿主在，版本核对却没有应答）、有调用答宿主不认这个方法。等不到宿主不报：普通浏览器里打开时本就没有
 * 宿主。提醒级是用户那边少配了东西：没装 foo_playcount、媒体库没配置。
 *
 * 消息按此刻的状况现算，问题解决了消息随之消失。阻断级的横幅可以本次运行关掉，信息中心里照留；
 * 能力提醒可以「不再提示」，记进宿主 config，按种类与插件版本记，插件换了版本再提示。
 * 保存失败不能永久忽略，重试成功后自动消失；存储不可用时说明修改只在当前窗口生效。
 */
export interface InfoCenterFace extends ConfigPrefFace {
  config: Pick<typeof fb.config, 'get' | 'set' | 'getVersionInfo'>;
}

export const BLOCKING_KINDS = [
  'hostTooOld',
  'hostVersionUnreadable',
  'hostUnreachable',
  'hostMethodMissing',
] as const;
export const REMINDER_KINDS = [
  'playcountMissing',
  'libraryNotConfigured',
  'windowEffectsLimited',
] as const;
export type BlockingKind = (typeof BLOCKING_KINDS)[number];
/** 也是 config 里「不再提示」的键，改名要写迁移。 */
export type ReminderKind = (typeof REMINDER_KINDS)[number];
/**
 * 更新器交给信息中心的提示，只有要用户去处理的几种；正在检查、已是最新这类状态只在设置里显示。
 * updatePlugin 的 `required` 是插件要求的最低版本号，不带 `>=`。
 */
export type UpdateNotice =
  | { readonly kind: 'updateReady'; readonly version: string }
  | { readonly kind: 'updateAvailable'; readonly version: string; readonly title: string }
  | { readonly kind: 'updatePlugin'; readonly latest: string; readonly required: string }
  | { readonly kind: 'updateManual' }
  | { readonly kind: 'updateShared' }
  | { readonly kind: 'updateFailed' };
export interface UpdateFeedback {
  readonly backend?: StartupConfirmationFeedback;
  readonly notice: Atom<UpdateNotice | null>;
  restart(): Promise<boolean>;
  check(): Promise<void>;
  install(): Promise<void>;
  showChangelog(): void;
}

export type InfoKind =
  | BlockingKind
  | ReminderKind
  | UpdateNotice['kind']
  | 'preferencesUnsaved'
  | 'preferenceStorageUnavailable'
  | 'backendUnavailable'
  | 'startupUnconfirmed';

export interface StartupConfirmationFeedback {
  readonly failed: Atom<boolean>;
  retry(): Promise<void>;
}
const startupFailureAtom = atom<Atom<boolean>>(atom(false));
const updateNoticeAtom = atom<Atom<UpdateNotice | null>>(atom(null));
const backendFailureAtom = atom<Atom<boolean>>(atom(false));

export interface WindowEffectsFeedback {
  readonly notice: Atom<'windows10' | 'unknown' | 'failed' | null>;
  readonly diagnostics: Atom<string>;
}
const windowEffectsAtom = atom<WindowEffectsFeedback | null>(null);

const retryingPreferencesAtom = atom(false);
export const preferenceSaveSummaryAtom = atom((get) => ({
  failed:
    get(configSaveFailuresAtom).length +
    (get(prefStorageAvailableAtom)
      ? [...get(prefSaveStatesAtom).values()].filter((state) => state.status === 'failed').length
      : 0),
  unavailable: !get(prefStorageAvailableAtom),
  retrying: get(retryingPreferencesAtom),
}));

/**
 * 提醒级各种类此刻成不成立。条件出自媒体库与播放统计，由装配层传进来，信息中心只管去重、排序与「不再提示」。
 */
export type ReminderSources = Readonly<
  Record<Exclude<ReminderKind, 'windowEffectsLimited'>, Atom<boolean>>
>;

const NO_REMINDERS: ReminderSources = {
  playcountMissing: atom(false),
  libraryNotConfigured: atom(false),
};
const sourcesAtom = atom<ReminderSources>(NO_REMINDERS);

export interface InfoMessage {
  readonly kind: InfoKind;
  readonly level: 'blocking' | 'reminder';
  /**
   * 给界面拼文案的参数。hostTooOld 带 `version`（此刻的插件版本）与 `required`；hostMethodMissing 认出了
   * 方法名时带 `methods`（逗号分隔），一个都没认出时不带。preferencesUnsaved 带未保存项数 count。
   */
  readonly params: TranslateParams;
}

type HostCheck =
  | { readonly state: 'checking' | 'absent' | 'unreachable' | 'unreadable' }
  | { readonly state: 'read'; readonly info: ConfigGetVersionInfoSuccess };

interface MissingMethods {
  readonly seen: boolean;
  /** 认出的方法名，按先后，不重复。 */
  readonly methods: readonly string[];
}

/** 写成 type 而不是 interface：要直接存进 config。值是点「不再提示」时的插件版本。 */
type DismissedReminders = { readonly [K in ReminderKind]?: string };

function parseDismissed(raw: unknown): DismissedReminders | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const dismissed: { [K in ReminderKind]?: string } = {};
  for (const kind of REMINDER_KINDS) {
    const version: unknown = Reflect.get(raw, kind);
    if (typeof version === 'string') dismissed[kind] = version;
  }
  return dismissed;
}

const DISMISSED = defineConfigPref<DismissedReminders>(
  'defaultTheme.infoCenter.dismissed',
  {},
  parseDismissed,
);

const CHECKING: HostCheck = { state: 'checking' };
const NO_MISSING: MissingMethods = { seen: false, methods: [] };
const checkAtom = atom<HostCheck>(CHECKING);
const missingAtom = atom<MissingMethods>(NO_MISSING);
/** 本次运行关掉了横幅的种类，不落盘。 */
const closedAtom = atom<ReadonlySet<InfoKind>>(new Set<InfoKind>());

const versionOf = (check: HostCheck) => (check.state === 'read' ? check.info.plugin.version : '');

/**
 * 宿主回的 reject 都带 `code`（插件 `src/api/BridgeCore.cpp` 的 `BridgeCore::SendError`）；注入脚本等了
 * 30 s 没有应答、自己放弃的那种不带。
 */
function hasErrorCode(reason: unknown): boolean {
  return (
    typeof reason === 'object' && reason !== null && typeof Reflect.get(reason, 'code') === 'string'
  );
}

/**
 * 这一种提醒点过「不再提示」没有：按此刻的插件版本比；版本还没读到时，点过就算，比不出版本的时候
 * 宁可不提示，也不让关掉过的提醒在启动时闪一下。
 */
function dismissedNow(dismissed: DismissedReminders, kind: ReminderKind, check: HostCheck) {
  const at = dismissed[kind];
  return at !== undefined && (check.state !== 'read' || at === check.info.plugin.version);
}

/** 此刻的全部消息：阻断级在前，各级内按种类的固定顺序。 */
export const infoMessagesAtom: Atom<readonly InfoMessage[]> = atom((get) => {
  const check = get(checkAtom);
  const missing = get(missingAtom);
  const blocking: [BlockingKind, TranslateParams][] = [];
  if (check.state === 'read' && !versionAtLeast(check.info.plugin.version, REQUIRED_HOST_VERSION)) {
    blocking.push([
      'hostTooOld',
      { version: check.info.plugin.version, required: REQUIRED_HOST_VERSION },
    ]);
  }
  if (check.state === 'unreadable') blocking.push(['hostVersionUnreadable', {}]);
  if (check.state === 'unreachable') blocking.push(['hostUnreachable', {}]);
  if (missing.seen) {
    const params: TranslateParams =
      missing.methods.length > 0 ? { methods: missing.methods.join(', ') } : {};
    blocking.push(['hostMethodMissing', params]);
  }
  const sources = get(sourcesAtom);
  const windowEffects = get(windowEffectsAtom);
  const effectsNotice = windowEffects ? get(windowEffects.notice) : null;
  const active: Record<ReminderKind, boolean> = {
    playcountMissing: get(sources.playcountMissing),
    libraryNotConfigured: get(sources.libraryNotConfigured),
    windowEffectsLimited: effectsNotice !== null,
  };
  const dismissed = get(DISMISSED.atom);
  const saving = get(preferenceSaveSummaryAtom);
  const preferences: InfoMessage[] = [];
  if (get(get(startupFailureAtom)))
    preferences.push({ kind: 'startupUnconfirmed', level: 'reminder', params: {} });
  if (get(get(backendFailureAtom)))
    preferences.push({ kind: 'backendUnavailable', level: 'reminder', params: {} });
  const update = get(get(updateNoticeAtom));
  if (update) {
    const { kind, ...params } = update;
    preferences.push({ kind, level: 'reminder', params });
  }
  if (saving.unavailable)
    preferences.push({ kind: 'preferenceStorageUnavailable', level: 'reminder', params: {} });
  if (saving.failed > 0 || saving.retrying)
    preferences.push({
      kind: 'preferencesUnsaved',
      level: 'reminder',
      params: { count: saving.failed },
    });
  return [
    ...blocking.map(([kind, params]): InfoMessage => ({ kind, level: 'blocking', params })),
    ...preferences,
    ...REMINDER_KINDS.filter((kind) => active[kind] && !dismissedNow(dismissed, kind, check)).map(
      (kind): InfoMessage => ({
        kind,
        level: 'reminder',
        params: kind === 'windowEffectsLimited' ? { reason: effectsNotice ?? '' } : {},
      }),
    ),
  ];
});

export const hasBlockingAtom: Atom<boolean> = atom((get) =>
  get(infoMessagesAtom).some((message) => message.level === 'blocking'),
);

/** 横幅上该出的阻断级消息；空的时候不出横幅。 */
export const infoBannerAtom: Atom<readonly InfoMessage[]> = atom((get) => {
  const closed = get(closedAtom);
  return get(infoMessagesAtom).filter(
    (message) => message.level === 'blocking' && !closed.has(message.kind),
  );
});

/**
 * 点过「不再提示」、此刻还算数的提醒有几种；问题眼下在不在都算。插件换了版本的那些已经不算，本来就会
 * 再提示。
 */
export const dismissedCountAtom: Atom<number> = atom((get) => {
  const dismissed = get(DISMISSED.atom);
  const check = get(checkAtom);
  return REMINDER_KINDS.filter((kind) => dismissedNow(dismissed, kind, check)).length;
});

/** 诊断信息，界面上的页脚与「复制诊断信息」（`diagnosticText`）用它；读到版本之前为 null。 */
export const diagnosticsAtom: Atom<Diagnostics | null> = atom((get) => {
  const check = get(checkAtom);
  if (check.state !== 'read') return null;
  const windowEffects = get(windowEffectsAtom);
  return {
    ...diagnosticsOf(check.info),
    ...(windowEffects ? { windowEffects: get(windowEffects.diagnostics) } : {}),
  };
});

export interface InfoCenterService {
  readonly persistence: ConfigPersistence;
  /** 版本核对与「不再提示」的存档读回都做完时兑现，不会拒绝。 */
  readonly ready: Promise<void>;
  /** 横幅上此刻的几条本次运行不再出横幅，信息中心里照留。之后新出的阻断级照常出横幅。 */
  closeBanner(): void;
  /**
   * 提醒级「不再提示」：按种类与此刻的插件版本记进 config。版本没读到时记成空串，下次读到了版本
   * 会再提示一次。
   */
  dismissReminder(kind: ReminderKind): void;
  /** 忘掉所有「不再提示」，并清掉 config 里的记录；问题还在的提醒随即重新出现。一条都没记时不写。 */
  restoreReminders(): void;
  /** 连不上宿主或读不到版本时再核对一次，成了对应的消息随之消失；其余时候不发。 */
  retry(): void;
  /** 只重试调用时失败的偏好，交回原服务使用当前值，已保存的项不重写。 */
  retryPreferences(): Promise<void>;
  retryStartup(): void;
  retryBackend(): void;
  /** 新版本已下载时重启 foobar2000，让引导页换上新版本。 */
  restartForUpdate(): void;
  /** 更新多次失败后手动再试一次。 */
  retryUpdate(): void;
  /** 查到新版但没有自动下载时，由用户下载并安装。 */
  installUpdate(): void;
  showChangelog(): void;
  dispose(): void;
}

export function startInfoCenter(
  store: Store,
  reminders: ReminderSources,
  host: InfoCenterFace = fb,
  writer?: Pick<ConfigWriter, 'set'>,
  preferences?: Pick<PagePrefStorage, 'retry'>,
  startup?: StartupConfirmationFeedback,
  update?: UpdateFeedback,
  windowEffects?: WindowEffectsFeedback,
): InfoCenterService {
  store.set(windowEffectsAtom, windowEffects ?? null);
  store.set(startupFailureAtom, startup?.failed ?? atom(false));
  store.set(updateNoticeAtom, update?.notice ?? atom(null));
  store.set(backendFailureAtom, update?.backend?.failed ?? atom(false));
  store.set(sourcesAtom, reminders);
  store.set(checkAtom, CHECKING);
  store.set(missingAtom, NO_MISSING);
  store.set(closedAtom, new Set<InfoKind>());
  store.set(retryingPreferencesAtom, false);
  let disposed = false;
  let checks = 0;
  // 同步登记：宿主的应答最早也要等 startServices 返回之后才到，装配时排在哪一行都不会漏报。
  const offMissing = onMissingMethod((method) => {
    if (disposed) return;
    const { seen, methods } = store.get(missingAtom);
    if (method === null ? seen : methods.includes(method)) return;
    store.set(missingAtom, {
      seen: true,
      methods: method === null ? methods : [...methods, method],
    });
  });
  const prefs = startConfigPrefs(store, [DISMISSED], host, writer);
  const waiter = waitForHost(host);

  // 宿主答了却读不出版本（失败信封，或带错误码的 reject：宿主内部异常、不认这个方法）算读不到版本；
  // 不带错误码的 reject 是宿主那边一直没有应答、调用超时放弃了，才算连不上宿主。reject 照旧经 settle
  // 走一遍，宿主不认的方法照常上报。
  async function check(): Promise<void> {
    const mine = ++checks;
    let answeredWithError = false;
    const answer = await settle(() =>
      host.config.getVersionInfo().catch((reason: unknown) => {
        answeredWithError = hasErrorCode(reason);
        throw reason;
      }),
    );
    if (disposed || mine !== checks) return;
    if (answer && answer.success !== false) store.set(checkAtom, { state: 'read', info: answer });
    else if (answer || answeredWithError) store.set(checkAtom, { state: 'unreadable' });
    else store.set(checkAtom, { state: 'unreachable' });
  }

  async function connect(): Promise<void> {
    const arrived = await waiter.done;
    if (disposed) return;
    if (arrived) await check();
    else store.set(checkAtom, { state: 'absent' });
    await prefs.ready;
  }

  return {
    ready: connect(),
    persistence: prefs,
    closeBanner() {
      const shown = store.get(infoBannerAtom);
      if (disposed || shown.length === 0) return;
      store.set(closedAtom, new Set([...store.get(closedAtom), ...shown.map(({ kind }) => kind)]));
    },
    dismissReminder(kind) {
      if (disposed) return;
      const version = versionOf(store.get(checkAtom));
      prefs.set(DISMISSED, { ...store.get(DISMISSED.atom), [kind]: version });
    },
    restoreReminders() {
      if (disposed || Object.keys(store.get(DISMISSED.atom)).length === 0) return;
      prefs.set(DISMISSED, {});
    },
    retry() {
      const { state } = store.get(checkAtom);
      if (!disposed && (state === 'unreachable' || state === 'unreadable')) void check();
    },
    async retryPreferences() {
      if (disposed || store.get(retryingPreferencesAtom)) return;
      const config = store.get(configSaveFailuresAtom);
      const local = [...store.get(prefSaveStatesAtom)].filter(
        ([, state]) => state.status === 'failed',
      );
      store.set(retryingPreferencesAtom, true);
      try {
        await Promise.all([
          ...config.map((failure) => failure.retry()),
          ...local.map(([key]) => preferences?.retry(key)),
        ]);
      } finally {
        if (!disposed) store.set(retryingPreferencesAtom, false);
      }
    },
    retryStartup() {
      if (!disposed) void startup?.retry();
    },
    retryBackend() {
      if (!disposed) void update?.backend?.retry();
    },
    restartForUpdate() {
      if (!disposed) void update?.restart();
    },
    retryUpdate() {
      if (!disposed) void update?.check();
    },
    installUpdate() {
      if (!disposed) void update?.install();
    },
    showChangelog() {
      if (!disposed) update?.showChangelog();
    },
    dispose() {
      disposed = true;
      checks += 1;
      offMissing();
      waiter.cancel();
      prefs.dispose();
    },
  };
}

export const infoCenterKey = serviceKey<InfoCenterService>('infoCenter');
