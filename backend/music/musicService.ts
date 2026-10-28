import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { MusicArtistAlbumsRequest } from '../../src/server/musicArtistAlbums.ts';
import {
  MUSIC_PROTOCOL,
  type MusicListRequest,
  type MusicListResult,
  type MusicReply,
  type MusicSearchKind,
  type MusicSearchRequest,
  type MusicSearchResult,
  type MusicFailureCode,
  type MusicStatus,
  type MusicTracksRequest,
} from '../../src/server/musicProtocol.ts';
import {
  type MusicQuality,
  type MusicRef,
  type MusicTrack,
} from '../../src/server/musicObjects.ts';
import { LX_PLATFORMS, type LxSourceOptions } from './lxSource.ts';
import { startLxConnection } from './lxConnection.ts';
import { LX_HEALTH_ACTIONS, startLxHealth } from './lxHealth.ts';
import { startLxHost } from './lxHost.ts';
import { startLxSourceBook } from './lxSourceBook.ts';
import {
  isLxSourceAction,
  LX_SOURCE_ACTIONS,
  MAX_SCRIPT_BYTES,
  startLxSources,
} from './lxSources.ts';
import { MusicError } from './musicError.ts';
import {
  artistAlbumsRequest,
  empty,
  listRequest,
  lxConfigRequest,
  lxSourceCheckRequest,
  resolveRequest,
  searchRequest,
  single,
  tracksRequest,
} from './musicRequests.ts';
import { startMusicStream } from './musicStream.ts';
import { startComponentInstall, type ComponentInstallOptions } from './componentInstall.ts';
import { startNcmSource, type NcmLoader } from './ncmSource.ts';
import { startNeteaseSettings, type NeteaseSettings } from './neteaseSettings.ts';
import { openTrackStore } from './trackStore.ts';

export interface MusicServiceOptions extends LxSourceOptions {
  /** 网易云组件装载器；缺省时不启用网易云 */
  readonly ncm?: NcmLoader;
  /** 网易云组件安装选项；缺省时禁止自动下载 */
  readonly ncmInstall?: Omit<ComponentInstallOptions, 'onInstalled'>;
  /**
   * 托管 lxserver 的运行环境与数据目录；支持按包安装或直接指定预装目录，缺省时不启用托管
   */
  readonly lxHost?: { readonly data: string; readonly node?: string } & (
    | { readonly install: Omit<ComponentInstallOptions, 'onInstalled' | 'name'> }
    | { readonly app: string }
  );
}

const MAX_BODY_BYTES = 16384;
/** 失败应答的 HTTP 状态映射；未列出的错误统一映射为 503 */
const HTTP_STATUS: Partial<Record<MusicFailureCode, number>> = {
  'invalid-request': 400,
  'not-found': 404,
  'rate-limited': 429,
  unsupported: 501,
  timeout: 504,
};
/** 网易云曲目元数据缓存有效期（毫秒）；过期后先返回本地缓存，并触发后台异步更新 */
const TRACK_REFRESH_MS = 24 * 60 * 60 * 1000;

/** 管理路由 `/music/<动作>`，都用 POST，要求页面来源与令牌 */
export const MUSIC_ACTIONS = [
  'status',
  'search',
  'tracks',
  'list',
  'artist-albums',
  'resolve',
  'failures',
  'login-start',
  'login-check',
  'logout',
  'unblock',
  'lx',
  'lx-test',
  'ncm',
  'ncm-install',
  'lx-component',
  'lx-install',
  ...LX_SOURCE_ACTIONS,
  ...LX_HEALTH_ACTIONS,
] as const;

function respond(response: ServerResponse, status: number, value: MusicReply<unknown>): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

