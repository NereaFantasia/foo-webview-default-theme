import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import { createConfigWriter } from '../host/configWrite.ts';
import type { DataWriter } from '../kit/dataWrite.ts';
import type { Store } from '../kit/store.ts';
import type { Messages } from './en.ts';
import {
  BUILTIN_MESSAGES,
  BUILTIN_TAGS,
  createTranslate,
  isBuiltinTag,
  resolveBuiltin,
  sanitizeMessages,
  type BuiltinTag,
  type Translate,
} from './translate.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/** 用户选定的语言存在宿主 config 里，随 profile 走。 */
const CONFIG_KEY = 'defaultTheme.locale';
/** 外部语言文件放在 profile 下这个目录，一个语言一个 `<标签>.json`；组件目录会随升级覆盖，不放那里。 */
const LOCALES_DIR = 'webview-ui-locales';
/** 语言标签的字符集。文件名与存档都先过它，免得把别的 JSON 或坏值当成语言。 */
const LOCALE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

/** 语言服务用到的宿主接口，类型逐项取自 SDK 的 `fb`。 */
export interface LocaleFace extends HostReadyFace {
  system: Pick<typeof fb.system, 'getLocale'>;
  misc: Pick<typeof fb.misc, 'getProfilePath'>;
  file: Pick<typeof fb.file, 'list' | 'read'>;
  config: Pick<typeof fb.config, 'get' | 'set' | 'remove'>;
}

export interface LocaleState {
  /** 正在显示的语言标签。 */
  readonly active: string;
  /** 基准语言：内置中英二选一，覆盖层缺的键回落到它。 */
  readonly base: BuiltinTag;
  /** 用户选定且已生效的语言；null 是跟随宿主。存档里有值但文件读不到时也是 null，界面实际停在基准语言。 */
  readonly chosen: string | null;
  /** 可选的语言：内置两档在前，其后是 profile 里发现的外部文件。 */
  readonly available: readonly string[];
  /** 盖在基准包上的一层：内置的另一档，或读进来的外部语言包。 */
  readonly overlay: Partial<Messages>;
}

function initialState(base: BuiltinTag): LocaleState {
  return { active: base, base, chosen: null, available: BUILTIN_TAGS, overlay: {} };
}

const stateAtom = atom<LocaleState>(initialState('en'));

export const localeAtom: Atom<LocaleState> = atom((get) => get(stateAtom));

type LocaleSaveState = 'idle' | 'pending' | 'saved' | 'failed';
const saveAtom = atom<LocaleSaveState>('idle');
/** 当前选择的持久化结果；保存失败时本次显示仍保持用户选定的语言。 */
export const localeSaveAtom: Atom<LocaleSaveState> = atom((get) => get(saveAtom));

/** 取文案的函数。语言一换就是一个新函数，读它的组件随之重渲染。 */
export const translateAtom: Atom<Translate> = atom((get) => {
  const state = get(stateAtom);
  return createTranslate(BUILTIN_MESSAGES[state.base], state.overlay);
});

export interface LocaleService {
  /** 启动时的宿主初读（宿主语言、外部文件、存档）做完时兑现，不会拒绝；调用方不必等它。 */
  readonly ready: Promise<void>;
  /** 切换成功答 true，保存结果见 localeSaveAtom；外部语言读不到答 false，界面不动。 */
  choose(tag: string): Promise<boolean>;
  /** 回到跟随宿主：界面立即回基准语言，再删掉存档。 */
  followHost(): Promise<void>;
  /** 重新发现 profile 里的语言文件，刚放进去的不必重启就能列出来。 */
  refresh(): Promise<void>;
  dispose(): void;
}

function browserLanguage(): string {
  return typeof navigator === 'undefined' ? 'en' : navigator.language || 'en';
}

/** 宿主调用失败有两条路：声明过的失败 resolve 成 `success:false`，框架级错误（超时等）才 reject。两条都当没拿到。 */
async function settle<T>(call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch {
    return null;
  }
}

/**
 * 启动语言服务。先按浏览器语言同步定一档，首帧不等宿主；连上宿主后依次问宿主语言、发现外部文件、
 * 应用用户选定的语言，任一步失败都停在上一层，不重试，也不打断使用。
 */
