import { isSha256, sha256 } from './contract.ts';
import { versionRef, type VersionRef } from './loaderContract.ts';
import { TemplateFileError, type TemplateFiles } from './templateFiles.ts';
import { readZip, type ZipProblem } from './zipArchive.ts';

/**
 * 把校验过的前端包装进一个新的 `fe/<版本>_<随机>/` 目录。目录只由这次安装写；文件全部写完、逐个读回
 * 核对哈希之后，最后原子写 `installed.json`。没有它的目录一律当作不存在，中途失败留下的半截目录
 * 由清理删掉，不续写。
 */

export type InstallProblem =
  | ZipProblem
  /** 包里缺入口文件，或自带了只能由安装生成的标记。 */
  | 'entry'
  | 'path-too-long'
  /** 宿主拒绝写入：磁盘满、被占用、只读或被安全软件拦下。 */
  | 'write'
  /** 读回的内容与包里的不一致，或读不回来。 */
  | 'verify';
export type InstallResult =
  | { readonly ok: true; readonly version: VersionRef }
  | { readonly ok: false; readonly problem: InstallProblem; readonly detail?: string };

export interface InstallOptions {
  /** 六位小写字母或数字的目录后缀。 */
  readonly suffix: () => string;
  /** 两次宿主写入之间让出主线程。 */
  readonly pause: () => Promise<void>;
}

const MARKER = 'installed.json';
const SUFFIX_ATTEMPTS = 3;

function failure(error: unknown): InstallResult {
  if (error instanceof TemplateFileError)
    return {
      ok: false,
      problem:
        error.problem === 'path-too-long'
          ? 'path-too-long'
          : error.problem === 'write'
            ? 'write'
            : 'verify',
      detail: error.message,
    };
  throw error;
}

async function freshDirectory(
  files: TemplateFiles,
  version: string,
  options: InstallOptions,
): Promise<VersionRef | null> {
  for (let attempt = 0; attempt < SUFFIX_ATTEMPTS; attempt += 1) {
    const ref = versionRef({ v: version, dir: `${version}_${options.suffix()}` });
    if (!ref) throw new Error('目录后缀必须是六位小写字母或数字');
    if (!(await files.exists(`fe/${ref.dir}`))) return ref;
  }
  return null;
}

/** `releaseSha256` 是根清单里记的发行清单哈希，写进标记后用来拉黑起不来的发行版。 */
export async function installFrontend(
  files: TemplateFiles,
  version: string,
  releaseSha256: string,
  zip: Uint8Array<ArrayBuffer>,
  options: InstallOptions,
): Promise<InstallResult> {
  if (!isSha256(releaseSha256)) throw new Error('发行清单哈希无效');
  const reading = await readZip(zip);
  if (!reading.ok) return { ok: false, problem: reading.problem };
  const entries = reading.files;
  if (
    !entries.some((entry) => entry.path === 'index.html') ||
    entries.some((entry) => entry.path.toLowerCase() === MARKER)
  )
    return { ok: false, problem: 'entry' };
  try {
    const target = await freshDirectory(files, version, options);
    if (!target) return { ok: false, problem: 'write', detail: '找不到未使用的目录名' };
    const root = `fe/${target.dir}`;
    files.path(`${root}/${MARKER}`, true);
    for (const entry of entries) files.path(`${root}/${entry.path}`);

    const hashes: Record<string, string> = {};
    for (const entry of entries) {
      hashes[entry.path] = await sha256(entry.bytes);
      await files.writeBytes(`${root}/${entry.path}`, entry.bytes);
      await options.pause();
    }
    // 网络盘、U 盘上写入未必可靠，全部读回核对过才写标记。
    for (const entry of entries) {
      const stored = await files.readBytes(`${root}/${entry.path}`);
      if (!stored || (await sha256(stored)) !== hashes[entry.path])
        return { ok: false, problem: 'verify', detail: entry.path };
      await options.pause();
    }
    await files.writeText(
      `${root}/${MARKER}`,
      JSON.stringify({ schema: 1, version, files: hashes, releaseSha256 }),
      { atomic: true },
    );
    return { ok: true, version: target };
  } catch (error) {
    return failure(error);
  }
}
