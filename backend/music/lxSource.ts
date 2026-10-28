import {
  type MusicFailureCode,
  type MusicResource,
  type MusicSearchRequest,
  type MusicSearchResult,
} from '../../src/server/musicProtocol.ts';
import {
  MUSIC_PLATFORMS,
  MUSIC_QUALITIES,
  type MusicPlatform,
  type MusicQuality,
  type MusicTrack,
} from '../../src/server/musicObjects.ts';
import type { LxSourceBook } from './lxSourceBook.ts';
import { MusicError } from './musicError.ts';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RECORD_BYTES = 8192;
const PAGE_SIZE = 20;

/** lxserver 负责的音源平台清单（排除网易云，网易云独占走 NCM 适配器） */
export const LX_PLATFORMS: readonly MusicPlatform[] = MUSIC_PLATFORMS.filter(
  (platform) => platform !== 'wy',
);

export interface LxSourceConfig {
  readonly schema: 1;
  readonly url: string;
  readonly username?: string;
  readonly userToken?: string;
  readonly playerSession?: string;
  /** 管理认证密码，用于音源脚本动态管理接口；仅在托管模式下存在且不持久化 */
  readonly adminPassword?: string;
}

export interface LxTrackRecord {
  readonly track: MusicTrack;
  readonly song: Record<string, unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isMusicPlatform(value: unknown): value is MusicPlatform {
  return MUSIC_PLATFORMS.some((platform) => platform === value);
}

export function isMusicQuality(value: unknown): value is MusicQuality {
  return MUSIC_QUALITIES.some((quality) => quality === value);
}

/** 第三方脚本写的失败原因：合并空白与控制字符，截到 200 字；不是字符串或是空的为 null */
export function cleanMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return (
    value
      .replace(/[\p{Cc}\s]+/gu, ' ')
      .trim()
      .slice(0, 200)
      .trim() || null
  );
}

function text(value: unknown, limit = 2048): string | null {
  return typeof value === 'string' && value.trim() && value.length <= limit ? value.trim() : null;
}

function identifier(value: unknown): string | null {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  return text(value, 256);
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.href.length <= 2048
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function readLxConfig(value: unknown): LxSourceConfig | null {
  if (!isRecord(value) || value.schema !== 1) return null;
  const url = httpUrl(value.url);
  if (!url || new URL(url).search || new URL(url).hash) return null;
  for (const key of ['username', 'userToken', 'playerSession']) {
    const field = value[key];
    if (field !== undefined && (typeof field !== 'string' || !/^[\x21-\x7E]{1,4096}$/.test(field)))
      return null;
  }
  if (typeof value.playerSession === 'string' && /[;,]/.test(value.playerSession)) return null;
  if ((value.username === undefined) !== (value.userToken === undefined)) return null;
  return {
    schema: 1,
    url: url.endsWith('/') ? url : `${url}/`,
    ...(typeof value.username === 'string' ? { username: value.username } : {}),
    ...(typeof value.userToken === 'string' ? { userToken: value.userToken } : {}),
    ...(typeof value.playerSession === 'string' ? { playerSession: value.playerSession } : {}),
  };
}

function seconds(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{1,4}:[0-5]\d(?::[0-5]\d)?$/.test(value)) return null;
  return value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

export function readLxTrack(value: unknown, platform: MusicPlatform): LxTrackRecord | null {
  if (!isRecord(value)) return null;
  const meta = isRecord(value.meta) ? value.meta : {};
  const source = value.source ?? meta.source ?? platform;
  if (source !== platform) return null;
  const song = { ...value, source: platform };
  if (Buffer.byteLength(JSON.stringify(song)) > MAX_RECORD_BYTES) return null;
  const primaryId = identifier(value.songmid) ?? identifier(meta.songId);
  const storedId = identifier(value.id);
  const id =
    primaryId ??
    (storedId?.startsWith(`${platform}_`) ? storedId.slice(platform.length + 1) : storedId);
  const title = text(value.name) ?? text(meta.name);
  if (!id || !title) return null;
  const types = value.types ?? meta.qualitys ?? meta.types;
  // 将 hires 映射为系统标准高解析度无损档位 flac24bit
  const offered = (Array.isArray(types) ? types : [])
    .map((item: unknown) => (isRecord(item) ? item.type : item))
    .map((type: unknown) => (type === 'hires' ? 'flac24bit' : type));
  const albumTitle = text(value.albumName) ?? text(meta.albumName);
  const duration = seconds(value.interval ?? meta.interval);
  return {
    track: {
      ref: { platform, id },
      title,
      subtitle: null,
      // 解析分隔符拼接的展示名称；无独立 ID 时保留纯文本信息
      artists: (text(value.singer) ?? text(meta.singer) ?? '')
        .split('、')
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ ref: null, name })),
      album: albumTitle ? { ref: null, title: albumTitle } : null,
      durationMs: duration === null ? null : duration * 1000,
      artwork: httpUrl(value.img) ?? httpUrl(meta.picUrl),
      qualities: MUSIC_QUALITIES.filter((quality) => offered.includes(quality)),
      access: null,
    },
    // 保留上游原始曲目载荷供播放解析脚本提取音质哈希与鉴权参数
    song,
  };
}

