import { fb } from 'foo-webview-sdk/bridge';
import { atom } from 'jotai/vanilla';
import { hostCommand, settle } from '../host/hostCall.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import type { BackendConnection } from '../server/backendConnection.ts';
import { readPluginStatus, type PluginTransactionStatus } from '../server/pluginProtocol.ts';
import type { BackendBootstrap } from './backendBootstrap.ts';
import {
  BUILT_IN_KEYS,
  isSha256,
  sha256,
  type PluginCandidate,
  type PublishedKey,
} from './contract.ts';
import { confirmedStartupAtom, type ConfirmedStartup } from './loaderConfirmation.ts';
import { json, marker, record, sameVersion, versionRef } from './loaderContract.ts';
import {
  pluginFits,
  selectPluginCandidate,
  verifyPluginRelease,
  type PluginInstalled,
  type PluginRelease,
} from './pluginRelease.ts';
import { fetchVerified, type ReleaseHttp } from './releaseFetch.ts';
import { templateFiles, type TemplateFileHost, type TemplateFiles } from './templateFiles.ts';
import type { UpdaterService, UpdatePublication } from './updater.ts';
import { loadPointer } from './updateState.ts';

interface PluginOffer {
  readonly candidate: PluginCandidate;
  readonly release: PluginRelease;
  readonly text: string;
}
export type PluginUpdateStatus =
  | { readonly phase: 'off' | 'checking' | 'current' }
  | { readonly phase: 'available'; readonly version: string; readonly sha256: string }
  | { readonly phase: 'downloading' | 'preparing' | 'restarting'; readonly version: string }
  | { readonly phase: 'blocked'; readonly reason: 'backend' | 'pending' | 'compatibility' }
  | { readonly phase: 'transaction'; readonly transaction: PluginTransactionStatus }
  | { readonly phase: 'failed'; readonly detail: string; readonly directory?: string };

export interface PluginUpdateHost {
  readonly file: TemplateFileHost;
  readonly http: ReleaseHttp;
  readonly config: Pick<typeof fb.config, 'getVersionInfo'>;
  readonly misc: Pick<
    typeof fb.misc,
    'getFoobarPath' | 'getComponentPath' | 'getProfilePath' | 'exit'
  >;
  readonly shell: Pick<typeof fb.shell, 'showInExplorer'>;
}
interface PluginUpdaterOptions {
  readonly host?: PluginUpdateHost;
  readonly keys?: readonly PublishedKey[];
  readonly pause?: () => Promise<void>;
}
const FAILED_FILE = 'state/failed-plugin-releases.json';
const WRITE_CHUNK = 4 * 1024 * 1024;

async function failedReleases(files: TemplateFiles): Promise<string[]> {
  const text = await files.readText(FAILED_FILE);
  if (text === null) return [];
  const value = json(text);
  if (
    !record(value) ||
    value.schema !== 1 ||
    !Array.isArray(value.releases) ||
    !value.releases.every(isSha256)
  )
    throw new Error('插件失败记录无法读取');
  return value.releases;
}

