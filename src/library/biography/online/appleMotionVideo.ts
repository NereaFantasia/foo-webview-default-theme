import { fb } from 'foo-webview-sdk/bridge';
import { settleDetailed } from '../../../host/hostCall.ts';
import { appleVideoFileUrl, appleVideoUrl } from '../apple/appleMedia.ts';

/**
 * 动态艺术照视频源解析：
 * 原始流为 HLS 主列表（m3u8），内部分片指向无加密、无音频轨的整段字节范围 fMP4；
 * 先读取主列表挑选合适画质分档，再读取分档媒体列表提取单一 mp4 物理地址，直接供给 `<video src>` 播放
 */

/**
 * 分档画面宽度对视口头部宽度的缩放系数；允许 20% 的下限容差以平衡清晰度与带宽消耗
 */
const WIDTH_SHARE = 0.8;
const LIST_TIMEOUT_MS = 15_000;
const LIST_BODY_LIMIT = 200_000;
/** 解析失败时的退避重试时间间隔 */
const RETRY_MS = 5 * 60_000;

export type MotionVideoResult =
  { readonly ok: true; readonly url: string } | { readonly ok: false; readonly retryAt: number };

interface Variant {
  readonly uri: string;
  readonly bandwidth: number;
  /** 视频宽度（像素）；主列表未指定分辨率时为 0 */
  readonly width: number;
}

function attributes(line: string): Readonly<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const match of line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) {
    const [, key, value] = match;
    if (key && value !== undefined) found[key] = value.replace(/^"|"$/g, '');
  }
  return found;
}

/** 过滤主列表中 avc1 编码且为 SDR 的画质档位，排除兼容性较差的 HEVC 与 HDR 分档 */
export function readMasterVariants(text: string, base: string): readonly Variant[] {
  const lines = text.split(/\r?\n/);
  const variants: Variant[] = [];
  lines.forEach((line, index) => {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) return;
    const attrs = attributes(line.slice('#EXT-X-STREAM-INF:'.length));
    const next = lines[index + 1]?.trim();
    const bandwidth = Number(attrs['AVERAGE-BANDWIDTH'] ?? attrs['BANDWIDTH']);
    const width = Number(attrs['RESOLUTION']?.split('x')[0]) || 0;
    if (!next || next.startsWith('#') || !Number.isFinite(bandwidth) || bandwidth <= 0) return;
    if (!attrs['CODECS']?.split(',').some((codec) => codec.trim().startsWith('avc1'))) return;
    if (attrs['VIDEO-RANGE'] && attrs['VIDEO-RANGE'] !== 'SDR') return;
    try {
      const uri = new URL(next, base).href;
      if (appleVideoUrl(uri)) variants.push({ uri, bandwidth, width });
    } catch {
      // 忽略 URL 解析失败的档位
    }
  });
  return variants;
}

/**
 * 根据头部宽度（CSS 像素）匹配画质档位：
 * 优先选取画面宽度不低于目标宽度 80% 的最小分档；均不满足时选用最大分档；相同宽度下选取最低码率档位
 * 仅当全部档位均缺失分辨率标注时，才退回至无分辨率分档并选取最低码率
 */
export function pickVariant(variants: readonly Variant[], headerWidth: number): Variant | null {
  const sized = variants.filter((variant) => variant.width > 0);
  const pool = sized.length > 0 ? sized : variants;
  if (pool.length === 0) return null;
  const want = headerWidth * WIDTH_SHARE;
  const widths = [...new Set(pool.map((variant) => variant.width))].sort((a, b) => a - b);
  const width = widths.find((value) => value >= want) ?? widths.at(-1);
  const same = pool.filter((variant) => variant.width === width);
  return same.reduce((best, variant) => (variant.bandwidth < best.bandwidth ? variant : best));
}

/**
 * 从媒体播放列表中提取单一 mp4 文件地址：
 * 仅支持所有切片引用同一物理文件的列表结构，且校验域名符合官方媒体地址白名单
 */
export function readMediaFile(text: string, base: string): string | null {
  const files = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-MAP:')) {
      const uri = attributes(line.slice('#EXT-X-MAP:'.length))['URI'];
      if (uri) files.add(uri);
    } else if (!line.startsWith('#')) files.add(line);
  }
  if (files.size !== 1) return null;
  const [file] = [...files];
  try {
    return appleVideoFileUrl(new URL(file ?? '', base).href);
  } catch {
    return null;
  }
}

async function getText(url: string, host: Pick<typeof fb, 'http'>): Promise<string | null> {
  const called = await settleDetailed(() =>
    host.http.request(url, {
      timeout: LIST_TIMEOUT_MS,
      redirect: 'error',
      headers: {
        'User-Agent': 'foo-webview-default-theme/0.1 (+https://github.com/NereaFantasia)',
        Accept: 'application/vnd.apple.mpegurl,*/*',
      },
    }),
  );
  const answer = called.answer;
  if (called.failure || !answer || answer.status !== 200) return null;
  return typeof answer.body === 'string' && answer.body.length <= LIST_BODY_LIMIT
    ? answer.body
    : null;
}

/**
 * 将 HLS 主列表解析为可直接用于 `<video src>` 的单一 mp4 地址；解析失败时返回下一次可重试时间戳 `retryAt`
 *
 * @param headerWidth 头部视口宽度（CSS 像素），用于自适应画质选档
 */
export async function resolveAppleMotionVideo(
  master: string,
  headerWidth: number,
  host: Pick<typeof fb, 'http'> = fb,
  now: () => number = Date.now,
): Promise<MotionVideoResult> {
  const failed: MotionVideoResult = { ok: false, retryAt: now() + RETRY_MS };
  if (!appleVideoUrl(master)) return failed;
  const masterText = await getText(master, host);
  const variant = masterText
    ? pickVariant(readMasterVariants(masterText, master), headerWidth)
    : null;
  if (!variant) return failed;
  const mediaText = await getText(variant.uri, host);
  const file = mediaText ? readMediaFile(mediaText, variant.uri) : null;
  return file ? { ok: true, url: file } : failed;
}
