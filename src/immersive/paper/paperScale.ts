/**
 * 仪表图纸的刻度与格式化：频谱柱与整轨波形的轴、右栏各格的文字都从这里取，全是纯函数，不碰 DOM。
 *
 * 横轴刻度缺省按对数落位：`x = W · log(f / 20) / log(fN / 20)`，`fN` 是 Nyquist（`getStreamInfo().sampleRate / 2`，
 * 读不到按 22 050）。频谱柱的横轴低频不是对数（`barAxis.ts`），画刻度时传它自己的落位函数；刻度都按公式算，
 * 不用手排的像素值。
 */
export const HZ_MIN = 20;
export const DEFAULT_NYQUIST = 22050;
/** 频谱横轴的七个刻度（Hz）；超过 Nyquist 的不画。 */
export const HZ_TICKS: readonly number[] = [20, 200, 1000, 2000, 5000, 10000, 20000];
/** 缺值一律写这一个字：图纸的格子不因为空就塌，键名留着、值写它。 */
export const MISSING = '—';

/** 时长写成「分:秒」、秒补足两位，一小时以上照样进位到分钟位（3723 s 写 `62:03`）；小数秒舍去，负数按 0。 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${`${total % 60}`.padStart(2, '0')}`;
}

/** 采样率写成千赫：整千赫不带小数（`48 kHz`），非整数留一位小数（`44.1 kHz`）。 */
function formatSampleRate(hz: number): string {
  const khz = hz / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
}

export function hzPosition(hz: number, nyquist: number, width: number): number {
  if (!(nyquist > HZ_MIN) || !(width > 0) || !(hz > HZ_MIN)) return 0;
  // 先算比值再乘宽：hz 等于 Nyquist 时两个 log 相除恰为 1，末刻度正落在 W 上、不带浮点尾巴。
  return width * (Math.log(hz / HZ_MIN) / Math.log(nyquist / HZ_MIN));
}

/** 刻度字的写法：20 → `20`、1000 → `1K`、20000 → `20K`。 */
export function formatHzTick(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}K` : `${hz}`;
}

export interface HzTick {
  hz: number;
  x: number;
  label: string;
}

/** `fraction` 给频率在轴上的位置（0…1）；缺省按 `hzPosition` 的对数轴。 */
export function hzTicks(
  nyquist: number,
  width: number,
  fraction?: (hz: number) => number,
): HzTick[] {
  return HZ_TICKS.filter((hz) => hz <= nyquist).map((hz) => ({
    hz,
    x: fraction ? width * fraction(hz) : hzPosition(hz, nyquist, width),
    label: formatHzTick(hz),
  }));
}

export interface TimeTick {
  seconds: number;
  label: string;
}

/** 时间轴等分：`count` 个刻度含两端，`0:00 … 时长`；没有时长就没有刻度。 */
export function timeTicks(duration: number, count = 5): TimeTick[] {
  if (!(duration > 0) || count < 2) return [];
  return Array.from({ length: count }, (_, index) => {
    const seconds = (duration * index) / (count - 1);
    return { seconds, label: formatDuration(seconds) };
  });
}

/** 播放头胶囊的时间：`01:39`，分钟补足两位；一小时以上是 `1:02:03`。 */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = `${total % 60}`.padStart(2, '0');
  return hours > 0
    ? `${hours}:${`${minutes}`.padStart(2, '0')}:${rest}`
    : `${`${minutes}`.padStart(2, '0')}:${rest}`;
}

export function formatKbps(bitrate?: number): string {
  return bitrate && bitrate > 0 ? `${Math.round(bitrate)} kbps` : MISSING;
}

export function formatKHz(sampleRate?: number): string {
  return sampleRate && sampleRate > 0 ? formatSampleRate(sampleRate) : MISSING;
}

/** 宿主给的是字节；按 1024 进位、一位小数，与 fb2k 自己的 `%filesize_natural%` 同一把尺。 */
export function formatMB(bytes?: number): string {
  return bytes && bytes > 0 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : MISSING;
}

/** 量表的数：一位小数，舍入成 0 的不带负号；没有值写 `—`。 */
export function formatGaugeDb(value: number | null): string {
  if (value === null) return MISSING;
  const text = value.toFixed(1);
  return text === '-0.0' ? '0.0' : text;
}

export function formatChannels(channels?: number): string {
  if (!channels || channels <= 0) return MISSING;
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  return `${channels}`;
}

/** By 行右侧的 Quality：`~955kbps / 44.1kHz`，缺哪项去哪项，都缺给空串（那一格整个不出）。 */
export function qualityLine(bitrate?: number, sampleRate?: number): string {
  const parts: string[] = [];
  if (bitrate && bitrate > 0) parts.push(`~${Math.round(bitrate)}kbps`);
  if (sampleRate && sampleRate > 0) parts.push(formatSampleRate(sampleRate).replace(' ', ''));
  return parts.join(' / ');
}

/** 环内下的曲号：井号加两位补零；0 或缺省不显示。 */
export function formatTrackNo(trackNumber?: number): string {
  return trackNumber && trackNumber > 0 ? `#${`${Math.trunc(trackNumber)}`.padStart(2, '0')}` : '';
}

