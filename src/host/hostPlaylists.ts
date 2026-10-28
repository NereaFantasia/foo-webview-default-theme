/**
 * 媒体库与在线音乐起播时专用的后台影子播放列表名称（供宿主按序衔接播放）
 * 保持硬编码名称而不纳入国际化，确保多语言切换时能准确命中同一张列表
 */
export const LIBRARY_VIEW_PLAYLIST = '[Library View]';

/**
 * 宿主与主题内部专用的保留播放列表名称集合（在侧边栏、发送目标列表等界面交互中一律隐藏过滤）
 * - `[WebView Queue]`: `queue.add` 内部入队缓冲列表
 * - `__webview_buffer__`: JIT 队列影子列表（宿主内部只读加锁）
 * - `LIBRARY_VIEW_PLAYLIST`: 媒体库/在线曲目起播承载列表
 */
export const HOST_PLAYLIST_NAMES: readonly string[] = [
  '[WebView Queue]',
  '__webview_buffer__',
  LIBRARY_VIEW_PLAYLIST,
];

export function isHostPlaylist(name: string): boolean {
  return HOST_PLAYLIST_NAMES.includes(name);
}
