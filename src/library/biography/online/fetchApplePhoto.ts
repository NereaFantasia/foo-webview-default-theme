import { fb } from 'foo-webview-sdk/bridge';
import type { ApplePhoto } from '../biographyModel.ts';
import { appleImageBase, appleImageUrl, type AppleImageRequest } from '../apple/appleMedia.ts';
import { requestBiographyPhoto, type LastfmPhotoResult } from './fetchLastfmPhoto.ts';

/** 头像最大显示 240，横幅满高最大 520，600 见方的 jpg 约 90 KB，够清楚又不浪费流量 */
const PHOTO_SIZE = 600;
/** 头部整幅铺满：1600×900 的 jpg 约 200 到 300 KB，宽窗口下也不发虚 */
export const APPLE_HERO_REQUEST: AppleImageRequest = { width: 1600, height: 900, crop: 'vf' };
/**
 * 宽幅动态艺术照的静帧：原图是 3840×2160 的 PNG 关键帧，图片服务按请求的尺寸现场渲染（约 1.7 秒，缓存里没有的尺寸
 * 才这样），1600×900 的结果 320 KB 上下。静帧只撑到视频载完，取 1280×720，体积小三分之一
 */
export const APPLE_STILL_REQUEST: AppleImageRequest = { width: 1280, height: 720, crop: 'bb' };
/** 图片比页面里的文本重，慢链路上 12 秒不够：艺人页本身平均约 4.5 秒、偶有 15 秒 */
const PHOTO_TIMEOUT_MS = 30_000;

/** 这张照片的请求地址，也是图片缓存的键：同一个基础地址的不同尺寸与裁切是不同的图 */
export function applePhotoUrl(photo: ApplePhoto): string {
  const { width, height, crop } = photo.request ?? {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    crop: 'bb',
  };
  return appleImageUrl(photo.url, width, height, 'jpg', crop);
}

/**
 * 头部铺满用的那张：同一位艺人的宽幅图，取 1600×900。宽幅图的裁切码由页面给（`vf` 或 `bb`），
 * 没有宽幅图时没有这一张
 */
export function appleHeroOf(photo: ApplePhoto): ApplePhoto | null {
  const { wide } = photo;
  return wide
    ? {
        source: 'apple',
        url: wide.url,
        pageUrl: photo.pageUrl,
        request:
          wide.crop === 'bb' ? APPLE_STILL_REQUEST : { ...APPLE_HERO_REQUEST, crop: wide.crop },
      }
    : null;
}

/**
 * 取 Apple 艺人的艺术照：基础地址拼上尺寸与 jpg 才是取图地址。基础地址要原样过得了
 * `appleImageBase`（只认 mzstatic.com 的 https 图片），不合格不发请求
 */
export async function fetchApplePhoto(
  source: ApplePhoto,
  host: Pick<typeof fb, 'http'> = fb,
): Promise<LastfmPhotoResult> {
  if (appleImageBase(source.url) !== source.url)
    return { ok: false, problem: 'invalid', retryAt: Date.now() + 300_000, detail: null };
  return requestBiographyPhoto(applePhotoUrl(source), host, PHOTO_TIMEOUT_MS);
}