export async function startMusicService(directory: string, options: MusicServiceOptions = {}) {
  const lifetime = new AbortController();
  const hosting = options.lxHost;
  const lxComponent =
    hosting && 'install' in hosting
      ? startComponentInstall({ ...hosting.install, name: 'lxserver' })
      : null;
  const lxApp = hosting && 'app' in hosting ? hosting.app : lxComponent?.directory;
  const host =
    hosting && lxApp
      ? startLxHost({
          app: lxApp,
          data: hosting.data,
          installed: lxComponent
            ? () => lxComponent.state().phase === 'installed'
            : () => existsSync(join(lxApp, 'index.js')),
          ...(hosting.node ? { node: hosting.node } : {}),
        })
      : null;
  const lxOptions = { ...options, book: options.book ?? startLxSourceBook() };
  const lx = await startLxConnection(directory, { ...lxOptions, host });
  const lxSources = host ? startLxSources(host, lxOptions) : null;
  /** 获取托管实例的音源管理句柄；外部自建实例不支持在此管理音源 */
  function sources() {
    if (!lxSources || !lx.hosted()) throw new MusicError('unsupported');
    return lxSources;
  }
  const health = startLxHealth({
    lx,
    list: (signal) => sources().list(signal),
    book: lxOptions.book,
  });
  let ncm: MusicStatus['ncm'] = options.ncm?.installed() ? 'installed' : 'missing';
  const component = options.ncmInstall
    ? startComponentInstall({
        ...options.ncmInstall,
        onInstalled: () => {
          if (ncm === 'missing' && options.ncm?.installed()) ncm = 'installed';
        },
      })
    : null;
  let netease: Promise<ReturnType<typeof startNcmSource>> | null = null;
  const settings = await startNeteaseSettings(directory);
  const status = (): MusicStatus => {
    const { cookie, nickname, unblock } = settings.get();
    return {
      platforms: [
        ...(ncm === 'missing' ? [] : ['wy' as const]),
        ...(lx.phase() === 'ready' ? LX_PLATFORMS : []),
      ],
      ncm,
      lx: lx.phase(),
      lxServer: lx.summary(),
      lxHosted: lx.hosted(),
      account: cookie ? { nickname } : null,
      unblock,
    };
  };
  /** 按需装载网易云源服务；并发请求共享加载过程，失败后允许后续重试 */
  function neteaseSource(): Promise<ReturnType<typeof startNcmSource>> {
    const loader = options.ncm;
    if (!loader || ncm === 'missing') return Promise.reject(new MusicError('not-installed'));
    netease ??= loader.load().then(
      (api) => {
        ncm = 'loaded';
        return startNcmSource(api, { settings: settings.get });
      },
      () => {
        ncm = 'failed';
        netease = null;
        throw new MusicError('upstream-unavailable');
      },
    );
    return netease;
  }
  // 根据平台分派搜索请求：网易云调用 NCM 源，其他平台统一走 LX 源
  async function search(
    input: MusicSearchRequest,
    signal: AbortSignal,
  ): Promise<MusicSearchResult<MusicSearchKind>> {
    if (input.platform === 'wy') {
      const netease = await neteaseSource();
      if (signal.aborted) throw new MusicError('cancelled');
      if (input.kind !== 'track') return netease.search(input, signal);
      const result = await netease.search({ ...input, kind: 'track' }, signal);
      store.put(
        'wy',
        result.items.map((track) => [track.ref.id, track] as const),
      );
      return result;
    }
    const lxSource = lx.ready();
    const result = await lxSource.source.search(input, signal);
    if (result.records.length) await lxSource.catalog.remember(result.records, signal);
    return result.result;
  }

  /** 网易云曲目元数据本地存储 */
  const store = openTrackStore(join(directory, 'music-tracks.v1.sqlite'));
  /** 记录正在后台异步刷新的曲目 ID，防止重复请求 */
  const refreshing = new Set<string>();

  async function fetchNeteaseTracks(ids: readonly string[], signal: AbortSignal) {
    const netease = await neteaseSource();
    if (signal.aborted) throw new MusicError('cancelled');
    const found = new Map(
      (await netease.tracks(ids, signal)).map((track) => [track.ref.id, track]),
    );
    const entries = ids.map((id) => [id, found.get(id) ?? null] as const);
    store.put('wy', entries);
    return entries;
  }

  async function tracks(input: MusicTracksRequest, signal: AbortSignal): Promise<MusicTrack[]> {
    if (input.platform === 'wy') {
      const stored = store.get('wy', input.ids);
      const known = new Map([...stored].map(([id, entry]) => [id, entry.track] as const));
      const due = [...stored]
        .filter(
          ([id, entry]) => Date.now() - entry.fetched >= TRACK_REFRESH_MS && !refreshing.has(id),
        )
        .map(([id]) => id);
      const missing = input.ids.filter((id) => !known.has(id));
      if (missing.length) {
        // 存在未缓存条目时同步请求上游，并将已到期条目合并更新
        for (const [id, track] of await fetchNeteaseTracks([...missing, ...due], signal))
          known.set(id, track);
      } else if (due.length) {
        // 全部条目均在本地有缓存时直接返回，仅对已到期条目触发后台静默刷新
        due.forEach((id) => refreshing.add(id));
        void fetchNeteaseTracks(due, lifetime.signal)
          .catch(() => {})
          .finally(() => due.forEach((id) => refreshing.delete(id)));
      }
      return input.ids.flatMap((id) => known.get(id) ?? []);
    }
    // LX 协议不支持按 ID 查询，通过本地搜索缓存目录还原曲目数据
    const lxSource = lx.ready();
    const items: MusicTrack[] = [];
    for (const id of input.ids) {
      try {
        items.push(lxSource.catalog.get({ platform: input.platform, id }).track);
      } catch (error) {
        if (!(error instanceof MusicError && error.code === 'track-missing')) throw error;
      }
    }
    return items;
  }

  /** 获取集合内容详情（歌单、专辑或艺人热门曲目） */
  async function list(input: MusicListRequest, signal: AbortSignal): Promise<MusicListResult> {
    if (input.ref.platform !== 'wy') throw new MusicError('unsupported');
    const netease = await neteaseSource();
    if (signal.aborted) throw new MusicError('cancelled');
    const result = await netease.list(input, signal);
    store.put(
      'wy',
      result.items.map((track) => [track.ref.id, track] as const),
    );
    return result;
  }

  /** 分页获取艺人专辑列表 */
  async function artistAlbums(input: MusicArtistAlbumsRequest, signal: AbortSignal) {
    if (input.ref.platform !== 'wy') throw new MusicError('unsupported');
    const netease = await neteaseSource();
    if (signal.aborted) throw new MusicError('cancelled');
    return netease.artistAlbums(input, signal);
  }

  async function resolve(
    ref: MusicRef,
    quality: MusicQuality,
    signal: AbortSignal,
    exclude: readonly string[] = [],
  ) {
    if (ref.platform === 'wy') {
      const netease = await neteaseSource();
      if (signal.aborted) throw new MusicError('cancelled');
      return netease.resolve(ref, quality, signal);
    }
    const lxSource = lx.ready();
    return lxSource.source.resolve(lxSource.catalog.get(ref), quality, signal, exclude);
  }

  const stream = startMusicStream({ resolve, trustedOrigin: lx.origin, book: lxOptions.book });

  /** 更新网易云设置并作废音频流与曲目缓存 */
  async function change(patch: Partial<NeteaseSettings>): Promise<MusicStatus> {
    await settings.update(patch);
    stream.clear();
    store.expire();
    return status();
  }

  async function run(
    action: (typeof MUSIC_ACTIONS)[number],
    body: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (signal.aborted) throw new MusicError('cancelled');
    if (isLxSourceAction(action)) {
      return health.attach(await sources().run(action, body, signal));
    }
    switch (action) {
      case 'status':
        empty(body);
        return status();
      case 'search':
        return search(searchRequest(body), signal);
      case 'tracks':
        return tracks(tracksRequest(body), signal);
      case 'list':
        return list(listRequest(body), signal);
      case 'artist-albums':
        return artistAlbums(artistAlbumsRequest(body), signal);
      case 'resolve': {
        const input = resolveRequest(body);
        return resolve(input.ref, input.quality, signal);
      }
      case 'failures': {
        const after = single(body, 'after');
        if (typeof after !== 'number' || !Number.isSafeInteger(after) || after < 0)
          throw new MusicError('invalid-request');
        return stream.failures(after);
      }
      case 'login-start':
        empty(body);
        return (await neteaseSource()).loginStart(signal);
      case 'login-check': {
        const key = single(body, 'key');
        if (typeof key !== 'string' || !key.trim() || key.length > 256)
          throw new MusicError('invalid-request');
        const result = await (await neteaseSource()).loginCheck(key, signal);
        if (result.state === 'signed-in')
          await change({ cookie: result.cookie, nickname: result.nickname });
        return { state: result.state };
      }
      case 'logout':
        empty(body);
        return change({ cookie: null, nickname: null });
      case 'unblock': {
        const enabled = single(body, 'enabled');
        if (typeof enabled !== 'boolean') throw new MusicError('invalid-request');
        return change({ unblock: enabled });
      }
      case 'lx':
        await lx.configure(lxConfigRequest(body));
        // 服务端配置变更时清空现有流地址缓存
        stream.clear();
        lxOptions.book.clear();
        return status();
      case 'lx-test':
        empty(body);
        return { auth: await lx.test(signal) };
      case 'ncm':
        empty(body);
        return (
          component?.state() ?? {
            package: null,
            phase: ncm === 'missing' ? 'missing' : 'installed',
            received: 0,
            failure: null,
          }
        );
      case 'ncm-install':
        empty(body);
        if (!component?.state().package) throw new MusicError('unsupported');
        component.install();
        return component.state();
      case 'lx-component':
        empty(body);
        return (
          lxComponent?.state() ?? {
            package: null,
            phase: host?.installed() ? 'installed' : 'missing',
            received: 0,
            failure: null,
          }
        );
      case 'lx-install':
        empty(body);
        if (!lxComponent?.state().package) throw new MusicError('unsupported');
        lxComponent.install();
        return lxComponent.state();
      case 'lx-source-check': {
        const input = lxSourceCheckRequest(body);
        return health.check(input.id, input.platform, signal);
      }
    }
  }

  return {
    async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
      const client = new AbortController();
      const stop = () => client.abort();
      request.once('aborted', stop);
      response.once('close', stop);
      const signal = AbortSignal.any([lifetime.signal, client.signal]);
      try {
        const action = MUSIC_ACTIONS.find((item) => request.url === `/music/${item}`);
        if (!action) throw new MusicError('invalid-request');
        // 导入音源时根据脚本体积上限动态放宽请求体大小限制
        const limit =
          action === 'lx-source-add' ? 2 * MAX_SCRIPT_BYTES + MAX_BODY_BYTES : MAX_BODY_BYTES;
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
          size += bytes.length;
          if (size > limit) throw new MusicError('invalid-request');
          chunks.push(bytes);
        }
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          throw new MusicError('invalid-request');
        }
        const data = await run(action, body, signal);
        if (signal.aborted) throw new MusicError('cancelled');
        respond(response, 200, { protocol: MUSIC_PROTOCOL, success: true, data });
      } catch (error) {
        const failure =
          error instanceof MusicError ? error : new MusicError('upstream-unavailable');
        const code = failure.code;
        respond(response, HTTP_STATUS[code] ?? 503, {
          protocol: MUSIC_PROTOCOL,
          success: false,
          error: { code, message: failure.message },
        });
      } finally {
        request.off('aborted', stop);
        response.off('close', stop);
      }
    },
    /** 处理宿主请求的音频流转发路由 */
    stream: stream.handle,
    async dispose(): Promise<void> {
      lifetime.abort();
      store.close();
      stream.dispose();
      component?.dispose();
      lxComponent?.dispose();
      await lx.dispose();
      await host?.dispose();
    },
  };
}
