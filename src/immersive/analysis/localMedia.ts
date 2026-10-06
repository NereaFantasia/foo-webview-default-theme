/** 协议前缀至少两个字符，`E:\` 这样的盘符不算协议。 */
const SCHEME = /^([a-z][a-z0-9+.-]+):/i;
/** 宿主能当本地文件打开的协议：普通文件、便携安装的相对路径、归档内文件、音频 CD。 */
const LOCAL_SCHEMES = new Set(['file', 'file-relative', 'unpack', 'cdda']);

/**
 * 这条路径指向的是本地媒体，还是网络流（`http(s)://`、`mms://` 与各流媒体插件自己的协议）。
 * 没有协议前缀的盘符与 UNC 路径按本地算。
 *
 * 要分开的原因：读标签、字段求值、内嵌歌词这类宿主端点会同步打开文件，对 URL 就是一次网络连接，
 * 超时按 10 s 计，而它们跑在 fb2k 主线程上，等的这段时间整个窗口都不响应。网络流的这些信息本来也
 * 不在文件里，问了只会等来一个失败。
 */
export function isLocalMedia(path: string): boolean {
  const match = SCHEME.exec(path);
  return !match || LOCAL_SCHEMES.has((match[1] ?? '').toLowerCase());
}
