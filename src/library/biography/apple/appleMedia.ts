import type { ApplePhoto } from '../biographyModel.ts';

const URL_LIMIT = 600;
const DIMENSION_LIMIT = 20_000;

/** 艺人页的图片模板（`{w}x{h}{c}.{f}`）或带了尺寸与格式的具体地址，二者都在地址末段 */
const IMAGE_SIZE_SEGMENT =
  /\/(?:\{w\}x\{h\}(?:\{c\})?\.\{f\}|\d{1,5}x\d{1,5}[a-z]{0,3}\.(?:png|jpe?g|webp))$/i;

export type AppleImageFormat = 'jpg' | 'png' | 'webp';

/** 艺术字图片：`url` 是不含尺寸与格式的基础地址，`width`、`height` 是原图尺寸 */
export interface AppleLogo {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

/** 一段动态艺术照：`video` 是 HLS 主列表地址，`poster` 是静帧的基础地址，`color` 是静帧的底色（六位十六进制） */
export interface AppleMotionClip {
  readonly video: string;
  readonly poster: string;
  readonly color?: string;
}

const HEX_COLOR = /^[0-9a-f]{6}$/i;

/** 页面里给的底色：六位十六进制，不带 `#`；读不出时没有 */
export function appleColor(value: unknown): string | null {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : null;
}

/** 方形与宽幅两种，至少有一种 */
export interface AppleMotion {
  readonly square?: AppleMotionClip;
  readonly wide?: AppleMotionClip;
}

function httpsUrl(value: unknown, host: (name: string) => boolean): URL | null {
  if (typeof value !== 'string' || !value || value.length > URL_LIMIT) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      host(url.hostname)
      ? url
      : null;
  } catch {
    return null;
  }
}

function isImageHost(name: string): boolean {
  return name === 'mzstatic.com' || name.endsWith('.mzstatic.com');
}

/**
 * 图片的基础地址：去掉末段的尺寸与格式，只认 mzstatic.com 的 https 地址。基础地址再过一遍
 * 得到自己，缓存读回时用同一个函数校验
 */
export function appleImageBase(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = httpsUrl(value.replace(IMAGE_SIZE_SEGMENT, ''), isImageHost);
  return url && url.pathname.startsWith('/image/') && !/[{}]|%7[bd]/i.test(url.pathname)
    ? url.href
    : null;
}

/** 艺术字图片的请求宽度，像素：比头部里画的大一些，高分屏上也清楚 */
const LOGO_WIDTH = 800;

/** 艺术字图片的取图地址：按原图的宽高比取 `LOGO_WIDTH` 宽的 png，原图更小就取原尺寸 */
export function appleLogoUrl(logo: AppleLogo): string {
  const width = Math.min(LOGO_WIDTH, logo.width);
  const height = Math.max(1, Math.round((width * logo.height) / logo.width));
  return appleImageUrl(logo.url, width, height, 'png');
}

/** 按显示尺寸取图：基础地址拼上 `{宽}x{高}{裁切}.{格式}`，`bb` 是整图不裁 */
export function appleImageUrl(
  base: string,
  width: number,
  height: number,
  format: AppleImageFormat,
  crop = 'bb',
): string {
  return `${base}/${width}x${height}${crop}.${format}`;
}

/**
 * 宽幅图：`url` 是基础地址，`crop` 是 Apple 图片服务的裁切码，两个小写字母。`vf` 是按脸部居中裁成宽图，
 * `bb` 是整图不裁（宽幅动态艺术照的静帧本来就是 16:9）
 */
export interface AppleWide {
  readonly url: string;
  readonly crop: string;
  /** 图加载出来之前头部先铺这个底色；页面没给时没有 */
  readonly color?: string;
}

/** 一次取图的尺寸与裁切；基础地址拼上它才是请求地址 */
export interface AppleImageRequest {
  readonly width: number;
  readonly height: number;
  readonly crop: string;
}

const CROP_CODE = /^[a-z]{2}$/;

/** 缓存里存下的宽幅图，基础地址与裁切码都要合格 */
export function readAppleWide(value: unknown): AppleWide | null {
  if (!record(value)) return null;
  const url = appleImageBase(value['url']);
  const crop = value['crop'];
  const color = appleColor(value['color']);
  return url && typeof crop === 'string' && CROP_CODE.test(crop)
    ? { url, crop, ...(color ? { color } : {}) }
    : null;
}

/** 动态艺术照的 HLS 主列表，只认 mvod.itunes.apple.com */
export function appleVideoUrl(value: unknown): string | null {
  const url = httpsUrl(value, (name) => name === 'mvod.itunes.apple.com');
  return url && url.pathname.endsWith('.m3u8') ? url.href : null;
}

/** 媒体列表指向的 mp4 文件，同样只认 mvod.itunes.apple.com */
export function appleVideoFileUrl(value: unknown): string | null {
  const url = httpsUrl(value, (name) => name === 'mvod.itunes.apple.com');
  return url && url.pathname.toLowerCase().endsWith('.mp4') ? url.href : null;
}

function dimension(value: unknown): number | null {
  const number = typeof value === 'string' && /^\d{1,5}$/.test(value) ? Number(value) : value;
  return typeof number === 'number' &&
    Number.isInteger(number) &&
    number > 0 &&
    number <= DIMENSION_LIMIT
    ? number
    : null;
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 缓存里的艺术照：基础地址要合格，`pageUrl` 必须是这位艺人的页面地址 */
export function readApplePhoto(value: unknown, pageUrl: string): ApplePhoto | null {
  if (!record(value) || value['source'] !== 'apple' || value['pageUrl'] !== pageUrl) return null;
  const url = appleImageBase(value['url']);
  if (!url) return null;
  // 宽幅图读不出不影响艺术照，只是头部不铺满
  const wide = value['wide'] === undefined ? null : readAppleWide(value['wide']);
  return { source: 'apple', url, pageUrl, ...(wide ? { wide } : {}) };
}

/** 页面里的 `artistLogo.dictionary` 与缓存里存下的艺术字图片都走这里，地址可以带模板，也可以已是基础地址 */
export function readAppleLogo(value: unknown): AppleLogo | null {
  if (!record(value)) return null;
  const url = appleImageBase(value['url']);
  const width = dimension(value['width']);
  const height = dimension(value['height']);
  return url && width && height ? { url, width, height } : null;
}

function readClip(value: unknown): AppleMotionClip | null {
  if (!record(value)) return null;
  const video = appleVideoUrl(value['video']);
  const poster = appleImageBase(value['poster']);
  const color = appleColor(value['color']);
  return video && poster ? { video, poster, ...(color ? { color } : {}) } : null;
}

/** 缓存里存下的动态艺术照；两种都读不出时答 null */
export function readAppleMotion(value: unknown): AppleMotion | null {
  if (!record(value)) return null;
  const square = readClip(value['square']);
  const wide = readClip(value['wide']);
  return square || wide ? { ...(square ? { square } : {}), ...(wide ? { wide } : {}) } : null;
}

/** 页面里 `{video, previewFrame}` 的一项，静帧取 `previewFrame` 的图片模板 */
export function readAppleClipFromPage(value: unknown): AppleMotionClip | null {
  if (!record(value) || !record(value['previewFrame'])) return null;
  return readClip({
    video: value['video'],
    poster: value['previewFrame']['url'],
    color: value['previewFrame']['bgColor'],
  });
}
