import type { MessageKey } from '../i18n/en.ts';
import type { Translate } from '../i18n/translate.ts';
import type { MusicLxHealth, MusicLxSource } from '../server/musicLxSources.ts';
import type { MusicPlatform } from '../server/musicObjects.ts';

/** 判定音源是否可检测；仅对已启用且脚本加载成功的音源执行连通性检测 */
export const checkable = (source: MusicLxSource) => source.enabled && !source.failed;

/** 平台连通性显示状态；正在检测中的状态优先于后端记录结果 */
export type LxHealthState = 'none' | 'checking' | 'ok' | 'failed' | 'unknown';

export function healthState(health: MusicLxHealth | undefined, checking: boolean): LxHealthState {
  if (checking) return 'checking';
  return health?.status ?? 'none';
}

function resultKey(health: MusicLxHealth | undefined): MessageKey {
  if (!health) return 'online.lxStateNone';
  if (health.status === 'ok') return 'online.lxStateOk';
  switch (health.reason) {
    case 'script':
      return 'online.lxStateScript';
    case 'unreachable':
      return 'online.lxStateUnreachable';
    case 'timeout':
      return 'online.lxStateTimeout';
    default:
      return 'online.lxStateUnknown';
  }
}

/** 生成平台状态项的无障碍描述文本 */
export function healthLabel(
  t: Translate,
  platform: string,
  health: MusicLxHealth | undefined,
  checking: boolean,
): string {
  const state = checking ? t('online.lxStateChecking') : t(resultKey(health));
  return t('online.lxHealthLabel', { platform, state });
}

/** 格式化相对时间文本，根据时间差展示刚刚、相对时分或绝对日期 */
export function relativeTime(t: Translate, locale: string, at: number, now: number): string {
  const seconds = Math.round((at - now) / 1000);
  const age = Math.abs(seconds);
  if (age < 45) return t('online.lxJustNow');
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (age < 3600) return format.format(Math.round(seconds / 60), 'minute');
  if (age < 86_400) return format.format(Math.round(seconds / 3600), 'hour');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(at);
}

/** 获取指定平台列表中最新一次检测的时间戳，未检测过时返回 null */
export function lastCheckedAt(
  health: MusicLxSource['health'],
  platforms: readonly MusicPlatform[],
): number | null {
  const times = platforms.flatMap((platform) => health[platform]?.at ?? []);
  return times.length ? Math.max(...times) : null;
}

/** 生成平台状态的悬浮提示详情，组合状态结论、耗时或错误原因与相对时间 */
export function healthTip(
  t: Translate,
  locale: string,
  health: MusicLxHealth | undefined,
  now: number,
): string | null {
  if (!health) return null;
  const when = relativeTime(t, locale, health.at, now);
  if (health.status === 'ok')
    return [t('online.lxStateOk'), t('online.lxMilliseconds', { ms: health.ms }), when].join(' · ');
  if (health.status === 'unknown') return t('online.lxNoSample');
  if (health.reason === 'timeout') return [t('online.lxTimeoutDetail'), when].join(' · ');
  return [t(resultKey(health)), health.message, when]
    .filter((part): part is string => part !== null)
    .join(' · ');
}
