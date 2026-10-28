// 根据文件扩展名启发式识别视频封装格式；仅作候选判断，实际是否存在有效视频轨取决于解码器

/** 常见视频封装格式扩展名集合；asf、3gp 常用于纯音频，未予收录 */
const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp4',
  'm4v',
  'mov',
  'mkv',
  'webm',
  'avi',
  'wmv',
  'flv',
  'f4v',
  'mpg',
  'mpeg',
  'ts',
  'm2ts',
  'mts',
  'vob',
  'ogv',
  'rm',
  'rmvb',
  'divx',
]);

const SUBSONG_SUFFIX = /\|subsong:\d+$/;
const EXTENSION = /\.([a-z0-9]+)$/i;

/** 提取文件路径中规范化的小写视频扩展名；非视频封装或无扩展名时返回 null，兼容 |subsong:N 后缀 */
export function videoExtensionOf(path: string): string | null {
  const extension = EXTENSION.exec(path.replace(SUBSONG_SUFFIX, ''))?.[1]?.toLowerCase();
  return extension !== undefined && VIDEO_EXTENSIONS.has(extension) ? extension : null;
}

export function isVideoPath(path: string): boolean {
  return videoExtensionOf(path) !== null;
}
