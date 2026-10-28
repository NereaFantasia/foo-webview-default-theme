import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { dirname, join } from 'node:path';
import {
  MUSIC_ARTIST_ALBUMS_LIMIT,
  type MusicArtistAlbumsRequest,
} from '../../src/server/musicArtistAlbums.ts';
import {
  MUSIC_LIST_LIMIT,
  type MusicListRequest,
  type MusicListResult,
  type MusicLoginCode,
  type MusicLoginState,
  type MusicResource,
  type MusicSearchKind,
  type MusicSearchRequest,
  type MusicSearchResult,
} from '../../src/server/musicProtocol.ts';
import {
  MUSIC_QUALITIES,
  type MusicQuality,
  type MusicRef,
  type MusicTrack,
} from '../../src/server/musicObjects.ts';
import { isRecord } from './lxSource.ts';
import { MusicError } from './musicError.ts';
import {
  NCM_PAGE_SIZE,
  NCM_SEARCH,
  ncmText,
  readNcmAlbumList,
  readNcmArtistAlbums,
  readNcmArtistList,
  readNcmPlaylistDetail,
  readNcmSearchPage,
  readNcmTracks,
  readNcmTracksInOrder,
  readNcmUrl,
} from './ncmRecords.ts';
import type { NeteaseSettings } from './neteaseSettings.ts';

const NCM_PACKAGE = '@neteasecloudmusicapienhanced/api';

/** 只列用到的接口；NCM 的每个接口都收一个参数对象，成功时以 `{ body }` 兑现 */
export interface NcmApi {
  readonly cloudsearch: (query: Record<string, unknown>) => Promise<unknown>;
  readonly song_url_v1: (query: Record<string, unknown>) => Promise<unknown>;
  readonly song_detail: (query: Record<string, unknown>) => Promise<unknown>;
  readonly album: (query: Record<string, unknown>) => Promise<unknown>;
  readonly artists: (query: Record<string, unknown>) => Promise<unknown>;
  readonly artist_album: (query: Record<string, unknown>) => Promise<unknown>;
  readonly playlist_detail: (query: Record<string, unknown>) => Promise<unknown>;
  readonly login_qr_key: (query: Record<string, unknown>) => Promise<unknown>;
  readonly login_qr_create: (query: Record<string, unknown>) => Promise<unknown>;
  readonly login_qr_check: (query: Record<string, unknown>) => Promise<unknown>;
  readonly login_status: (query: Record<string, unknown>) => Promise<unknown>;
}

export interface NcmLoader {
  installed(): boolean;
  /** 装载网易云 API 模块并初始化匿名凭据与公钥 */
  load(): Promise<NcmApi>;
}

function method(module: Record<string, unknown>, name: string) {
  const fn = module[name];
  if (typeof fn !== 'function') throw new Error(`NCM 缺少接口 ${name}`);
  return (query: Record<string, unknown>): Promise<unknown> => Promise.resolve(fn(query));
}

/**
 * 构造网易云组件加载器；
 * 模块装载期间临时重定向 `os.tmpdir` 至主题私有目录，确保匿名身份与公钥文件隔离存储
 */
export function ncmLoader(directory: string, temporary: string): NcmLoader {
  const requireNcm = createRequire(join(directory, 'package.json'));
  return {
    installed() {
      try {
        requireNcm.resolve(NCM_PACKAGE);
        return true;
      } catch {
        return false;
      }
    },
    async load() {
      mkdirSync(temporary, { recursive: true });
      const original = os.tmpdir;
      os.tmpdir = () => temporary;
      let module: unknown;
      let prepare: unknown;
      try {
        const entry = requireNcm.resolve(NCM_PACKAGE);
        module = requireNcm(entry);
        // 提前装载网络请求模块，确保其缓存路径落在隔离的临时目录内
        requireNcm(join(dirname(entry), 'util', 'request.js'));
        prepare = requireNcm(join(dirname(entry), 'generateConfig.js'));
      } finally {
        os.tmpdir = original;
      }
      if (!isRecord(module) || typeof prepare !== 'function') throw new Error('NCM 入口无效');
      await prepare();
      if (!existsSync(join(temporary, 'xeapi_public_key'))) throw new Error('NCM 未取得公钥');
      return {
        cloudsearch: method(module, 'cloudsearch'),
        song_url_v1: method(module, 'song_url_v1'),
        song_detail: method(module, 'song_detail'),
        album: method(module, 'album'),
        artists: method(module, 'artists'),
        artist_album: method(module, 'artist_album'),
        playlist_detail: method(module, 'playlist_detail'),
        login_qr_key: method(module, 'login_qr_key'),
        login_qr_create: method(module, 'login_qr_create'),
        login_qr_check: method(module, 'login_qr_check'),
        login_status: method(module, 'login_status'),
      };
    },
  };
}

