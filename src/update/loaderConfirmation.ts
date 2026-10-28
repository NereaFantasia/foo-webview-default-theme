import { fb, webview } from 'foo-webview-sdk/bridge';
import { atom } from 'jotai/vanilla';
import metadata from '../../package.json' with { type: 'json' };
import type { Store } from '../kit/store.ts';
import { browserLoaderStorage, type LoaderStorage } from '../kit/loaderStorage.ts';
import { settle } from '../host/hostCall.ts';
import { REQUIRED_HOST_VERSION, versionAtLeast } from '../host/hostInfo.ts';
import {
  confirmedPointer,
  cookieName,
  installationId,
  json,
  loadedVersion,
  marker,
  readAttempts,
  readPointer,
  readSession,
  record,
  sameVersion,
  setAttempts,
  versionRef,
  type LoaderSession,
  type VersionRef,
} from './loaderContract.ts';
import { templateFiles } from './templateFiles.ts';

export const loaderConfirmationAtom = atom<'waiting' | 'confirmed' | 'disabled' | 'failed'>(
  'waiting',
);

/** 宿主为模板目录里的页面提供的虚拟域名 */
const VIRTUAL_HOST = 'https://foo-ui-webview2.local';
/** 更新器认可的主题来源：都是 `<profile>\webview-ui\` 下的模板目录 */
const TEMPLATE_SOURCES: readonly string[] = ['panelTemplate', 'activeTemplate', 'defaultTemplate'];

/** 更新器不运行的原因；确认进行中和确认成功时没有 */
export type StartupBlock =
  /** 宿主虚拟域名上的页面不在 `/fe/<目录>/` 下：没有按完整主题包的目录结构安装，模板目录或组件目录里平铺的 dist 都在此列 */
  | { readonly reason: 'layout' }
  /** 来源不是模板目录：页面在开发服务器或 URL 上，或按完整主题包布局放进了组件目录 */
  | { readonly reason: 'source' }
  /** 插件版本低于主题要求，应用内的插件更新同样要等启动确认，只能手动更新 */
  | { readonly reason: 'host'; readonly version: string; readonly required: string }
  /** 确认过程出错，可以重试 */
  | { readonly reason: 'failed' };
export const startupBlockAtom = atom<StartupBlock | null>(null);

function blockOf(source: string, plugin: string): StartupBlock | null {
  if (!TEMPLATE_SOURCES.includes(source)) return { reason: 'source' };
  if (!versionAtLeast(plugin, REQUIRED_HOST_VERSION))
    return { reason: 'host', version: plugin, required: REQUIRED_HOST_VERSION };
  return null;
}

/** 主窗口启动确认就绪状态：安装标识已发布，且运行环境、窗口形态与组件版本均满足更新契约 */
export interface ConfirmedStartup {
  /** 模板目录绝对路径，尾部不含分隔符 */
  readonly directory: string;
  readonly installId: string;
  /** 引导程序本次启动的记录，包含运行版本、引导器版本与跳过版本集 */
  readonly session: LoaderSession;
  /** 宿主插件 foo_ui_webview2 版本信息 */
  readonly plugin: string;
}
export const confirmedStartupAtom = atom<ConfirmedStartup | null>(null);

export interface LoaderHost {
  readonly ui: Pick<typeof fb.ui, 'getMode' | 'getCurrentWindowId'>;
  readonly config: Pick<typeof fb.config, 'getVersionInfo'>;
  readonly file: Pick<typeof fb.file, 'read' | 'write' | 'exists'>;
  readonly getSource: typeof webview.getSource;
}
export interface LoaderConfirmationOptions {
  readonly host?: LoaderHost;
  readonly storage?: LoaderStorage;
  readonly url?: URL;
  readonly readId?: () => Promise<string>;
  readonly randomId?: () => string;
}
export interface LoaderConfirmationService {
  /** 执行启动确认；限定于根组件挂载后触发，并发调用复用单次任务，失败支持显式重试 */
  confirm(): Promise<void>;
  dispose(): void;
}

