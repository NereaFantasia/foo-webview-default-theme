import type { PluralPick } from '../i18n/plural.ts';
import type { Translate } from '../i18n/translate.ts';

/**
 * 一批曲目的总长，写成大约多少：满一小时按小时四舍五入（「183 小时」），不足一小时按分钟向上取整（「17 分钟」），
 * 不到一分钟也写 1 分钟。没有时长（0、负数、非数）时是空串。
 */
export function spanText(seconds: number, t: Translate, plural: PluralPick): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds >= 3600) {
    const hours = Math.round(seconds / 3600);
    return t(plural(hours, 'span.hoursOne', 'span.hours'), { count: hours });
  }
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return t(plural(minutes, 'span.minutesOne', 'span.minutes'), { count: minutes });
}

/** 几首曲目的总长，秒；缺时长的按 0 算。 */
export function totalSeconds(tracks: Iterable<{ readonly duration: number }>): number {
  let sum = 0;
  for (const track of tracks) {
    if (Number.isFinite(track.duration) && track.duration > 0) sum += track.duration;
  }
  return sum;
}
