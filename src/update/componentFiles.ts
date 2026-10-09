import type { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../host/hostCall.ts';
import { sha256 } from './contract.ts';
import { TemplateFileError, type TemplateFiles } from './templateFiles.ts';

export interface ComponentInstallOptions {
  readonly suffix: () => string;
  readonly pause: () => Promise<void>;
  readonly current: () => void;
  /** 大文件经模板虚拟源读取，避免通过桥传递整份 Base64。 */
  readonly readLocal: (relative: string, size: number) => Promise<Uint8Array<ArrayBuffer>>;
  readonly progress?: (completed: number, total: number) => void;
}

export async function componentDirectories(
  files: TemplateFiles,
  host: Pick<typeof fb.file, 'list'>,
  folder: string,
  current: () => void = () => {},
): Promise<string[]> {
  if (!(await files.exists(folder))) return [];
  current();
  const answer = await settle(() => host.list(files.path(folder)));
  current();
  if (!answer || answer.success === false) throw new TemplateFileError('read', folder);
  return answer.directories;
}

export async function freshComponentDirectory(
  files: TemplateFiles,
  prefix: string,
  options: Pick<ComponentInstallOptions, 'suffix'>,
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const suffix = options.suffix();
    if (!/^[a-z0-9]{6}$/.test(suffix)) throw new Error('版本目录后缀无效');
    const directory = `${prefix}_${suffix}`;
    if (!(await files.exists(directory))) return directory;
  }
  throw new TemplateFileError('write', prefix, '版本目录已存在');
}

export async function verifiedLocal(
  options: ComponentInstallOptions,
  relative: string,
  expected: { readonly size: number; readonly sha256: string },
): Promise<boolean> {
  try {
    const bytes = await options.readLocal(relative, expected.size);
    options.current();
    const valid = bytes.length === expected.size && (await sha256(bytes)) === expected.sha256;
    options.current();
    return valid;
  } catch {
    options.current();
    return false;
  }
}

/** 响应长度超过声明就停止读取，不将不受限的响应全部装进内存。 */
export async function readLocalComponent(
  relative: string,
  size: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!/^(?:rt|be)\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(relative))
    throw new Error('组件文件路径无效');
  const response = await fetch(new URL(`/${relative}`, location.href), {
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
  });
  if (!response.ok || !response.body) throw new Error('无法读取已安装的组件');
  const reader = response.body.getReader();
  const bytes = new Uint8Array(size);
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > size) throw new Error('组件文件长度不符');
      bytes.set(value, offset);
      offset += value.length;
    }
    if (offset !== size) throw new Error('组件文件不完整');
    return bytes;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