/** 读取引导页公开同源资源 install-id，结合 session cookie 校验安装实例与启动标记 */
async function pageInstallId(url: URL): Promise<string> {
  let response: Response;
  try {
    response = await fetch(new URL('/install-id', url), {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    // 虚拟主机缺失资源时不触发 404 响应；生成新安装标识前须由宿主文件系统校验资源缺位
    if (url.origin === VIRTUAL_HOST && error instanceof TypeError) return '';
    throw error;
  }
  if (response.status === 404) return '';
  if (!response.ok) throw new Error('无法读取安装标识');
  const id = (await response.text()).trim();
  if (!installationId(id)) throw new Error('安装标识无效');
  return id;
}
function pageSession(storage: LoaderStorage, id: string, version: VersionRef): LoaderSession {
  const session = readSession(json(storage.readCookie(cookieName(id))));
  if (!session || !sameVersion(session.version, version))
    throw new Error('启动会话与当前页面不一致');
  return session;
}
function clearAttempts(storage: LoaderStorage, id: string, version: VersionRef): void {
  const ledger = readAttempts(json(storage.readAttempts()));
  storage.writeAttempts(JSON.stringify(setAttempts(ledger, id, version.dir, 0)));
}

/** 独立面板模式启动确认：仅校验展示说明页已挂载，不持久化安装标识、版本指针或状态标记 */
export async function clearPanelStartup(
  options: Pick<LoaderConfirmationOptions, 'storage' | 'url' | 'readId'> = {},
): Promise<boolean> {
  const url = options.url ?? new URL(location.href);
  const version = loadedVersion(url);
  if (!version) return true;
  const storage = options.storage ?? browserLoaderStorage();
  try {
    await storage.lock(async () => {
      const id = await (options.readId ? options.readId() : pageInstallId(url));
      pageSession(storage, id, version);
      clearAttempts(storage, id, version);
    });
    return true;
  } catch {
    return false;
  }
}

export function startLoaderConfirmation(
  store: Store,
  options: LoaderConfirmationOptions = {},
): LoaderConfirmationService {
  const host = options.host ?? {
    ui: fb.ui,
    config: fb.config,
    file: fb.file,
    getSource: webview.getSource,
  };
  const storage = options.storage ?? browserLoaderStorage();
  const url = options.url ?? new URL(location.href);
  const version = loadedVersion(url);
  const lifetime = new AbortController();
  let disposed = false;
  let running: Promise<void> | undefined;
  let proposedId: string | undefined;
  store.set(loaderConfirmationAtom, version ? 'waiting' : 'disabled');
  if (!version)
    store.set(startupBlockAtom, { reason: url.origin === VIRTUAL_HOST ? 'layout' : 'source' });

  function current(): void {
    if (disposed) throw new Error('启动确认已释放');
  }

  async function confirm(): Promise<void> {
    if (!version) return;
    if (version.v !== metadata.version) throw new Error('页面目录与应用版本不一致');
    const window = await settle(() => host.ui.getCurrentWindowId());
    current();
    if (!window || window.success === false) throw new Error('无法确认主窗口');
    if (window.windowId !== 'main') {
      store.set(loaderConfirmationAtom, 'disabled');
      return;
    }
    const mode = await settle(() => host.ui.getMode());
    current();
    if (!mode || mode.success === false) throw new Error('无法确认窗口模式');
    await storage.lock(async () => {
      current();
      const id = await (options.readId ? options.readId() : pageInstallId(url));
      current();
      const session = pageSession(storage, id, version);
      clearAttempts(storage, id, version);
      if (mode.panelMode || mode.mode !== 'standalone') {
        // 面板由启动页拦下，设置页看不到这一步，不记原因
        store.set(loaderConfirmationAtom, 'disabled');
        return;
      }
      const [source, info] = await Promise.all([
        settle(() => host.getSource()),
        settle(() => host.config.getVersionInfo()),
      ]);
      current();
      if (!source || source.success === false || !info || info.success === false)
        throw new Error('无法确认主题来源');
      const block = blockOf(source.source, info.plugin.version);
      if (block) {
        store.set(startupBlockAtom, block);
        store.set(loaderConfirmationAtom, 'disabled');
        return;
      }
      if (!source.directory?.replace(/[\\/]+$/, '')) throw new Error('主题目录不可用');
      const files = templateFiles(host.file, source.directory, current);
      const read = (relative: string) => files.readText(relative);
      const write = (relative: string, text: string) =>
        files.writeText(relative, text, { atomic: true });
      const storedId = (await read('install-id'))?.trim() ?? '';
      if (storedId !== id) throw new Error('安装标识在确认期间变化');
      if (!marker(json(await read(`fe/${version.dir}/installed.json`)), version))
        throw new Error('当前版本不完整');
      const readOrNull = async (relative: string) => {
        try {
          return await read(relative);
        } catch {
          current();
          return null;
        }
      };
      const currentText = await readOrNull('current.json');
      const lastGood = readPointer(json(await readOrNull('last-good.json')));
      const pointer = readPointer(json(currentText)) ?? lastGood;
      if (!pointer) throw new Error('没有可确认的版本指针');
      // 当前指针缺失 previous 回退版本时（如外部解压全量包），从 last-good 检索本地完整副本作为补入目标
      const known: VersionRef[] = [];
      if (!versionRef(pointer.frontend.previous))
        for (const key of ['version', 'previous']) {
          const ref = versionRef(lastGood?.frontend[key]);
          if (
            ref &&
            !sameVersion(ref, session.version) &&
            marker(json(await readOrNull(`fe/${ref.dir}/installed.json`)), ref)
          )
            known.push(ref);
        }
      const next = confirmedPointer(pointer, session, known);
      if (!next) throw new Error('版本指针已变化');
      const skipped = session.skipped.filter((ref) =>
        pointer.refs.some((candidate) => sameVersion(candidate, ref)),
      );
      if (skipped.length) {
        const saved = await read('state/failed-releases.json');
        const raw = saved === null ? { schema: 1, releases: [] } : json(saved);
        if (!record(raw) || raw.schema !== 1 || !Array.isArray(raw.releases))
          throw new Error('坏版本记录损坏');
        const releases = raw.releases;
        if (
          releases.some(
            (entry) =>
              !record(entry) ||
              !versionRef({ v: entry.v, dir: entry.v }) ||
              typeof entry.releaseSha256 !== 'string' ||
              !/^[0-9a-f]{64}$/.test(entry.releaseSha256),
          )
        )
          throw new Error('坏版本记录损坏');
        for (const ref of skipped) {
          const bad = marker(json(await read(`fe/${ref.dir}/installed.json`)), ref);
          if (!bad?.releaseSha256) throw new Error('跳过的版本没有发行身份，不能移除引用');
          if (
            !releases.some(
              (entry) =>
                record(entry) && entry.v === ref.v && entry.releaseSha256 === bad.releaseSha256,
            )
          )
            releases.push({ v: ref.v, releaseSha256: bad.releaseSha256 });
        }
        await write('state/failed-releases.json', JSON.stringify({ ...raw, releases }));
      }
      if (!id) {
        proposedId ??= (options.randomId ?? (() => crypto.randomUUID()))();
        if (!installationId(proposedId)) throw new Error('安装标识无效');
        storage.writeCookie(cookieName(proposedId), JSON.stringify(session));
        let ledger = readAttempts(json(storage.readAttempts()));
        for (const ref of [...pointer.refs, ...session.skipped, version])
          ledger = setAttempts(
            ledger,
            proposedId,
            ref.dir,
            ledger.installations['']?.[ref.dir] ?? 0,
          );
        storage.writeAttempts(JSON.stringify(ledger));
        await write('install-id', proposedId);
      }
      if (JSON.stringify(next) !== JSON.stringify(pointer.raw) || !readPointer(json(currentText)))
        await write('current.json', JSON.stringify(next));
      await write('last-good.json', JSON.stringify(next));
      store.set(confirmedStartupAtom, {
        directory: files.directory,
        installId: id || (proposedId ?? ''),
        session,
        plugin: info.plugin.version,
      });
      store.set(loaderConfirmationAtom, 'confirmed');
      store.set(startupBlockAtom, null);
    }, lifetime.signal);
  }

  return {
    confirm() {
      if (disposed || ['confirmed', 'disabled'].includes(store.get(loaderConfirmationAtom)))
        return Promise.resolve();
      if (running) return running;
      running = confirm()
        .catch(() => {
          if (disposed) return;
          store.set(startupBlockAtom, { reason: 'failed' });
          store.set(loaderConfirmationAtom, 'failed');
        })
        .finally(() => {
          running = undefined;
        });
      return running;
    },
    dispose() {
      disposed = true;
      lifetime.abort();
    },
  };
}