/** 插件只自动发现；下载、准备和宿主退出都必须由明确的安装操作发起。 */
export function startPluginUpdater(
  store: Store,
  updater: Pick<UpdaterService, 'publication' | 'check' | 'maintain' | 'status'>,
  backend: Pick<BackendBootstrap, 'status'>,
  connection: Pick<BackendConnection, 'request'>,
  options: PluginUpdaterOptions = {},
) {
  const host = options.host ?? fb;
  const keys = options.keys ?? BUILT_IN_KEYS;
  const pause = options.pause ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
  const status = atom<PluginUpdateStatus>({ phase: 'off' });
  let disposed = false;
  let generation = 0;
  let offer: PluginOffer | null = null;
  let installing = false;
  let refreshing: Promise<void> | null = null;
  let transaction: PluginTransactionStatus | null = null;
  let poll: ReturnType<typeof setTimeout> | undefined;
  const show = (value: PluginUpdateStatus) => {
    if (!disposed) store.set(status, value);
  };
  function current(startup: ConfirmedStartup, turn: number): void {
    if (disposed || generation !== turn || store.get(confirmedStartupAtom) !== startup)
      throw new Error('插件更新操作已取消');
    if (store.get(updater.status).phase === 'shared') throw new Error('主题目录被其他实例共用');
  }
  async function installed(startup: ConfirmedStartup): Promise<PluginInstalled> {
    const info = await settle(() => host.config.getVersionInfo());
    if (!info || info.success === false || info.plugin.version !== startup.plugin)
      throw new Error('无法确认当前插件版本');
    return {
      arch: info.is64bit ? 'x64' : 'x86',
      plugin: info.plugin.version,
      theme: startup.session.version.v,
    };
  }
  async function readTransaction(): Promise<PluginTransactionStatus | null> {
    const value = await connection.request('/plugin/status');
    if (value === null) return null;
    const parsed = readPluginStatus(value);
    if (!parsed) throw new Error('插件更新应答无效');
    return parsed;
  }
  async function rememberFailure(
    files: TemplateFiles,
    value: PluginTransactionStatus,
  ): Promise<void> {
    if (value.phase !== 'rolledBack' && value.phase !== 'needsRepair') return;
    const failed = await failedReleases(files);
    if (!failed.includes(value.releaseSha256))
      await files.writeText(
        FAILED_FILE,
        JSON.stringify({ schema: 1, releases: [...failed, value.releaseSha256] }),
        { atomic: true },
      );
  }
  function schedule(): void {
    if (poll !== undefined) clearTimeout(poll);
    if (!disposed)
      poll = setTimeout(() => {
        poll = undefined;
        void refresh();
      }, 2000);
  }
  async function findOffer(
    publication: UpdatePublication,
    local: PluginInstalled,
    failed: readonly string[],
    check: () => void,
  ): Promise<PluginOffer | null> {
    const candidates = [...publication.payload.plugins];
    while (candidates.length) {
      const candidate = selectPluginCandidate(candidates, local, failed);
      if (!candidate) return null;
      candidates.splice(candidates.indexOf(candidate), 1);
      const fetched = await fetchVerified(host.http, candidate.url, {
        ...candidate,
        limit: candidate.size,
      });
      check();
      if (!fetched.ok) throw new Error(`插件发行清单下载失败：${fetched.problem}`);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(fetched.value);
      const release = await verifyPluginRelease(
        text,
        keys.filter((key) => !publication.revokedKeys.includes(key.keyId)),
      );
      check();
      if (release.version !== candidate.version || release.arch !== candidate.arch)
        throw new Error('插件发行清单与候选不一致');
      if (pluginFits(release, local)) return { candidate, release, text };
    }
    return null;
  }

  function refresh(): Promise<void> {
    if (disposed || installing) return Promise.resolve();
    if (refreshing) return refreshing;
    const turn = ++generation;
    const startup = store.get(confirmedStartupAtom);
    offer = null;
    refreshing = (async () => {
      if (!startup || store.get(updater.status).phase === 'off') return show({ phase: 'off' });
      const check = () => current(startup, turn);
      const files = templateFiles(host.file, startup.directory, check);
      const service = store.get(backend.status).phase;
      if (service !== 'ready')
        return show(
          service !== 'unsupported' && store.get(updater.publication)?.payload.plugins.length
            ? { phase: 'blocked', reason: 'backend' }
            : { phase: 'off' },
        );
      transaction = await readTransaction();
      check();
      if (transaction) {
        await rememberFailure(files, transaction);
        check();
        if (!['committed', 'rolledBack', 'cancelled', 'prepared'].includes(transaction.phase)) {
          show({ phase: 'transaction', transaction });
          schedule();
          return;
        }
      }
      const publication = store.get(updater.publication);
      if (!publication?.payload.plugins.length)
        return show(transaction ? { phase: 'transaction', transaction } : { phase: 'off' });
      if ((await loadPointer(files)).frontend.pending !== undefined)
        return show({ phase: 'blocked', reason: 'pending' });
      show({ phase: 'checking' });
      const local = await installed(startup);
      check();
      const failed = await failedReleases(files);
      offer = await findOffer(publication, local, failed, check);
      check();
      if (publication !== store.get(updater.publication)) return;
      if (offer)
        return show({
          phase: 'available',
          version: offer.release.version,
          sha256: offer.candidate.sha256,
        });
      show(
        transaction && ['rolledBack', 'cancelled'].includes(transaction.phase)
          ? { phase: 'transaction', transaction }
          : selectPluginCandidate(publication.payload.plugins, local, failed)
            ? { phase: 'blocked', reason: 'compatibility' }
            : { phase: 'current' },
      );
    })()
      .catch((error: unknown) => {
        if (!disposed && generation === turn)
          show({
            phase: 'failed',
            detail: error instanceof Error ? error.message : '插件更新检查失败',
          });
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  async function install(expected: string): Promise<void> {
    if (disposed || installing) return;
    const selected = offer;
    if (!selected || selected.candidate.sha256 !== expected)
      return show({ phase: 'failed', detail: '插件候选已变化，请重新检查' });
    installing = true;
    if (poll !== undefined) clearTimeout(poll);
    const turn = ++generation;
    const startup = store.get(confirmedStartupAtom);
    let prepared: PluginTransactionStatus | null = null;
    try {
      if (!startup) throw new Error('当前主题尚未确认');
      const check = () => current(startup, turn);
      show({ phase: 'preparing', version: selected.release.version });
      await updater.check();
      check();
      const publication = store.get(updater.publication);
      if (!publication || !publication.payload.plugins.some((item) => item.sha256 === expected))
        throw new Error('插件候选已变化，请重新检查');
      await updater.maintain(async () => {
        check();
        if (store.get(backend.status).phase !== 'ready') throw new Error('本地后端尚未就绪');
        const files = templateFiles(host.file, startup.directory, check);
        const pointer = await loadPointer(files);
        if (
          pointer.frontend.pending !== undefined ||
          !sameVersion(versionRef(pointer.frontend.version), startup.session.version)
        )
          throw new Error('需要先启动并确认待更新的主题');
        const local = await installed(startup);
        check();
        if (!pluginFits(selected.release, local)) throw new Error('当前插件和主题不在兼容组合内');
        await verifyPluginRelease(
          selected.text,
          keys.filter((key) => !publication.revokedKeys.includes(key.keyId)),
        );
        check();
        const installedMarker = marker(
          json(await files.readText(`fe/${startup.session.version.dir}/installed.json`)),
          startup.session.version,
        );
        if (!installedMarker?.releaseSha256) throw new Error('当前主题缺少发行身份');
        const [component, profile, program] = await Promise.all([
          settle(() => host.misc.getComponentPath()),
          settle(() => host.misc.getProfilePath()),
          settle(() => host.misc.getFoobarPath()),
        ]);
        check();
        if (
          !component ||
          component.success === false ||
          !profile ||
          profile.success === false ||
          !program ||
          program.success === false
        )
          throw new Error('无法确认当前宿主的安装目录');
        const payload = `state/plugin-${crypto.randomUUID()}`;
        show({ phase: 'downloading', version: selected.release.version });
        for (const file of selected.release.files) {
          const fetched = await fetchVerified(
            host.http,
            new URL(file.path, selected.candidate.url).href,
            { ...file, limit: file.size },
          );
          check();
          if (!fetched.ok) throw new Error(`插件下载失败：${fetched.problem}`);
          for (let offset = 0; offset < fetched.value.length; offset += WRITE_CHUNK) {
            check();
            await files.writeBytes(
              `${payload}/${file.path}`,
              fetched.value.subarray(offset, offset + WRITE_CHUNK),
              { append: offset > 0 },
            );
            await pause();
          }
          const actual = await files.readBytes(`${payload}/${file.path}`);
          if (!actual || (await sha256(actual)) !== file.sha256)
            throw new Error('插件下载文件读回校验失败');
          check();
        }
        show({ phase: 'preparing', version: selected.release.version });
        const raw = await connection.request('/plugin/prepare', {
          root: publication.text,
          request: {
            componentDirectory: component.path,
            profileDirectory: profile.path,
            executable: `${program.path.replace(/[\\/]+$/, '')}\\foobar2000.exe`,
            theme: startup.session.version,
            themeRelease: installedMarker.releaseSha256,
            previousVersion: local.plugin,
            signedRelease: selected.text,
            payloadDirectory: files.path(payload),
          },
        });
        prepared = readPluginStatus(raw);
        if (!prepared || prepared.releaseSha256 !== expected) throw new Error('插件准备应答无效');
        transaction = prepared;
        check();
        const ready = readPluginStatus(await connection.request('/plugin/start', prepared));
        check();
        if (
          !ready ||
          ready.id !== prepared.id ||
          ready.nonce !== prepared.nonce ||
          ready.sha256 !== prepared.sha256 ||
          !ready.attempt ||
          !ready.running ||
          ready.phase !== 'waitingExit'
        )
          throw new Error('执行器尚未确认本次安装');
        const authorization = await connection.request('/plugin/authorize', ready);
        if (!record(authorization) || authorization.success !== true)
          throw new Error('退出授权未获确认');
        check();
        show({ phase: 'restarting', version: selected.release.version });
        if (!(await hostCommand(() => host.misc.exit()))) throw new Error('无法退出 foobar2000');
      });
    } catch (error) {
      if (prepared) {
        const ref: PluginTransactionStatus = prepared;
        await connection.request('/plugin/cancel', ref).catch(() => {});
        if (!disposed) schedule();
      }
      if (!disposed)
        show({
          phase: 'failed',
          detail: error instanceof Error ? error.message : '插件安装失败',
          ...(prepared ? { directory: (prepared as PluginTransactionStatus).directory } : {}),
        });
    } finally {
      installing = false;
    }
  }

  const sync = () => {
    if (refreshing) void refreshing.then(() => refresh());
    else void refresh();
  };
  const offs = [
    store.sub(confirmedStartupAtom, sync),
    store.sub(updater.publication, sync),
    store.sub(backend.status, sync),
  ];
  sync();
  return {
    status: atom((get) => get(status)),
    async check() {
      await updater.check();
      await refresh();
    },
    install,
    async openRecovery(): Promise<boolean> {
      const own = transaction;
      if (!own) return false;
      return hostCommand(() => host.shell.showInExplorer(`${own.directory}\\recover.cmd`));
    },
    dispose() {
      disposed = true;
      generation += 1;
      for (const off of offs) off();
      if (poll !== undefined) clearTimeout(poll);
    },
  };
}

export const pluginUpdaterKey = serviceKey<ReturnType<typeof startPluginUpdater>>('pluginUpdater');
