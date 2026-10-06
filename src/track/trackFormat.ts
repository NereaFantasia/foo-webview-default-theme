import type { Track } from 'foo-webview-sdk';

/**
 * 交给 `titleformat.eval` 的式子：编码方式（fb2k 的 `lossless` / `lossy`）与位深，一次取回、以 `|` 分开。
 * 不带路径时求的是正在播放的那一首。
 */
export const FORMAT_PATTERN = '%__encoding%|%__bitspersample%';

/** 曲目行里没有、要另外求值才知道的两项。取不到的项为 null。 */
export interface FormatDetail {
  readonly lossless: boolean | null;
  /** 位深；解码器没报或不是正整数时为 null。 */
  readonly bits: number | null;
}

/** 格式细节此刻的样子：还在取、取不到，或取到了。 */
export type FormatReading = FormatDetail | 'pending' | 'failed';

/** 拆开 `FORMAT_PATTERN` 的求值结果；认不出的项记为 null。 */
export function parseFormatDetail(result: string): FormatDetail {
  const [encoding = '', bits = ''] = result.split('|');
  const normalized = encoding.trim().toLowerCase();
  const depth = Number(bits.trim());
  return {
    lossless: normalized === 'lossless' ? true : normalized === 'lossy' ? false : null,
    bits: Number.isInteger(depth) && depth > 0 ? depth : null,
  };
}

/** 采样率写成千赫，至多一位小数，去掉尾零：44100 → `44.1`，48000 → `48`。 */
export function kiloHertz(sampleRate: number): string {
  return String(Math.round(sampleRate / 100) / 10);
}

/** 格式标记：编码框里的字与后面那一串。 */
export interface FormatBadge {
  readonly codec: string;
  readonly detail: string;
}

/**
 * 格式标记的取值。编码一律大写；无损写「位深/采样率」（`16/44.1`），有损写比特率（`320k`）。位深或编码方式
 * 取不到时只写采样率；还在取时只写编码，免得换曲后先闪一下采样率再换成比特率。编码也不知道时不出标记。
 */
export function formatBadge(
  track: Pick<Track, 'codec' | 'sampleRate' | 'bitrate'>,
  reading: FormatReading,
): FormatBadge | null {
  const codec = track.codec.trim().toUpperCase();
  if (!codec) return null;
  if (reading === 'pending') return { codec, detail: '' };
  const rate = track.sampleRate > 0 ? kiloHertz(track.sampleRate) : '';
  if (reading !== 'failed' && reading.lossless === false && track.bitrate > 0) {
    return { codec, detail: `${track.bitrate}k` };
  }
  if (reading !== 'failed' && reading.lossless === true && reading.bits !== null && rate) {
    return { codec, detail: `${reading.bits}/${rate}` };
  }
  return { codec, detail: rate };
}
