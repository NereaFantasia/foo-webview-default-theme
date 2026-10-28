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

/** 存储用户指定语言的宿主配置键名，作用域随 profile 隔离 */
const CONFIG_KEY = 'defaultTheme.locale';
/** profile 目录下存放外部语言文件的子目录名，单文件格式为 `<tag>.json` */
const LOCALES_DIR = 'webview-ui-locales';
/** 校验语言标签合法性的正则，用于文件名与持久化配置 */
const LOCALE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

/** 语言服务依赖的宿主 API 子集 */
export interface LocaleFace extends HostReadyFace {
  system: Pick<typeof fb.system, 'getLocale'>;
  misc: Pick<typeof fb.misc, 'getProfilePath'>;
  file: Pick<typeof fb.file, 'list' | 'read'>;
  config: Pick<typeof fb.config, 'get' | 'set' | 'remove'>;
}

export interface LocaleState {
  /** 正在显示的语言标签 */
  readonly active: string;
  /** 基准语言。内置中英二选一，覆盖层缺失的键自动回落至此 */
  readonly base: BuiltinTag;
  /** 当前生效的用户选定语言。null 表示跟随宿主。配置指定的外部文件不可读时同样置为 null 并降级使用基准语言 */
  readonly chosen: string | null;
  /** 可选语言标签列表。内置语言排在首位，后接 profile 扫描出的外部语言 */
  readonly available: readonly string[];
  /** 覆盖在基准语言上的差异字典，对应内置另一档语言或外部语言包 */
  readonly overlay: Partial<Messages>;
}

function initialState(base: BuiltinTag): LocaleState {
  return { active: base, base, chosen: null, available: BUILTIN_TAGS, overlay: {} };
}

const stateAtom = atom<LocaleState>(initialState('en'));

export const localeAtom: Atom<LocaleState> = atom((get) => get(stateAtom));

type LocaleSaveState = 'idle' | 'pending' | 'saved' | 'failed';
const saveAtom = atom<LocaleSaveState>('idle');
/** 当前语言选择的持久化状态。保存失败时本次运行维持用户选定语言，不触发回滚 */
export const localeSaveAtom: Atom<LocaleSaveState> = atom((get) => get(saveAtom));

/** 当前翻译函数，随生效语言变更发布新引用 */
export const translateAtom: Atom<Translate> = atom((get) => {
  const state = get(stateAtom);
  return createTranslate(BUILTIN_MESSAGES[state.base], state.overlay);
});

export interface LocaleService {
  /** 宿主语言检测、外部文件扫描及配置读取完成后兑现，不抛出异常 */
  readonly ready: Promise<void>;
  /** 切换语言。成功返回 true，持久化结果写入 localeSaveAtom。外部语言不可读时返回 false 且维持界面不变 */
  choose(tag: string): Promise<boolean>;
  /** 恢复跟随宿主语言。立即切回基准语言并清除持久化配置 */
  followHost(): Promise<void>;
  /** 重新扫描 profile 目录下的外部语言文件并刷新可用列表 */
  refresh(): Promise<void>;
  dispose(): void;
}

function browserLanguage(): string {
  return typeof navigator === 'undefined' ? 'en' : navigator.language || 'en';
}

/** 统一封装宿主异步调用，将业务失败信封与框架异常归一化为空结果返回 */
async function settle<T>(call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch {
    return null;
  }
}

/**
 * 启动语言服务。首帧依据浏览器语言同步确定基准档位，避免等待宿主阻塞渲染。
 * 建立连接后依次查询宿主语言、扫描外部文件并载入持久化配置，各阶段失败均平稳回退至已有状态
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
  // 用户操作代次。异步应用前后核对版本，防止过期的旧选择或启动初始读取覆盖最新用户操作
  let intent = 0;
  // 记录当前已生效操作的版本序号，用于校验对应的持久化保存结果
  let appliedIntent = 0;
  // 暂存宿主连接就绪前发生的用户操作，连接就绪后补写至配置。null 表示跟随宿主
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

  /** 扫描外部语言目录。目录不存在（宿主返回 NOT_FOUND）时按无外部文件处理 */
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

  // 持久化失败不回滚当前界面呈现。清除配置调用 remove，因为宿主配置顶层不支持写入 null
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

  /** 持久化当前选择或暂存待写操作。已连接时立即写入，未连接时记录最新选择以防乱序覆盖 */
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
      // 宿主语言就绪时的更新分支。未显式指定语言时随基准语言同步切换界面，已选定语言时仅更新回退基准
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
    // 水合阶段保护。期间已有用户主动选择时以最新操作为准，放弃应用宿主中读取的旧配置
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
