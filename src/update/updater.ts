import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import {
  defineConfigPref,
  oneOf,
  startConfigPrefs,
  type ConfigPersistence,
  type ConfigPrefFace,
} from '../host/configPref.ts';
import type { ConfigWriter } from '../host/configWrite.ts';
import { hostCommand } from '../host/hostCall.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import { startChangelogFeed, type Changelog } from './changelogFeed.ts';
import type { ChangelogCatalog } from './changelog.ts';
import {
  BUILT_IN_KEYS,
  ROOT_URL,
  readRelease,
  type PublishedKey,
  type RootPayload,
} from './contract.ts';
import { installFrontend } from './frontendInstall.ts';
import { pluginMaintenanceActive } from './pluginMaintenance.ts';
import { confirmedStartupAtom, type ConfirmedStartup } from './loaderConfirmation.ts';
import {
  json,
  marker,
  pendingPointer,
  sameVersion,
  versionRef,
  type LoaderSession,
  type Pointer,
} from './loaderContract.ts';
import { fetchText, fetchVerified, type ReleaseHttp } from './releaseFetch.ts';
import { selectRelease, type SelectionLimit } from './releaseSelection.ts';
import { cleanVersions, type CleanupHost } from './versionCleanup.ts';
import { acceptRoot } from './rootTrust.ts';
import { startRunMarker, type RunMarker, type RunMarkerHost } from './runMarker.ts';
import { templateFiles, type TemplateFileHost, type TemplateFiles } from './templateFiles.ts';
import {
  UpdateStateError,
  initialUpdateState,
  exhaustedFailure,
  loadFailedReleases,
  loadPointer,
  loadUpdateState,
  saveUpdateState,
  withFailure,
  withoutFailures,
  type UpdateFailure,
  type UpdateState,
} from './updateState.ts';

/**
 * 前端自动更新调度：限定主窗口启动确认后激活
 * 检查、下载、安装与指针写入串行执行且单例排队；新版本写入独立版本目录并原子更新 pending 指针，
 * 禁止静默降级或自动重启宿主
 */

/** 兼容旧版布尔更新开关；未配置新版模式键时，布尔真回退为 auto，其余回退为 off */
export const AUTO_UPDATE = defineConfigPref('defaultTheme.update.auto', false, (value) =>
  typeof value === 'boolean' ? value : undefined,
);
export const UPDATE_MODES = ['off', 'notify', 'auto'] as const;
/** 更新策略模式：off 仅手动触发，notify 定时检查仅提示，auto 定时检查并就绪下载；均不执行自动重启 */
export type UpdateMode = (typeof UPDATE_MODES)[number];
/** 未显式持久化时为 null，根据旧版配置推算回退值 */
export const UPDATE_MODE = defineConfigPref<UpdateMode | null>(
  'defaultTheme.update.mode',
  null,
  oneOf(UPDATE_MODES),
);
/** 生效的更新模式：显式配置优先，没有时由旧版布尔开关推算 */
export const EFFECTIVE_UPDATE_MODE = atom<UpdateMode>(
  (get) => get(UPDATE_MODE.atom) ?? (get(AUTO_UPDATE.atom) ? 'auto' : 'off'),
);
/** 触发检查的动作语义：包含定时轮询、手动检查、即时安装与状态重置恢复 */
type CheckKind = 'scheduled' | 'manual' | 'install' | 'reset';