export interface LxSourceOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /** 取地址时先排除簿子里记着不行的音源，并把这一轮失败的音源记进去 */
  readonly book?: LxSourceBook;
}

async function readBody(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new MusicError('invalid-upstream');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/**
 * 向 lxserver 发起 HTTP 请求并解析 JSON 响应
 *
 * 自动注入认证头与 lx_player_session Cookie；拦截 401/403 映射为 authentication 错误，
 * 校验响应体大小防止超限内存消耗
 */
export function lxRequest(config: LxSourceConfig, options: LxSourceOptions = {}) {
  const send = options.fetch ?? fetch;
  return async function request(
    path: string,
    signal: AbortSignal,
    body?: unknown,
    failure: MusicFailureCode = 'upstream-unavailable',
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 30000);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      combined.throwIfAborted();
      const response = await send(new URL(path, config.url), {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(config.username ? { 'x-user-name': config.username } : {}),
          ...(config.userToken ? { 'x-user-token': config.userToken } : {}),
          ...(config.playerSession ? { Cookie: `lx_player_session=${config.playerSession}` } : {}),
          ...(config.adminPassword ? { 'x-frontend-auth': config.adminPassword } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: combined,
        redirect: 'error',
      });
      if (!response.ok) {
        // 失败应答的正文不对外，只留给调用方读（取地址失败时 lxserver 在里面列出每个音源的结果）
        const detail = response.body
          ? await readBody(response.body, combined)
              .then((bytes): unknown => JSON.parse(bytes.toString('utf8')))
              .catch(() => undefined)
          : undefined;
        throw new MusicError(
          response.status === 401 || response.status === 403 ? 'authentication' : failure,
          detail,
        );
      }
      if (!response.body) throw new MusicError('invalid-upstream');
      const bytes = await readBody(response.body, combined);
      try {
        const value: unknown = JSON.parse(bytes.toString('utf8'));
        return value;
      } catch {
        throw new MusicError('invalid-upstream');
      }
    } catch (error) {
      if (signal.aborted) throw new MusicError('cancelled');
      if (timeout.aborted) throw new MusicError('timeout');
      if (error instanceof MusicError) throw error;
      throw new MusicError('upstream-unavailable');
    }
  };
}

/** `attempts` 是 lxserver 列出的每个音源这一轮的结果，失败的记进簿子 */
function noteFailed(book: LxSourceBook | undefined, platform: MusicPlatform, value: unknown): void {
  const attempts = isRecord(value) ? value.attempts : null;
  if (!book || !Array.isArray(attempts)) return;
  for (const item of attempts)
    if (isRecord(item) && item.status === 'fail' && typeof item.name === 'string')
      book.failed(platform, item.name);
}