// 内部标准音质到网易云 API 档位标识的映射
const REQUEST_LEVELS: Readonly<Record<MusicQuality, string>> = {
  '128k': 'standard',
  '320k': 'exhigh',
  flac: 'lossless',
  flac24bit: 'hires',
};

/** 上游限流与人机验证状态码 */
const THROTTLED = new Set<unknown>([405, 406, -460, -462]);
/** 元数据请求限流冷却时间（毫秒）；解析播放地址与登录验证不在此限 */
const COOLDOWN_MS = 60_000;
const METADATA = new Set<keyof NcmApi>([
  'cloudsearch',
  'song_detail',
  'album',
  'artists',
  'artist_album',
  'playlist_detail',
]);

const LOGIN_STATES = new Map<unknown, MusicLoginState>([
  [800, 'expired'],
  [801, 'waiting'],
  [802, 'scanned'],
  [803, 'signed-in'],
]);
const MAX_COOKIE = 16384;

export interface NcmSourceOptions {
  readonly timeoutMs?: number;
  /** 动态读取设置，避免凭据或解灰开关变更时重建实例 */
  readonly settings?: () => Pick<NeteaseSettings, 'cookie' | 'unblock'>;
}

export function startNcmSource(api: NcmApi, options: NcmSourceOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 15000;
  let cooledUntil = 0;
  /** 封装上游 API 调用；统一超时控制、冷却限流与异常映射 */
  async function call(
    name: keyof NcmApi,
    query: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (METADATA.has(name) && Date.now() < cooledUntil) throw new MusicError('rate-limited');
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    if (combined.aborted) throw new MusicError(signal.aborted ? 'cancelled' : 'timeout');
    let stop = () => {};
    const abandoned = new Promise<never>((_resolve, reject) => {
      stop = () => reject(new MusicError(signal.aborted ? 'cancelled' : 'timeout'));
      combined.addEventListener('abort', stop, { once: true });
    });
    try {
      const answer = await Promise.race([api[name]({ ...query, timeout: timeoutMs }), abandoned]);
      if (!isRecord(answer) || !isRecord(answer.body)) throw new MusicError('invalid-upstream');
      return answer.body;
    } catch (error) {
      if (error instanceof MusicError) throw error;
      // 归一化上游业务错误码为内部领域异常
      const code = isRecord(error) && isRecord(error.body) ? error.body.code : undefined;
      if (THROTTLED.has(code)) {
        cooledUntil = Date.now() + COOLDOWN_MS;
        throw new MusicError('rate-limited');
      }
      throw new MusicError(
        code === 301 ? 'authentication' : code === 404 ? 'not-found' : 'upstream-unavailable',
      );
    } finally {
      combined.removeEventListener('abort', stop);
    }
  }
  /** 解析分页游标对应的偏移量 */
  function offsetOf(cursor: string | null): number {
    const offset = cursor === null ? 0 : Number(cursor);
    if (!/^(0|[1-9]\d*)$/.test(cursor ?? '0') || !Number.isSafeInteger(offset))
      throw new MusicError('invalid-request');
    return offset;
  }
  /** 注入当前已登录账号的凭据 Cookie */
  function signedIn(query: Record<string, unknown>): Record<string, unknown> {
    const cookie = options.settings?.().cookie;
    return cookie ? { ...query, cookie } : query;
  }

  return {
    async search<K extends MusicSearchKind>(
      input: MusicSearchRequest & { readonly kind: K },
      signal: AbortSignal,
    ): Promise<MusicSearchResult<K>> {
      const offset = offsetOf(input.cursor);
      const body = await call(
        'cloudsearch',
        signedIn({
          keywords: input.query,
          type: NCM_SEARCH[input.kind][0],
          limit: NCM_PAGE_SIZE,
          offset,
        }),
        signal,
      );
      return readNcmSearchPage(body, offset, input.kind);
    },
    /** 获取网易云集合（专辑曲目、艺人热门或歌单列表）；歌单支持游标分页 */
    async list(input: MusicListRequest, signal: AbortSignal): Promise<MusicListResult> {
      const offset = offsetOf(input.cursor);
      const id = input.ref.id;
      if (
        input.ref.platform !== 'wy' ||
        !/^[1-9]\d*$/.test(id) ||
        (input.kind !== 'playlist' && input.cursor !== null)
      )
        throw new MusicError('invalid-request');
      if (input.kind === 'album')
        return readNcmAlbumList(await call('album', signedIn({ id }), signal));
      if (input.kind === 'artist')
        return readNcmArtistList(await call('artists', signedIn({ id }), signal));
      const { owner, ids, first } = readNcmPlaylistDetail(
        await call('playlist_detail', signedIn({ id }), signal),
      );
      let page = offset === 0 ? first : null;
      if (!page) {
        const slice = ids.slice(offset, offset + MUSIC_LIST_LIMIT);
        const body = slice.length
          ? await call('song_detail', signedIn({ ids: slice.join(',') }), signal)
          : { songs: [], privileges: [] };
        page = { ...readNcmTracksInOrder(body, slice), taken: slice.length };
      }
      const { taken, ...tracks } = page;
      const next = offset + taken;
      return {
        ...tracks,
        nextCursor: next < ids.length ? String(next) : null,
        total: ids.length,
        owner,
      };
    },
    /** 获取艺人名下专辑列表，支持游标分页 */
    async artistAlbums(
      input: MusicArtistAlbumsRequest,
      signal: AbortSignal,
    ): Promise<MusicSearchResult<'album'>> {
      const offset = offsetOf(input.cursor);
      const id = input.ref.id;
      if (input.ref.platform !== 'wy' || !/^[1-9]\d*$/.test(id))
        throw new MusicError('invalid-request');
      const body = await call(
        'artist_album',
        signedIn({ id, limit: MUSIC_ARTIST_ALBUMS_LIMIT, offset }),
        signal,
      );
      return readNcmArtistAlbums(body, offset);
    },
    /** 批量获取曲目详情，忽略已下架或无效的曲目 */
    async tracks(ids: readonly string[], signal: AbortSignal): Promise<MusicTrack[]> {
      if (ids.some((id) => !/^[1-9]\d*$/.test(id))) throw new MusicError('invalid-request');
      const body = await call('song_detail', signedIn({ ids: ids.join(',') }), signal);
      return readNcmTracks(body.songs, body.privileges).items.filter((track) =>
        ids.includes(track.ref.id),
      );
    },
    async resolve(
      ref: MusicRef,
      quality: MusicQuality,
      signal: AbortSignal,
    ): Promise<MusicResource> {
      if (ref.platform !== 'wy' || !/^[1-9]\d*$/.test(ref.id))
        throw new MusicError('invalid-request');
      const query = { id: ref.id, level: REQUEST_LEVELS[quality] };
      try {
        const { url, level } = readNcmUrl(
          await call('song_url_v1', signedIn(query), signal),
          ref.id,
        );
        const actual = MUSIC_QUALITIES.find((item) => REQUEST_LEVELS[item] === level);
        return {
          ref,
          url,
          requestedQuality: quality,
          actualQuality: actual ?? null,
          expiresAt: null,
          unblocked: false,
        };
      } catch (error) {
        // 播放受限（会员试听或无版权）且开启解灰时，尝试通过解灰代理重新解析完整音源
        const missing = (failure: unknown) =>
          failure instanceof MusicError &&
          ['membership-required', 'unplayable'].includes(failure.code);
        if (!missing(error) || !options.settings?.().unblock) throw error;
        const body = await call('song_url_v1', signedIn({ ...query, unblock: 'true' }), signal);
        try {
          const { url } = readNcmUrl(body, ref.id);
          return {
            ref,
            url,
            requestedQuality: quality,
            actualQuality: null,
            expiresAt: null,
            unblocked: true,
          };
        } catch (failure) {
          throw missing(failure) ? new MusicError('unblock-missing') : failure;
        }
      }
    },
    /** 申请扫码登录的 key 并生成二维码图片 */
    async loginStart(signal: AbortSignal): Promise<MusicLoginCode> {
      const keyBody = await call('login_qr_key', {}, signal);
      const key = isRecord(keyBody.data) ? ncmText(keyBody.data.unikey) : null;
      if (!key || key.length > 256) throw new MusicError('invalid-upstream');
      const created = await call('login_qr_create', { key, qrimg: true, platform: 'web' }, signal);
      const image = isRecord(created.data) ? created.data.qrimg : null;
      if (typeof image !== 'string' || !image.startsWith('data:image/png;base64,'))
        throw new MusicError('invalid-upstream');
      return { key, image };
    },
    /** 轮询扫码登录状态并在成功时提取账号凭据与昵称 */
    async loginCheck(key: string, signal: AbortSignal) {
      const body = await call('login_qr_check', { key }, signal);
      const state = LOGIN_STATES.get(body.code);
      if (!state) throw new MusicError('upstream-unavailable');
      if (state !== 'signed-in') return { state, cookie: null, nickname: null };
      const cookie = body.cookie;
      if (typeof cookie !== 'string' || !cookie.includes('MUSIC_U=') || cookie.length > MAX_COOKIE)
        throw new MusicError('invalid-upstream');
      const account = await call('login_status', { cookie }, signal).catch(() => null);
      const data = account && isRecord(account.data) ? account.data : null;
      const nickname = data && isRecord(data.profile) ? ncmText(data.profile.nickname) : null;
      return { state, cookie, nickname };
    },
  };
}
