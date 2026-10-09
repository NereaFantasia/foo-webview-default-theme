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
import { json, marker, pendingPointer, versionRef } from './loaderContract.ts';
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
 * 前端自动更新：只在主窗口确认成功之后运行。检查、下载、安装与改指针一次只跑一轮；新版本装进新目录，
 * 最后原子写指针的 pending，下次启动由引导页接手。从不降级，也不自动重启。
 */

/** 旧版的自动更新开关，只读不删：新的模式键没有值时，它为 true 视为 auto，其余视为 off。 */
export const AUTO_UPDATE = defineConfigPref('defaultTheme.update.auto', false, (value) =>
  typeof value === 'boolean' ? value : undefined,
);
export const UPDATE_MODES = ['off', 'notify', 'auto'] as const;
/** off 只在用户检查时查；notify 定时检查，有新版只提示；auto 定时检查并下载安装。都不自动重启。 */
export type UpdateMode = (typeof UPDATE_MODES)[number];
/** 没存过时为 null，按旧开关推算。 */
export const UPDATE_MODE = defineConfigPref<UpdateMode | null>(
  'defaultTheme.update.mode',
  null,
  oneOf(UPDATE_MODES),
);
const MODE = atom<UpdateMode>(
  (get) => get(UPDATE_MODE.atom) ?? (get(AUTO_UPDATE.atom) ? 'auto' : 'off'),
);
/** scheduled 是定时检查；manual 是用户点检查；install 是用户点下载并安装；reset 是重置后的检查。 */
type CheckKind = 'scheduled' | 'manual' | 'install' | 'reset';

export type UpdateStatus =
  | { readonly phase: 'maintenance' }
  /** 这个窗口不运行更新器：还没确认、确认失败、弹窗或不受支持的来源。 */
  | { readonly phase: 'off'; readonly reason?: 'storage' }
  | {
      readonly phase: 'idle';
      /** 最近一次取到根清单（成败都算）的时间，毫秒。 */
      readonly checkedAt: number | null;
      readonly failure: UpdateFailure | null;
      /** 同一版本因同一原因失败到上限，自动检查不再重试它，手动检查仍会重试。 */
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
  /** 查到可装的版本，但这一轮不下载：notify 与 off 档，等用户点「下载并安装」。 */
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
  /** 只有更新状态损坏可就地重置；其他原因需手动处理，不清除坏版本记录。 */
  | {
      readonly phase: 'manual';
      readonly reason: 'format' | 'updater' | 'trust' | UpdateStateError['reason'];
    }
  /** 这次运行之后另有一个 foobar2000 在用这个模板目录：检查与清理都停下，直到下次启动。 */
  | { readonly phase: 'shared' };

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
  /** 自带副本或远端累计日志；两边都没有时为 null。 */
  readonly changelog: Atom<Changelog | null>;
  readonly changelogLoading: Atom<boolean>;
  readonly changelogFailed: Atom<boolean>;
  readonly catalog: Atom<ChangelogCatalog | null>;
  readonly persistence: ConfigPersistence;
  readonly publication: Atom<UpdatePublication | null>;
  /**
   * 在主题检查、指针提交与清理的同一队列里执行组件维护；执行期间状态为 `maintenance`，`restart` 返回 false。
   * 当前启动未确认、存储不可用，或已有未结束、读不懂的插件维护记录时拒绝执行。
   */
  maintain(action: () => Promise<void>): Promise<void>;
  setMode(mode: UpdateMode): Promise<boolean>;
  /** 手动检查：不看失败上限，auto 档接着下载安装，另两档只检查；正在检查时共用同一轮。 */
  check(): Promise<void>;
  /** 下载并安装：等正在跑的一轮结束后检查，查到新版就下载，不看模式与失败上限。 */
  install(): Promise<void>;
  /** 更新状态损坏时由用户发起：写回初始状态后立刻手动检查一次。 */
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
/** 定时检查前后各浮动一成，避免大量客户端在同一时刻请求。 */
const JITTER = 0.1;
const ROOT_LIMIT = 2 * 1024 * 1024;
const RELEASE_LIMIT = 1024 * 1024;
const WRITE_PAUSE_MS = 30;
/** 清理放在启动约 10 分钟后：这时共用检测至少已经比对过一次。 */
const CLEANUP_DELAY_MS = 10 * 60_000;

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
  /** 检查与清理排在同一条队列里：清理算保留集时不能有安装进行到一半。 */
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
  /** 记下这个版本的失败；记不下来不影响本次提示，下次照样重试。 */
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
    const download = kind === 'install' || store.get(MODE) === 'auto';
    if (presence?.shared()) return show({ phase: 'shared' });
    const files = templateFiles(host.file, startup.directory, alive);
    store.set(catalog, null);
    if (await pluginMaintenanceActive(files)) {
      show({ phase: 'maintenance' });
      return;
    }
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
    // 序号、信任集与撤回表先整体落盘，之后才按这份清单选版本、下载。
    await saveUpdateState(files, state);
    const { payload } = decision;
    store.set(publication, { text: root.value, payload, revokedKeys: decision.state.revokedKeys });
    // 日志排在这一轮之后拉取，不拖慢检查。
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
    // 安装期间指针可能被启动确认之外的写入改过，提交前重新读一次。
    const pointer = pendingPointer(await loadPointer(files), result.version);
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
      (kind === 'scheduled' && store.get(MODE) === 'off')
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
        // 清理失败不影响使用，下次启动再删。
      }
    });
  }

  /** 页面被挂起时定时器跟着停，恢复后过期的那一次会立刻触发，不需要另外补查。 */
  function plan(delay: number): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void check('scheduled').finally(() => {
        if (!disposed && !presence?.shared() && store.get(MODE) !== 'off')
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
    if (startup && !presence?.shared() && store.get(MODE) !== 'off') {
      // 有检查在跑也要排上：手动检查结束时不会替自动检查续排。
      if (timer === undefined) plan(FIRST_CHECK_MS);
    } else if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }
  const offs = [store.sub(confirmedStartupAtom, sync), store.sub(MODE, sync)];
  sync();

  return {
    status: atom((get) => get(status)),
    mode: MODE,
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