export function startLxSource(config: LxSourceConfig, options: LxSourceOptions = {}) {
  const request = lxRequest(config, options);
  return {
    /** 校验当前用户凭据的有效性 */
    async verify(signal: AbortSignal): Promise<boolean> {
      const value = await request('api/user/auth/verify', signal);
      if (!isRecord(value) || typeof value.valid !== 'boolean')
        throw new MusicError('invalid-upstream');
      return value.valid;
    },
    async search(input: MusicSearchRequest, signal: AbortSignal) {
      // 当前音源仅支持单曲检索，其他检索类型显式拒绝
      if (input.kind !== 'track') throw new MusicError('unsupported');
      // 将分页游标解析为服务端 1-based 页码
      const page = input.cursor === null ? 1 : Number(input.cursor);
      if (!/^[1-9]\d*$/.test(input.cursor ?? '1') || !Number.isSafeInteger(page))
        throw new MusicError('invalid-request');
      const query = new URLSearchParams({
        name: input.query,
        source: input.platform,
        type: 'song',
        page: String(page),
        // 兼容不同版本的服务端分页参数，确保仅返回单页数据
        pages: '1',
        limit: String(PAGE_SIZE),
      });
      const value = await request(`api/music/search?${query}`, signal);
      const list = isRecord(value) ? value.list : value;
      if (!Array.isArray(list) || list.length > PAGE_SIZE) throw new MusicError('invalid-upstream');
      const records: LxTrackRecord[] = [];
      const identities = new Set<string>();
      for (const item of list) {
        const record = readLxTrack(item, input.platform);
        if (!record || identities.has(record.track.ref.id)) continue;
        identities.add(record.track.ref.id);
        records.push(record);
      }
      if (list.length && !records.length) throw new MusicError('invalid-upstream');
      const result: MusicSearchResult = {
        items: records.map((record) => record.track),
        nextCursor:
          list.length === PAGE_SIZE && page < Number.MAX_SAFE_INTEGER ? String(page + 1) : null,
        total: null,
        discardedCount: list.length - records.length,
      };
      return { records, result };
    },
    /**
     * 让 lxserver 按先后问各个音源，直到有一个给出地址；脚本抛错的音源由它换下一个。
     * 地址打不开它不知道，由调用方把给出这个地址的音源（`sourceName`）放进 `exclude` 再问
     */
    async resolve(
      record: LxTrackRecord,
      quality: MusicQuality,
      signal: AbortSignal,
      exclude: readonly string[] = [],
      fresh = false,
    ) {
      const { platform } = record.track.ref;
      // 检测要看音源此刻的真实状态，不受簿子里的记录影响，结果也由检测自己记
      const book = fresh ? undefined : options.book;
      const ask = async (
        wanted: MusicQuality,
        skipped: readonly string[],
        remember: boolean,
      ): Promise<unknown> => {
        const excluded = [...new Set([...skipped, ...exclude])];
        const noted = remember ? book : undefined;
        try {
          const value = await request('api/music/url', signal, {
            songInfo: record.song,
            quality: wanted,
            enableAutoSwitchApiSource: true,
            ...(excluded.length ? { excludeApiSources: excluded } : {}),
          });
          noteFailed(noted, platform, value);
          return value;
        } catch (error) {
          if (error instanceof MusicError) noteFailed(noted, platform, error.detail);
          throw error;
        }
      };
      const askAt = async (wanted: MusicQuality, remember: boolean): Promise<unknown> => {
        const skipped = book?.skipped(platform) ?? [];
        try {
          return await ask(wanted, skipped, remember);
        } catch (error) {
          // 候选都在跳过名单里时没有音源可问，去掉名单再问一次
          const retry =
            skipped.length > 0 &&
            error instanceof MusicError &&
            error.code === 'upstream-unavailable';
          if (!retry) throw error;
          return ask(wanted, [], remember);
        }
      };
      // 音源常常只给得出低档位。lxserver 答了所有音源都失败时，按曲目提供的档位逐档降下来再问；
      // 高档位的失败不记进簿子，只有最后一档也失败才说明音源给不出这首
      const steps = [
        quality,
        ...MUSIC_QUALITIES.slice(0, MUSIC_QUALITIES.indexOf(quality))
          .filter((lower) => lower === MUSIC_QUALITIES[0] || record.track.qualities.includes(lower))
          .reverse(),
      ];
      let value: unknown;
      for (const [index, wanted] of steps.entries()) {
        const last = index === steps.length - 1;
        try {
          value = await askAt(wanted, last);
          break;
        } catch (error) {
          if (
            last ||
            !(error instanceof MusicError) ||
            error.code !== 'upstream-unavailable' ||
            error.detail === undefined
          )
            throw error;
        }
      }
      if (!isRecord(value)) throw new MusicError('invalid-upstream');
      if (value.success === false) throw new MusicError('unplayable');
      const url = httpUrl(value.url);
      if (!url) throw new MusicError('unplayable');
      const sourceName = text(value.sourceName, 512);
      const resource: MusicResource = {
        ref: record.track.ref,
        url,
        requestedQuality: quality,
        actualQuality: isMusicQuality(value.type) ? value.type : null,
        expiresAt: null,
        unblocked: false,
        ...(sourceName ? { sourceName } : {}),
      };
      return resource;
    },
  };
}
