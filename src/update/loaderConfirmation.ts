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

/** 主窗口确认成功后才有值：这时安装标识已发布，页面来源、窗口模式与组件版本都满足更新器的运行条件。 */
export interface ConfirmedStartup {
  /** 模板目录的绝对路径，不带结尾的分隔符。 */
  readonly directory: string;
  readonly installId: string;
  /** 引导页为这次启动写进 cookie 的记录：运行中的版本、引导页版本与跳过的版本。 */
  readonly session: LoaderSession;
  /** 宿主组件 foo_ui_webview2 的版本。 */
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
  /** 只能在根组件提交后调用；同一时刻的确认共用一次工作，失败可显式重试。 */
  confirm(): Promise<void>;
  dispose(): void;
}

/** install-id 是引导页公开的同源资源，这次读取与 cookie 共同确定当前安装及启动标识。 */
async function pageInstallId(url: URL): Promise<string> {
  let response: Response;
  try {
    response = await fetch(new URL('/install-id', url), {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    // 虚拟主机不为缺失文件返回 404；发布新标识前仍须经宿主确认文件确实不存在。
    if (url.origin === 'https://foo-ui-webview2.local' && error instanceof TypeError) return '';
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

/** 面板只确认说明页已提交，不写安装标识、指针或版本文件。 */
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
      if (
        !versionAtLeast(info.plugin.version, REQUIRED_HOST_VERSION) ||
        !['panelTemplate', 'activeTemplate', 'defaultTemplate'].includes(source.source)
      ) {
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
      let currentText: string | null = null;
      try {
        currentText = await read('current.json');
      } catch {
        current();
      }
      const pointer =
        readPointer(json(currentText)) ?? readPointer(json(await read('last-good.json')));
      if (!pointer) throw new Error('没有可确认的版本指针');
      const next = confirmedPointer(pointer, session);
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
    }, lifetime.signal);
  }

  return {
    confirm() {
      if (disposed || ['confirmed', 'disabled'].includes(store.get(loaderConfirmationAtom)))
        return Promise.resolve();
      if (running) return running;
      running = confirm()
        .catch(() => {
          if (!disposed) store.set(loaderConfirmationAtom, 'failed');
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
