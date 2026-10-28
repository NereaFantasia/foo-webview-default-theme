import { serviceKey } from '../kit/serviceKey.ts';
import {
  BackendRequestError,
  type BackendConnection,
  type BackendRequestOptions,
} from '../server/backendConnection.ts';
import {
  readMusicArtistAlbums,
  type MusicArtistAlbumsRequest,
} from '../server/musicArtistAlbums.ts';
import {
  readMusicLxHealth,
  readMusicLxSources,
  type MusicLxHealth,
  type MusicLxSource,
} from '../server/musicLxSources.ts';
import {
  readMusicListResult,
  readMusicLoginCode,
  readMusicLxAuth,
  readMusicLoginState,
  readMusicReply,
  readMusicResource,
  readMusicSearchResult,
  readMusicStatus,
  readMusicStreamFailures,
  readMusicTracks,
  type MusicFailureCode,
  type MusicListKind,
  type MusicListRequest,
  type MusicListResult,
  type MusicLoginCode,
  type MusicLoginState,
  type MusicLxAuth,
  type MusicLxConfigRequest,
  type MusicResolveRequest,
  type MusicResource,
  type MusicSearchKind,
  type MusicSearchRequest,
  type MusicSearchResult,
  type MusicStatus,
  type MusicStreamFailures,
  type MusicTracksRequest,
} from '../server/musicProtocol.ts';
import { type MusicPlatform, type MusicTrack, type MusicRef } from '../server/musicObjects.ts';
import { readNcmComponentState, type NcmComponentState } from '../server/ncmComponent.ts';

export type MusicClientFailureCode = MusicFailureCode | 'backend-unavailable' | 'invalid-response';

/** 封装客户端错误码供界面呈现友好提示，避免直接暴露网络异常与服务端原始报错 */
export class MusicClientError extends Error {
  constructor(readonly code: MusicClientFailureCode) {
    super('音乐请求失败');
  }
}

export interface MusicClient {
  status(options?: BackendRequestOptions): Promise<MusicStatus>;
  ncm(options?: BackendRequestOptions): Promise<NcmComponentState>;
  /** 在后台启动网易云原生组件的安装并返回初始状态；后续进度通过 `ncm` 查询 */
  installNcm(options?: BackendRequestOptions): Promise<NcmComponentState>;
  search<K extends MusicSearchKind>(
    input: MusicSearchRequest & { readonly kind: K },
    options?: BackendRequestOptions,
  ): Promise<MusicSearchResult<K>>;
  resolve(input: MusicResolveRequest, options?: BackendRequestOptions): Promise<MusicResource>;
  tracks(input: MusicTracksRequest, options?: BackendRequestOptions): Promise<MusicTrack[]>;
  /** 获取指定集合（专辑/歌单完整曲目或艺人热门曲目）及列表元数据 */
  list<K extends MusicListKind>(
    input: MusicListRequest & { readonly kind: K },
    options?: BackendRequestOptions,
  ): Promise<MusicListResult<K>>;
  /** 艺人的专辑，新到旧，一页最多 `MUSIC_ARTIST_ALBUMS_LIMIT` 张；只有网易云提供 */
  artistAlbums(
    input: MusicArtistAlbumsRequest,
    options?: BackendRequestOptions,
  ): Promise<MusicSearchResult<'album'>>;
  /** 查询序号大于 `after` 的音频流路由失败记录；`after` 传入上一轮响应中的 `latest` 标识 */
  failures(after: number, options?: BackendRequestOptions): Promise<MusicStreamFailures>;
  /** 网易云扫码登录流程：获取登录二维码凭证，随后根据 `key` 轮询扫码状态直至成功或超时过期 */
  loginStart(options?: BackendRequestOptions): Promise<MusicLoginCode>;
  loginCheck(key: string, options?: BackendRequestOptions): Promise<MusicLoginState>;
  logout(options?: BackendRequestOptions): Promise<MusicStatus>;
  setUnblock(enabled: boolean, options?: BackendRequestOptions): Promise<MusicStatus>;
  configureLx(input: MusicLxConfigRequest, options?: BackendRequestOptions): Promise<MusicStatus>;
  /** 校验并测试已保存的 lxserver 远端连接 */
  testLx(options?: BackendRequestOptions): Promise<MusicLxAuth>;
  /** 获取托管 lxserver 组件的安装与运行状态（契约与网易云组件一致） */
  lxComponent(options?: BackendRequestOptions): Promise<NcmComponentState>;
  installLx(options?: BackendRequestOptions): Promise<NcmComponentState>;
  /** 获取托管 lxserver 当前配置的音源列表；增删改序后均返回更新后的完整列表 */
  lxSources(options?: BackendRequestOptions): Promise<MusicLxSource[]>;
  /** 添加 lxserver 音源脚本：支持本地传入文件名与脚本内容，或传入远端 URL 由后端获取 */
  addLxSource(
    input: { readonly name: string; readonly script: string } | { readonly url: string },
    options?: BackendRequestOptions,
  ): Promise<MusicLxSource[]>;
  toggleLxSource(
    id: string,
    enabled: boolean,
    options?: BackendRequestOptions,
  ): Promise<MusicLxSource[]>;
  removeLxSource(id: string, options?: BackendRequestOptions): Promise<MusicLxSource[]>;
  orderLxSources(ids: readonly string[], options?: BackendRequestOptions): Promise<MusicLxSource[]>;
  /**
   * 检测一个音源在一个平台上能不能用，要真去取地址并打开，一次可能要十几秒；
   * 只答这一项的结果，列表里的 `health` 在下次读列表时带上
   */
  checkLxSource(
    id: string,
    platform: MusicPlatform,
    options?: BackendRequestOptions,
  ): Promise<MusicLxHealth>;
  dispose(): void;
}

