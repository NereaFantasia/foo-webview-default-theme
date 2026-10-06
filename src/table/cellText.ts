import type { Track } from 'foo-webview-sdk';

// 单元格里的文字：曲号、碟号与时长的写法。

/** 曲号；宿主对没有曲号的曲目答 0，那时留空。 */
export function trackNumberText(track: Pick<Track, 'trackNumber'>): string {
  return track.trackNumber > 0 ? String(track.trackNumber) : '';
}

/**
 * 「碟.曲」：曲号补到两位；这张专辑不止一张碟（`discCount` 大于 1）且这首有碟号时，碟号写在前面。单碟专辑
 * 标着 DISCNUMBER=1 的不写成「1.01」。没有曲号时留空，不拿行号顶替。
 */
export function discTrackText(
  track: Pick<Track, 'trackNumber' | 'discNumber'>,
  discCount: number,
): string {
  if (track.trackNumber <= 0) return '';
  const padded = String(track.trackNumber).padStart(2, '0');
  return discCount > 1 && track.discNumber > 0 ? `${track.discNumber}.${padded}` : padded;
}

/** 年份：日期里第一个四位数（`2019`、`2019-05-01`、`2004.02.27` 都写 4 位年）；认不出时留空。 */
export function yearText(date: string | undefined): string {
  return /\d{4}/.exec(date ?? '')?.[0] ?? '';
}

/** foo_playcount 的时间只写到日；不是「YYYY-MM-DD」开头的一律留空。 */
export function dayText(time: string | undefined): string {
  return /^\d{4}-\d{2}-\d{2}/.exec(time ?? '')?.[0] ?? '';
}

/** 码率写成「320 kbps」；宿主对未知的答 0，那时留空。 */
export function bitrateText(kbps: number | undefined): string {
  return kbps !== undefined && kbps > 0 ? `${Math.round(kbps)} kbps` : '';
}

/** 时长写成 `m:ss`，满一小时写成 `h:mm:ss`。宿主对时长未知的曲目答 0，那时与负数、非数一样留空。 */
export function durationText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}