export type UpdateStatus =
  | { readonly phase: 'maintenance' }
  /** 更新器休眠阶段：未完成启动确认、确认异常或运行于非支持环境 */
  | { readonly phase: 'off'; readonly reason?: 'storage' }
  | {
      readonly phase: 'idle';
      /** 最近一次拉取根清单的时间戳（毫秒），包含成功与网络错误 */
      readonly checkedAt: number | null;
      readonly failure: UpdateFailure | null;
      /** 同一版本遭遇连续相同错误达到上限时，定时检查阻断重试，仅允许手动操作触发 */
      readonly gaveUp: boolean;
    }
  | { readonly phase: 'checking' }
  | { readonly phase: 'downloading' | 'installing'; readonly version: string }
  | {
      readonly phase: 'ready';
      readonly version: string;
      readonly notes: Readonly<Record<string, string>>;
      readonly latest: string;
      readonly limit: SelectionLimit | null;
      readonly pluginRange: string | null;
    }
  /** 发现可用版本但未自动下载：适用于仅通知或手动模式，等待用户主动确认安装 */
  | {
      readonly phase: 'available';
      readonly version: string;
      readonly latest: string;
      readonly limit: SelectionLimit | null;
      readonly pluginRange: string | null;
    }
  | {
      readonly phase: 'blocked';
      readonly latest: string;
      readonly limit: SelectionLimit;
      readonly pluginRange: string | null;
    }
  /** 仅状态损坏时允许就地重置；其余限制须由用户手动修复且保留故障版本记录 */
  | {
      readonly phase: 'manual';
      readonly reason: 'format' | 'updater' | 'trust' | UpdateStateError['reason'];
    }
  /** 检测到多实例共用模板目录：挂起检查与版本清理直至下次启动 */
  | { readonly phase: 'shared' }
  /** 运行期间主题文件被外部覆盖，指针版本与本次启动的版本不一致：停止写入指针并等待重启生效 */
  | { readonly phase: 'replaced' };

export interface UpdaterHost extends ConfigPrefFace {
  readonly http: ReleaseHttp;
  readonly file: TemplateFileHost & RunMarkerHost['file'] & CleanupHost['file'];
  readonly misc: Pick<typeof fb.misc, 'restart'>;
  readonly on: typeof fb.on;
}
export interface UpdaterOptions {
  readonly host?: UpdaterHost;
  readonly writer?: Pick<ConfigWriter, 'set'>;
  readonly storageAvailable?: boolean;
  readonly keys?: readonly PublishedKey[];
  readonly random?: () => number;
  readonly now?: () => number;
  readonly suffix?: () => string;
  readonly pause?: () => Promise<void>;
}
export interface UpdaterService {
  readonly status: Atom<UpdateStatus>;
  readonly mode: Atom<UpdateMode>;
  /** 本地内置副本或远端聚合变更日志；均不可用时为 null */
  readonly changelog: Atom<Changelog | null>;
  readonly changelogLoading: Atom<boolean>;
  readonly changelogFailed: Atom<boolean>;
  readonly catalog: Atom<ChangelogCatalog | null>;
  readonly persistence: ConfigPersistence;
  readonly publication: Atom<UpdatePublication | null>;
  /**
   * 执行组件维护事务，与主题检查、指针写入及版本清理共享串行队列；
   * 执行中标记为 maintenance 阶段且禁止重启；未确认启动、存储不可用或存在冲突事务时拒绝受理
   */
  maintain(action: () => Promise<void>): Promise<void>;
  setMode(mode: UpdateMode): Promise<boolean>;
  /** 用户手动检查：忽略失败次数上限，自动模式继续下载安装，并发检查复用同一次拉取 */
  check(): Promise<void>;
  /** 用户确认下载安装：排队等待当前任务完成后检查，发现可用版本即刻开始下载安装 */
  install(): Promise<void>;
  /** 恢复损坏的更新状态：重置本地状态记录并立即发起一次前台检查 */
  reset(): Promise<void>;
  restart(): Promise<boolean>;
  dispose(): void;
}

export interface UpdatePublication {
  readonly text: string;
  readonly payload: RootPayload;
  readonly revokedKeys: readonly string[];
}

const FIRST_CHECK_MS = 60_000;
const INTERVAL_MS = 6 * 60 * 60_000;
/** 定时轮询周期叠加正负 10% 随机抖动，平抑并发请求洪峰 */
const JITTER = 0.1;
const ROOT_LIMIT = 2 * 1024 * 1024;
const RELEASE_LIMIT = 1024 * 1024;
const WRITE_PAUSE_MS = 30;
/** 历史版本清理延迟至启动 10 分钟后执行，确保多实例探测与初始运行状态已稳定 */
const CLEANUP_DELAY_MS = 10 * 60_000;