function sameRef(left: MusicRef, right: MusicRef): boolean {
  return left.platform === right.platform && left.id === right.id;
}

/**
 * 客户端请求彼此独立；输入变更时由调用方主动中断先前请求信号，客户端在结果返回前再次核验取消态
 * 释放时仅终止在途音乐请求，后端长连接生命周期仍由创建方统一托管
 */
export function startMusicClient(connection: Pick<BackendConnection, 'request'>): MusicClient {
  const lifetime = new AbortController();
  async function request<T>(
    path: string,
    input: unknown,
    read: (data: unknown) => T | null,
    options: BackendRequestOptions = {},
  ): Promise<T> {
    const timeoutMs = options.timeoutMs ?? 35000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)
      throw new MusicClientError('invalid-request');
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([
      lifetime.signal,
      timeout,
      ...(options.signal ? [options.signal] : []),
    ]);
    try {
      signal.throwIfAborted();
      let value: unknown;
      try {
        value = await connection.request(path, input, { signal, timeoutMs });
      } catch (error) {
        if (!(error instanceof BackendRequestError)) throw error;
        signal.throwIfAborted();
        if (error.body === null || error.status === 403)
          throw new MusicClientError('backend-unavailable');
        const failure = readMusicReply(error.body, read);
        if (!failure || failure.success) throw new MusicClientError('invalid-response');
        throw new MusicClientError(failure.error.code);
      }
      signal.throwIfAborted();
      const reply = readMusicReply(value, read);
      if (!reply) throw new MusicClientError('invalid-response');
      if (!reply.success) throw new MusicClientError(reply.error.code);
      return reply.data;
    } catch (error) {
      if (lifetime.signal.aborted || options.signal?.aborted)
        throw new MusicClientError('cancelled');
      if (timeout.aborted || (error instanceof Error && error.name === 'TimeoutError'))
        throw new MusicClientError('timeout');
      if (error instanceof MusicClientError) throw error;
      throw new MusicClientError(
        error instanceof SyntaxError ? 'invalid-response' : 'backend-unavailable',
      );
    }
  }
  return {
    status: (options) => request('/music/status', {}, readMusicStatus, options),
    ncm: (options) => request('/music/ncm', {}, readNcmComponentState, options),
    installNcm: (options) => request('/music/ncm-install', {}, readNcmComponentState, options),
    search(input, options) {
      const expected = {
        platform: input.platform,
        kind: input.kind,
        query: input.query,
        cursor: input.cursor,
      };
      return request(
        '/music/search',
        expected,
        (data) => {
          const result = readMusicSearchResult(data, input.kind);
          return !result || result.items.some((item) => item.ref.platform !== expected.platform)
            ? null
            : result;
        },
        options,
      );
    },
    resolve(input, options) {
      const expected = { ref: { ...input.ref }, quality: input.quality };
      return request(
        '/music/resolve',
        expected,
        (data) => {
          const resource = readMusicResource(data);
          return resource &&
            sameRef(resource.ref, expected.ref) &&
            resource.requestedQuality === expected.quality
            ? resource
            : null;
        },
        options,
      );
    },
    tracks(input, options) {
      const expected = { platform: input.platform, ids: [...input.ids] };
      return request(
        '/music/tracks',
        expected,
        (data) => {
          const items = readMusicTracks(data);
          // 每条都要是请求过的 ID，且只出现一次
          const pending = new Set(expected.ids);
          return items?.every(
            (track) => track.ref.platform === expected.platform && pending.delete(track.ref.id),
          )
            ? items
            : null;
        },
        options,
      );
    },
    list(input, options) {
      const expected = { kind: input.kind, ref: { ...input.ref }, cursor: input.cursor };
      return request(
        '/music/list',
        expected,
        (data) => {
          const result = readMusicListResult(data, input.kind);
          return result &&
            sameRef(result.owner.ref, expected.ref) &&
            result.items.every((track) => track.ref.platform === expected.ref.platform)
            ? result
            : null;
        },
        options,
      );
    },
    artistAlbums(input, options) {
      const expected = { ref: { ...input.ref }, cursor: input.cursor };
      return request(
        '/music/artist-albums',
        expected,
        (data) => {
          const result = readMusicArtistAlbums(data);
          return result?.items.every((album) => album.ref.platform === expected.ref.platform)
            ? result
            : null;
        },
        options,
      );
    },
    failures(after, options) {
      return request(
        '/music/failures',
        { after },
        (data) => {
          const result = readMusicStreamFailures(data);
          return result && [...result.items, ...result.sources].every((item) => item.seq > after)
            ? result
            : null;
        },
        options,
      );
    },
    loginStart: (options) => request('/music/login-start', {}, readMusicLoginCode, options),
    loginCheck: (key, options) =>
      request('/music/login-check', { key }, readMusicLoginState, options),
    logout: (options) =>
      request(
        '/music/logout',
        {},
        (data) => {
          const status = readMusicStatus(data);
          return status?.account === null ? status : null;
        },
        options,
      ),
    setUnblock: (enabled, options) =>
      request(
        '/music/unblock',
        { enabled },
        (data) => {
          const status = readMusicStatus(data);
          return status?.unblock === enabled ? status : null;
        },
        options,
      ),
    configureLx(input, options) {
      const removing = input.url === null;
      return request(
        '/music/lx',
        input.url === null
          ? { url: null }
          : {
              url: input.url,
              username: input.username,
              ...(input.userToken === undefined ? {} : { userToken: input.userToken }),
            },
        (data) => {
          const status = readMusicStatus(data);
          // 地址会被补上结尾的斜杠，只核对删除后确实没有配置
          return status && (!removing || status.lxServer === null) ? status : null;
        },
        options,
      );
    },
    testLx: (options) => request('/music/lx-test', {}, readMusicLxAuth, options),
    lxComponent: (options) => request('/music/lx-component', {}, readNcmComponentState, options),
    installLx: (options) => request('/music/lx-install', {}, readNcmComponentState, options),
    lxSources: (options) => request('/music/lx-sources', {}, readMusicLxSources, options),
    addLxSource: (input, options) =>
      request('/music/lx-source-add', input, readMusicLxSources, options),
    toggleLxSource: (id, enabled, options) =>
      request('/music/lx-source-toggle', { id, enabled }, readMusicLxSources, options),
    removeLxSource: (id, options) =>
      request('/music/lx-source-delete', { id }, readMusicLxSources, options),
    orderLxSources: (ids, options) =>
      request('/music/lx-source-order', { ids }, readMusicLxSources, options),
    checkLxSource: (id, platform, options) =>
      request('/music/lx-source-check', { id, platform }, readMusicLxHealth, options),
    dispose() {
      lifetime.abort();
    },
  };
}

export const musicClientKey = serviceKey<MusicClient>('musicClient');
