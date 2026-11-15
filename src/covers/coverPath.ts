import { trackOrigin } from '../host/trackOrigin.ts';

/** 获取封面资源请求标识（优先使用句柄，网络流或无曲目时返回空字符串） */
export function coverPathOf(
  track: { readonly path: string; readonly handle: string } | null,
): string {
  if (!track) return '';
  return trackOrigin(track.path) === 'stream' ? '' : track.handle || track.path;
}
