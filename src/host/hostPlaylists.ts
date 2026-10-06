/**
 * 宿主自己建来用的播放列表，界面上一律不列：播放列表节、发送到的清单、来源名都不出现它们。
 *
 * - `[WebView Queue]`：`queue.add` 缺省先把路径追加到这张再入队（插件 `QueueApi.h` 的
 *   `QUEUE_PLAYLIST_NAME`）。
 * - `__webview_buffer__`：JIT 队列的影子列表，带锁、删不掉（插件 `QueueManager.h` 的
 *   `SHADOW_PLAYLIST_NAME`）。
 *
 * 宿主按名字找它们，主题也只能按名字认：用户自己建一张同名的，宿主同样会拿去用，一并不列。
 */
export const HOST_PLAYLIST_NAMES: readonly string[] = ['[WebView Queue]', '__webview_buffer__'];

export function isHostPlaylist(name: string): boolean {
  return HOST_PLAYLIST_NAMES.includes(name);
}
