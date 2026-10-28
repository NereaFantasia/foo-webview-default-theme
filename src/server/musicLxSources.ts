import {
  isInteger,
  isNullableText,
  isRecord,
  isText,
  MUSIC_PLATFORMS,
  type MusicPlatform,
} from './musicObjects.ts';

export const MUSIC_LX_HEALTH_STATUSES = ['ok', 'failed', 'unknown'] as const;
/** 脚本未给出播放地址为 script，给出地址但连接失败为 unreachable，缺少可用样本曲目为 no-sample */
export const MUSIC_LX_HEALTH_REASONS = ['no-sample', 'script', 'unreachable', 'timeout'] as const;

/** 音源在指定平台上的最近一次可用性检测结果 */
export interface MusicLxHealth {
  /** unknown 表示未能完成检测，不代表音源故障 */
  readonly status: (typeof MUSIC_LX_HEALTH_STATUSES)[number];
  /** 检测通过时为 null */
  readonly reason: (typeof MUSIC_LX_HEALTH_REASONS)[number] | null;
  /** 上游返回的错误详情，最长 200 字符；无详情时为 null */
  readonly message: string | null;
  /** 自发起解析到连通性确认耗时，单位毫秒 */
  readonly ms: number;
  /** 检测完成的时间戳，Unix 毫秒 */
  readonly at: number;
}

export function readMusicLxHealth(value: unknown): MusicLxHealth | null {
  if (!isRecord(value)) return null;
  const status = MUSIC_LX_HEALTH_STATUSES.find((item) => item === value.status);
  const reason =
    value.reason === null ? null : MUSIC_LX_HEALTH_REASONS.find((item) => item === value.reason);
  if (
    !status ||
    reason === undefined ||
    (status === 'ok') !== (reason === null) ||
    !(value.message === null || isText(value.message, 200)) ||
    !isInteger(value.ms) ||
    !isInteger(value.at)
  )
    return null;
  return { status, reason, message: value.message, ms: value.ms, at: value.at };
}

/** 托管 lxserver 中已导入的音源脚本 */
export interface MusicLxSource {
  /** lxserver 根据脚本名称生成的唯一标识 */
  readonly id: string;
  readonly name: string;
  readonly version: string | null;
  readonly author: string | null;
  readonly description: string | null;
  /** 脚本支持且由 lxserver 代理的平台；网易云专走 NCM，不在此列 */
  readonly platforms: readonly MusicPlatform[];
  readonly enabled: boolean;
  /** 已启用但初始化或加载失败 */
  readonly failed: boolean;
  /** 加载失败时脚本或 lxserver 记录的原因，最长 200 字符；无原因时为 null */
  readonly error: string | null;
  /** 各平台最近一次可用性检测结果，未检测的平台无对应字段；后端重启后重置 */
  readonly health: Readonly<Partial<Record<MusicPlatform, MusicLxHealth>>>;
}

function readLxSource(value: unknown): MusicLxSource | null {
  if (
    !isRecord(value) ||
    !isText(value.id, 256) ||
    !isText(value.name, 512) ||
    !isNullableText(value.version) ||
    !isNullableText(value.author) ||
    !isNullableText(value.description) ||
    !Array.isArray(value.platforms) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.failed !== 'boolean'
  )
    return null;
  const offered = value.platforms;
  const platforms = MUSIC_PLATFORMS.filter((item) => item !== 'wy' && offered.includes(item));
  if (platforms.length !== offered.length) return null;
  // 兼容缺少 error 与 health 字段的旧版后端，视为无错误且未检测
  const error = value.error ?? null;
  if (!(error === null || isText(error, 200))) return null;
  const reported = value.health ?? {};
  if (!isRecord(reported)) return null;
  const health: Partial<Record<MusicPlatform, MusicLxHealth>> = {};
  for (const platform of platforms) {
    if (reported[platform] === undefined) continue;
    const result = readMusicLxHealth(reported[platform]);
    if (!result) return null;
    health[platform] = result;
  }
  return {
    id: value.id,
    name: value.name,
    version: value.version,
    author: value.author,
    description: value.description,
    platforms,
    enabled: value.enabled,
    failed: value.failed,
    error,
    health,
  };
}

/** 校验并解析托管 lxserver 音源列表，保留原始顺序；任意一项不合法则全量作废 */
export function readMusicLxSources(value: unknown): MusicLxSource[] | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  const sources = value.map(readLxSource);
  return sources.every((source) => source !== null) ? sources : null;
}