/** 年份取 `date` 前四位；开头不是四位数字就当没有。 */
export function yearOf(date?: string): string {
  const match = /^\d{4}/.exec(date ?? '');
  return match ? match[0] : '';
}

/** 正整数才算数：`evalFields` 答回的是字符串、曲目对象里是数字，空串、`?`、0 与小数都当没有。 */
function wholeOf(value?: number | string): number | undefined {
  const number =
    typeof value === 'string' ? (/^\d+$/.test(value.trim()) ? Number(value) : Number.NaN) : value;
  return number !== undefined && Number.isInteger(number) && number > 0 ? number : undefined;
}

/**
 * 舞台 By 行右侧的 Quality：`16-bit / ~955kbps / 44.1kHz · lossless`。位深与编码方式是 `evalFields` 答回的
 * 原文（有损格式没有位深）；缺哪项去哪项，都缺给空串（那一格整个不出）。
 */
export function stageQualityLine(parts: {
  bitDepth?: string;
  bitrate?: number;
  sampleRate?: number;
  encoding?: string;
}): string {
  const depth = wholeOf(parts.bitDepth);
  const head = [depth ? `${depth}-bit` : '', qualityLine(parts.bitrate, parts.sampleRate)]
    .filter(Boolean)
    .join(' / ');
  const encoding = parts.encoding?.trim() ?? '';
  if (!encoding) return head;
  return head ? `${head} · ${encoding}` : encoding;
}

/** 封面下三格的 Date：`date` 标签原文，分隔符 `.` 与 `/` 换成 `-`（`2010.12.29` → `2010-12-29`）。 */
export function formatTagDate(date?: string): string {
  const text = date?.trim() ?? '';
  return text ? text.replace(/[./]/g, '-') : MISSING;
}

/**
 * 封面下三格的 Track：`<曲号> / <总曲数>`，没有总曲数只写曲号；多碟（总碟数大于 1）且有碟号时写
 * `<碟号>-<曲号> / <总曲数>`。没有曲号写 `—`。
 */
export function formatTrackPosition(parts: {
  trackNumber?: number;
  discNumber?: number;
  totalTracks?: string;
  totalDiscs?: string;
}): string {
  const track = wholeOf(parts.trackNumber);
  if (!track) return MISSING;
  const disc = wholeOf(parts.discNumber);
  const multiDisc = (wholeOf(parts.totalDiscs) ?? 0) > 1;
  const head = disc && multiDisc ? `${disc}-${track}` : `${track}`;
  const tracks = wholeOf(parts.totalTracks);
  return tracks ? `${head} / ${tracks}` : head;
}

/**
 * Duration 附行的剩余时间：写法同 Duration 的值、前面加 `−`（`−3:05`）；剩余秒数向上取整，播完正好是 `−0:00`。
 * 没有时长写 `—`。
 */
export function formatRemaining(duration: number, position: number): string {
  if (!(duration > 0)) return MISSING;
  const played = Number.isFinite(position) ? Math.max(0, position) : 0;
  return `−${formatDuration(Math.ceil(Math.max(0, duration - played)))}`;
}

/** BPM 格的值：`%bpm%` 标签取整；取整后不是正数写 `—`。 */
export function formatBpm(bpm?: string): string {
  const value = Math.round(Number(bpm));
  return value > 0 ? `${value}` : MISSING;
}
