const SUBSONG_SUFFIX = /\|subsong:\d+$/i;
const RELATIVE_SCHEME = /^file-relative:\/\//i;
/** 已是绝对形态：盘符开头，或 UNC 的 `\\server\share` */
const ABSOLUTE_PATH = /^(?:[a-z]:|\\\\)/i;

/**
 * 根据 profile 目录推导 `file-relative://` 相对路径的基准根目录
 * 便携版安装的 profile 位于程序根目录下方（`<程序根目录>\profile`），而 `file-relative://` 格式路径
 * 恰好相对于程序根目录，因此取其父级目录解析。若无法推导（如顶层路径）则返回 null
 */
export function relativeBaseOf(profilePath: string): string | null {
  const trimmed = profilePath.replace(/\//g, '\\').replace(/\\+$/, '');
  const cut = trimmed.lastIndexOf('\\');
  if (cut <= 0) return null;
  const parent = trimmed.slice(0, cut);
  // 当父目录仅为盘符时补全反斜杠根分隔符（避免诸如 "D:" 与 "D:\" 语义不同）
  return /^[a-z]:$/i.test(parent) ? `${parent}\\` : parent;
}

/** 将相对路径拼接至基准目录并规范化折叠 `.` 与 `..`（语义与 Windows 路径解析保持一致） */
function resolveRelative(relative: string, base: string): string {
  const unc = base.startsWith('\\\\');
  const segments = `${base}\\${relative}`.split('\\').filter((segment) => segment !== '');
  // 根不参与折叠：盘符占一段，UNC 的服务器名与共享名占两段
  const rootLength = unc ? 2 : 1;
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === '.') continue;
    if (segment === '..') {
      if (out.length > rootLength) out.pop();
      continue;
    }
    out.push(segment);
  }
  return `${unc ? '\\\\' : ''}${out.join('\\')}`;
}

/**
 * 将宿主提供的文件路径规范化为可比对的统一格式：
 * - 剔除 `file://` 协议前缀与 `|subsong:N` 分轨后缀；
 * - 路径分隔符统一转换为反斜杠 `\` 并转换为小写；
 * - 若包含 `file-relative://` 且提供了 `relativeBase`，则将其解析拼接为绝对路径
 */
export function normalizeHostPath(path: string, relativeBase?: string | null): string {
  if (!path) return '';
  const bare = path.replace(SUBSONG_SUFFIX, '');
  const scheme = RELATIVE_SCHEME.exec(bare);
  if (!scheme) {
    return bare
      .replace(/^file:\/\//i, '')
      .replace(/\//g, '\\')
      .toLowerCase();
  }
  const relative = bare.slice(scheme[0].length).replace(/\//g, '\\');
  const resolved =
    relativeBase && !ABSOLUTE_PATH.test(relative)
      ? resolveRelative(relative, relativeBase.replace(/\//g, '\\'))
      : relative;
  return resolved.toLowerCase();
}
