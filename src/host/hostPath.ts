const SUBSONG_SUFFIX = /\|subsong:\d+$/i;
const RELATIVE_SCHEME = /^file-relative:\/\//i;
/** 已是绝对形态：盘符开头，或 UNC 的 `\\server\share`。 */
const ABSOLUTE_PATH = /^(?:[a-z]:|\\\\)/i;

/**
 * `file-relative://` 的基准目录，由 profile 目录推出。便携安装的 profile 就在程序目录下
 * （`<程序目录>\profile`），而 `file-relative://` 只出现在便携安装里、相对的正是程序目录，所以取
 * profile 的父目录。非便携安装的 profile 在 `%APPDATA%` 下，推出的目录用不上，也不会用错：那里
 * 不会有相对形态的路径。推不出（路径里没有上一级）时为 null。
 */
export function relativeBaseOf(profilePath: string): string | null {
  const trimmed = profilePath.replace(/\//g, '\\').replace(/\\+$/, '');
  const cut = trimmed.lastIndexOf('\\');
  if (cut <= 0) return null;
  const parent = trimmed.slice(0, cut);
  // 父目录只剩盘符时补回根分隔符，`P:` 与 `P:\` 是两个地方。
  return /^[a-z]:$/i.test(parent) ? `${parent}\\` : parent;
}

/** 相对路径拼到基准上，折掉 `.` 与 `..`；越过根的 `..` 停在根上，与 Windows 一致。 */
function resolveRelative(relative: string, base: string): string {
  const unc = base.startsWith('\\\\');
  const segments = `${base}\\${relative}`.split('\\').filter((segment) => segment !== '');
  // 根不参与折叠：盘符占一段，UNC 的服务器名与共享名占两段。
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
 * 把宿主给的路径归一成可以互相比较的形态：去掉 `file://` 前缀与 `|subsong:N` 后缀、分隔符统一为
 * `\`、折成小写。曲目行的 `path` 是 fb2k 的内部形态，库根与 `metadb:changed` 报的是原生绝对路径，
 * 不归一永远比不中。
 *
 * 便携安装的 `file-relative://..\..\x` 相对程序目录，给了 `relativeBase`（见 `relativeBaseOf`）才拼成
 * 绝对路径；没给时只去掉前缀，剩下的相对路径比不中绝对路径。
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