/** 校验主题是否被外部覆盖安装；启动确认后当前运行版本应与指针指向一致 */
function replaced(pointer: Pointer, session: LoaderSession): boolean {
  return !sameVersion(versionRef(pointer.frontend.version), session.version);
}

function randomSuffix(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => alphabet[byte % 36]).join(
    '',
  );
}

export function startUpdater(store: Store, options: UpdaterOptions = {}): UpdaterService {
  const host = options.host ?? fb;
  const keys = options.keys ?? BUILT_IN_KEYS;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const install = {
    suffix: options.suffix ?? randomSuffix,
    pause:
      options.pause ?? (() => new Promise<void>((resolve) => setTimeout(resolve, WRITE_PAUSE_MS))),
  };
  const prefs = startConfigPrefs(store, [UPDATE_MODE, AUTO_UPDATE], host, options.writer);
  const feed = startChangelogFeed(store);
  const status = atom<UpdateStatus>({ phase: 'off' });
  const catalog = atom<ChangelogCatalog | null>(null);
  const publication = atom<UpdatePublication | null>(null);
  let disposed = false;
  let running: Promise<void> | undefined;
  /** 串行化检查、安装与清理任务，避免计算历史保留集时并发执行新版本解压 */
  let queue: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  let presence: RunMarker | undefined;
  let checkedAt: number | null = null;
  let maintaining = false;

  function alive(): void {
    if (disposed) throw new Error('更新服务已释放');
    if (presence?.shared()) throw new Error('主题目录被其他实例共用');
  }
  function show(next: UpdateStatus): void {
    if (!disposed) store.set(status, next);
  }
  function idle(failure: UpdateFailure | null, gaveUp = false): void {
    show(presence?.shared() ? { phase: 'shared' } : { phase: 'idle', checkedAt, failure, gaveUp });
  }
  /** 记录版本故障计数；持久化失败不阻断状态展示，后续周期继续重试 */
  async function fail(
    files: TemplateFiles,
    state: UpdateState,
    version: string,
    failure: UpdateFailure,
  ): Promise<void> {
    const next = withFailure(state, version, failure);
    if (next !== state)
      try {
        await saveUpdateState(files, next);
      } catch {
        alive();
      }
    idle(failure);
  }

  async function run(startup: ConfirmedStartup, kind: CheckKind): Promise<void> {
    const manual = kind !== 'scheduled';
    const download = kind === 'install' || store.get(EFFECTIVE_UPDATE_MODE) === 'auto';
    if (presence?.shared()) return show({ phase: 'shared' });
    const files = templateFiles(host.file, startup.directory, alive);
    store.set(catalog, null);
    if (await pluginMaintenanceActive(files)) {
      show({ phase: 'maintenance' });
      return;
    }
    if (replaced(await loadPointer(files), startup.session)) return show({ phase: 'replaced' });
    show({ phase: 'checking' });
    store.set(publication, null);
    if (kind === 'reset') {
      await loadFailedReleases(files);
      await loadPointer(files);
      await saveUpdateState(files, initialUpdateState());
    }
    let state = await loadUpdateState(files);
    const root = await fetchText(host.http, ROOT_URL, ROOT_LIMIT);
    checkedAt = now();
    if (!root.ok) return idle(root.problem);
    const decision = await acceptRoot(state.trust, root.value, keys);
    alive();
    if (decision.kind === 'manual') return show({ phase: 'manual', reason: decision.reason });
    if (decision.kind !== 'accepted') return idle(decision.kind);
    state = { ...state, trust: decision.state };
    // 根清单先原子落盘更新信任集与撤回表，随后按已校验清单执行版本筛选与下载
    await saveUpdateState(files, state);
    const { payload } = decision;
    store.set(publication, { text: root.value, payload, revokedKeys: decision.state.revokedKeys });
    // 变更日志后置拉取，避免非关键网络请求阻塞检查流程
    queue = queue.then(() => feed.refresh(host.http, payload.changelog));

    let pending = versionRef((await loadPointer(files)).frontend.pending);
    if (pending && payload.revoked.includes(pending.v)) {
      const pointer = pendingPointer(await loadPointer(files), null);
      await files.writeText('current.json', JSON.stringify(pointer), { atomic: true });
      pending = null;
    }
    const context = {
      current: startup.session.version.v,
      plugin: startup.plugin,
      loader: startup.session.loader,
      revoked: payload.revoked,
      failed: await loadFailedReleases(files),
    };
    const choice = selectRelease(payload.stable, context);
    alive();
    store.set(catalog, {
      candidates: payload.stable,
      context,
      pending: pending?.v ?? null,
      target: choice.kind === 'install' ? choice.candidate.version : null,
    });
    if (choice.kind === 'current') return idle(null);
    if (choice.kind === 'blocked')
      return show({
        phase: 'blocked',
        latest: choice.latest,
        limit: choice.limit,
        pluginRange: choice.pluginRange,
      });
    const { candidate } = choice;
    const downloaded =
      pending?.v === candidate.version &&
      marker(json(await files.readText(`fe/${pending.dir}/installed.json`)), pending)
        ?.releaseSha256 === candidate.releaseSha256;
    if (!download && !downloaded)
      return show({
        phase: 'available',
        version: candidate.version,
        latest: choice.latest,
        limit: choice.limit,
        pluginRange: choice.pluginRange,
      });
    const exhausted = exhaustedFailure(state, candidate.version);
    if (exhausted && !manual) return idle(exhausted, true);

    show({ phase: 'downloading', version: candidate.version });
    const releaseBytes = await fetchVerified(host.http, candidate.release, {
      sha256: candidate.releaseSha256,
      limit: RELEASE_LIMIT,
    });
    alive();
    if (!releaseBytes.ok) return fail(files, state, candidate.version, releaseBytes.problem);
    const release = readRelease(new TextDecoder().decode(releaseBytes.value), candidate);
    if (!release) return fail(files, state, candidate.version, 'release');
    const ready = {
      phase: 'ready',
      version: candidate.version,
      notes: release.notes,
      latest: choice.latest,
      limit: choice.limit,
      pluginRange: choice.pluginRange,
    } as const;
    if (downloaded) return show(ready);

    const zip = await fetchVerified(host.http, release.frontend.url, {
      sha256: release.frontend.sha256,
      size: release.frontend.size,
      limit: release.frontend.size,
    });
    alive();
    if (!zip.ok) return fail(files, state, candidate.version, zip.problem);
    show({ phase: 'installing', version: candidate.version });
    const result = await installFrontend(
      files,
      candidate.version,
      candidate.releaseSha256,
      zip.value,
      install,
    );
    alive();
    if (!result.ok) return fail(files, state, candidate.version, result.problem);
    // 外部写入可能在解压期间改写指针，写入 pending 前重新校验指针与当前运行版本的一致性
    const latest = await loadPointer(files);
    if (replaced(latest, startup.session)) return show({ phase: 'replaced' });
    const pointer = pendingPointer(latest, result.version);
    if (await pluginMaintenanceActive(files)) {
      show({ phase: 'maintenance' });
      return;
    }
    await files.writeText('current.json', JSON.stringify(pointer), { atomic: true });
    alive();
    store.set(catalog, (value) => value && { ...value, pending: result.version.v });
    if (state.failures[candidate.version])
      await saveUpdateState(files, withoutFailures(state, candidate.version));
    show(ready);
  }

  function check(kind: CheckKind): Promise<void> {
    if (running) return running;
    const startup = store.get(confirmedStartupAtom);
    if (
      disposed ||
      options.storageAvailable === false ||
      !startup ||
      (kind === 'scheduled' && store.get(EFFECTIVE_UPDATE_MODE) === 'off')
    )
      return Promise.resolve();
    const task = queue.then(() =>
      run(startup, kind).catch((error: unknown) => {
        if (disposed) return;
        if (presence?.shared()) show({ phase: 'shared' });
        else if (error instanceof UpdateStateError) show({ phase: 'manual', reason: error.reason });
        else idle('storage');
      }),
    );
    queue = task;
    running = task.finally(() => {
      running = undefined;
    });
    return running;
  }

  function clean(startup: ConfirmedStartup): void {
    queue = queue.then(async () => {
      if (disposed || !presence || presence.shared()) return;
      const files = templateFiles(host.file, startup.directory, alive);
      try {
        if (await pluginMaintenanceActive(files)) return;
        await cleanVersions(files, host, startup.session.version, await presence.stale(), alive);
      } catch {
        // 清理异常不阻断本次运行，未能删除的历史目录留待下次启动清理
      }
    });
  }

  /** 宿主挂起恢复后自动补发已超期的定时检查，无需额外注入补偿事件 */
  function plan(delay: number): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void check('scheduled').finally(() => {
        if (!disposed && !presence?.shared() && store.get(EFFECTIVE_UPDATE_MODE) !== 'off')
          plan(INTERVAL_MS * (1 - JITTER + 2 * JITTER * random()));
      });
    }, delay);
  }

  function sync(): void {
    if (disposed) return;
    if (options.storageAvailable === false) return show({ phase: 'off', reason: 'storage' });
    const startup = store.get(confirmedStartupAtom);
    if (startup && !presence) {
      const files = templateFiles(host.file, startup.directory, alive);
      presence = startRunMarker(files, host, startup.session.sessionId, () => {
        show({ phase: 'shared' });
        if (timer !== undefined) clearTimeout(timer);
        if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
        timer = undefined;
        cleanupTimer = undefined;
      });
      void presence.refresh();
      const dir = startup.session.version.dir;
      queue = queue.then(() => feed.loadBundled(files, dir));
      cleanupTimer = setTimeout(() => clean(startup), CLEANUP_DELAY_MS);
    }
    if (startup && store.get(status).phase === 'off') idle(null);
    if (startup && !presence?.shared() && store.get(EFFECTIVE_UPDATE_MODE) !== 'off') {
      // 即使当前检查正在执行仍排入队列，避免前台手动检查结束后丢失自动轮询调度
      if (timer === undefined) plan(FIRST_CHECK_MS);
    } else if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }
  const offs = [store.sub(confirmedStartupAtom, sync), store.sub(EFFECTIVE_UPDATE_MODE, sync)];
  sync();

  return {
    status: atom((get) => get(status)),
    mode: EFFECTIVE_UPDATE_MODE,
    changelog: feed.changelog,
    changelogLoading: feed.loading,
    changelogFailed: feed.failed,
    catalog: atom((get) => get(catalog)),
    persistence: prefs,
    publication: atom((get) => get(publication)),
    maintain(action) {
      const startup = store.get(confirmedStartupAtom);
      const task = queue.then(async () => {
        alive();
        if (
          !startup ||
          options.storageAvailable === false ||
          store.get(confirmedStartupAtom) !== startup
        )
          throw new Error('当前安装尚未就绪');
        const files = templateFiles(host.file, startup.directory, alive);
        if (await pluginMaintenanceActive(files)) throw new Error('已有插件维护事务');
        const previous = store.get(status);
        maintaining = true;
        show({ phase: 'maintenance' });
        try {
          await action();
        } finally {
          maintaining = false;
          if (!disposed && !(await pluginMaintenanceActive(files))) show(previous);
        }
      });
      queue = task.catch(() => {});
      return task;
    },
    setMode: (value) =>
      options.storageAvailable === false ? Promise.resolve(false) : prefs.set(UPDATE_MODE, value),
    check: () => check('manual'),
    install: () => (running ?? Promise.resolve()).then(() => check('install')),
    reset: () =>
      (running ?? Promise.resolve()).then(() => {
        const current = store.get(status);
        if (current.phase === 'manual' && current.reason === 'state') return check('reset');
      }),
    restart: () =>
      maintaining || store.get(status).phase === 'maintenance'
        ? Promise.resolve(false)
        : hostCommand(() => host.misc.restart()),
    dispose() {
      disposed = true;
      for (const off of offs) off();
      if (timer !== undefined) clearTimeout(timer);
      if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
      presence?.dispose();
      feed.dispose();
      prefs.dispose();
    },
  };
}

export const updaterKey = serviceKey<UpdaterService>('updater');