export function startLocale(
  store: Store,
  host: LocaleFace = fb,
  language: string = browserLanguage(),
  dataWriter?: Pick<DataWriter, 'run'>,
): LocaleService {
  store.set(stateAtom, initialState(resolveBuiltin(language)));
  store.set(saveAtom, 'idle');
  let disposed = false;
  let connected = false;
  let hostUnavailable = false;
  // 每次用户选择加一。异步应用的前后比一次，晚到的旧选择不覆盖新的，启动时的存档也不覆盖用户刚做的选择。
  let intent = 0;
  // 读不到的外部语言不会替换当前选择，仍须接收当前选择的保存结果。
  let appliedIntent = 0;
  // 连上宿主之前用户选过：存档让位，连上后把这次选择补写进 config。null 表示选了跟随宿主。
  let pending: { tag: string | null; intent: number } | undefined;
  const waiter = waitForHost(host);
  const writes = new AbortController();
  const config = createConfigWriter(host, dataWriter);

  const update = (change: (state: LocaleState) => LocaleState) => {
    if (!disposed) store.set(stateAtom, change(store.get(stateAtom)));
  };

  async function localesDir(): Promise<string | null> {
    const answer = await settle(() => host.misc.getProfilePath());
    if (!answer || answer.success === false || !answer.path) return null;
    return `${answer.path.replace(/[\\/]+$/, '')}\\${LOCALES_DIR}`;
  }

  /** 目录不存在（宿主答 NOT_FOUND）是常态，当没有外部文件。 */
  async function discover(): Promise<string[]> {
    const dir = await localesDir();
    const listing = dir ? await settle(() => host.file.list(dir, { pattern: '*.json' })) : null;
    if (!listing || listing.success === false) return [];
    const tags = listing.files
      .map((name) => /^(.+)\.json$/i.exec(name)?.[1] ?? '')
      .filter((tag) => LOCALE_TAG.test(tag));
    return [...new Set(tags)];
  }

  async function readExternal(tag: string): Promise<Partial<Messages> | null> {
    const dir = await localesDir();
    const answer = dir ? await settle(() => host.file.read(`${dir}\\${tag}.json`)) : null;
    if (!answer || answer.success === false) return null;
    try {
      const messages = sanitizeMessages(JSON.parse(answer.content));
      return Object.keys(messages).length > 0 ? messages : null;
    } catch {
      return null;
    }
  }

  async function overlayFor(tag: string): Promise<Partial<Messages> | null> {
    if (isBuiltinTag(tag)) return BUILTIN_MESSAGES[tag];
    return connected && LOCALE_TAG.test(tag) ? readExternal(tag) : null;
  }

  // 记不住只影响下次启动，这一次的显示不回滚。清掉存档要用 remove：config 的顶层值不能 set 成 null。
  async function persist(tag: string | null, mine: number): Promise<void> {
    if (disposed) return;
    store.set(saveAtom, 'pending');
    const result =
      tag === null
        ? await config.remove(CONFIG_KEY, writes.signal)
        : await config.set(CONFIG_KEY, tag, writes.signal);
    if (!disposed && mine === appliedIntent)
      store.set(saveAtom, result.success ? 'saved' : 'failed');
  }

  /** 连上了就立即写；没连上先记下，连上后补写。新的选择顶掉还没补写的旧选择，免得旧值后写覆盖新值。 */
  async function remember(tag: string | null, mine: number): Promise<void> {
    appliedIntent = mine;
    if (connected) {
      pending = undefined;
      await persist(tag, mine);
    } else {
      pending = { tag, intent: mine };
      store.set(saveAtom, hostUnavailable ? 'failed' : 'pending');
    }
  }

  async function savedTag(): Promise<string | null> {
    const answer = await settle(() => host.config.get(CONFIG_KEY));
    if (!answer || answer.success === false || !answer.found) return null;
    return typeof answer.value === 'string' && LOCALE_TAG.test(answer.value) ? answer.value : null;
  }

  async function hydrate(): Promise<void> {
    const arrived = await waiter.done;
    if (disposed) return;
    if (!arrived) {
      hostUnavailable = true;
      if (pending) store.set(saveAtom, 'failed');
      return;
    }
    connected = true;
    const hostLocale = await settle(() => host.system.getLocale());
    if (hostLocale && hostLocale.success !== false && hostLocale.locale) {
      const base = resolveBuiltin(hostLocale.locale);
      // 跟着基准走的界面一起换；用户选过别的语言时只换回落目标。
      update((state) => ({
        ...state,
        base,
        ...(state.chosen === null ? { active: base, overlay: {} } : {}),
      }));
    }
    const found = await discover();
    if (disposed) return;
    update((state) => ({ ...state, available: [...new Set([...BUILTIN_TAGS, ...found])] }));
    if (pending) {
      const { tag, intent: mine } = pending;
      pending = undefined;
      await persist(tag, mine);
      return;
    }
    // 用户选择可能仍在等写锁，宿主里此时还是旧值，不能再拿它覆盖界面。
    if (appliedIntent !== 0) return;
    const before = appliedIntent;
    const saved = await savedTag();
    if (saved === null || appliedIntent !== before) return;
    const overlay = await overlayFor(saved);
    if (!overlay || appliedIntent !== before) return;
    update((state) => ({ ...state, active: saved, chosen: saved, overlay }));
  }

  return {
    ready: hydrate(),
    async choose(tag) {
      if (disposed) return false;
      const mine = ++intent;
      const overlay = await overlayFor(tag);
      if (disposed || mine !== intent || !overlay) return false;
      update((state) => ({ ...state, active: tag, chosen: tag, overlay }));
      await remember(tag, mine);
      return true;
    },
    async followHost() {
      if (disposed) return;
      const mine = ++intent;
      update((state) => ({ ...state, active: state.base, chosen: null, overlay: {} }));
      await remember(null, mine);
    },
    async refresh() {
      if (!connected || disposed) return;
      const found = await discover();
      update((state) => ({ ...state, available: [...new Set([...BUILTIN_TAGS, ...found])] }));
    },
    dispose() {
      disposed = true;
      waiter.cancel();
      writes.abort();
    },
  };
}

export const localeKey = serviceKey<LocaleService>('locale');
