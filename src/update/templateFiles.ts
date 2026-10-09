import type { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../host/hostCall.ts';

/**
 * 模板目录内的文件读写。路径一律相对模板目录，用 `/` 分隔；指针与状态里只存相对路径，模板目录每次
 * 启动从页面来源重新取。宿主的文件调用是同步接口，在 foobar2000 主线程上执行，大批写入由调用方
 * 在文件之间让出时间。
 */

/** foobar2000.exe 没有声明长路径支持，宿主文件接口的路径上限是 259 个字符。 */
const MAX_PATH = 259;
/** 原子写的临时文件 `.~<进程号>-<序号>.tmp` 与目标同目录，按这个长度给它留位置。 */
const ATOMIC_TEMP_NAME = 40;
/** btoa 一次处理的字节数；整段转换会让参数列表过长。 */
const BASE64_CHUNK = 0x8000;

export type TemplateFileHost = Pick<typeof fb.file, 'read' | 'write' | 'exists'>;
export type TemplateFileProblem = 'path-too-long' | 'read' | 'write';

/** 本目录的模块也由 Node 直接加载，Node 只剥类型，所以不用构造参数属性。 */
export class TemplateFileError extends Error {
  readonly problem: TemplateFileProblem;
  readonly path: string;

  constructor(problem: TemplateFileProblem, path: string, detail = '') {
    super(`${problem}: ${path}${detail ? `（${detail}）` : ''}`);
    this.problem = problem;
    this.path = path;
  }
}

export interface TemplateFiles {
  /** 模板目录的绝对路径，不带结尾的分隔符。 */
  readonly directory: string;
  /** 换算成宿主路径；超长时抛 path-too-long。atomic 为真时同时为原子写的临时文件留位置。 */
  path(relative: string, atomic?: boolean): string;
  /** 文件不存在时答 null；读失败、或分不清是否存在时抛错。超长路径上宿主答「不存在」，这里先按长度拦下。 */
  readText(relative: string): Promise<string | null>;
  readBytes(relative: string): Promise<Uint8Array<ArrayBuffer> | null>;
  writeText(relative: string, text: string, options?: { readonly atomic?: boolean }): Promise<void>;
  writeBytes(
    relative: string,
    bytes: Uint8Array,
    options?: { readonly append?: boolean; readonly atomic?: boolean },
  ): Promise<void>;
  exists(relative: string): Promise<boolean>;
}

export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += BASE64_CHUNK)
    text += String.fromCharCode(...bytes.subarray(at, at + BASE64_CHUNK));
  return btoa(text);
}
function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** `check` 在每次宿主调用前后执行，所属服务已释放时由它抛错，停下后续写入。 */
export function templateFiles(
  host: TemplateFileHost,
  directory: string,
  check: () => void = () => {},
): TemplateFiles {
  const base = directory.replace(/[\\/]+$/, '');

  function path(relative: string, atomic = false): string {
    if (!relative || relative.startsWith('/') || relative.split('/').some((part) => !part))
      throw new Error(`相对路径无效：${relative}`);
    const target = `${base}\\${relative.replaceAll('/', '\\')}`;
    const parent = target.lastIndexOf('\\') + 1;
    if (target.length > MAX_PATH || (atomic && parent + ATOMIC_TEMP_NAME > MAX_PATH))
      throw new TemplateFileError('path-too-long', relative);
    return target;
  }

  async function exists(relative: string): Promise<boolean> {
    const target = path(relative);
    check();
    const answer = await settle(() => host.exists(target));
    check();
    if (!answer || answer.success === false)
      throw new TemplateFileError('read', relative, answer?.error);
    return answer.exists;
  }

  async function read(relative: string, binary: boolean): Promise<string | null> {
    const target = path(relative);
    check();
    const answer = await settle(() =>
      binary ? host.read(target, { encoding: 'binary' }) : host.read(target),
    );
    check();
    if (answer && answer.success !== false) return answer.content;
    if (!(await exists(relative))) return null;
    throw new TemplateFileError('read', relative, answer?.error);
  }

  async function write(
    relative: string,
    content: string,
    binary: boolean,
    atomic: boolean,
    append = false,
  ) {
    const target = path(relative, atomic);
    check();
    const answer = await settle(() =>
      host.write(
        target,
        content,
        binary
          ? {
              encoding: 'binary',
              ...(append ? { append: true } : {}),
              ...(atomic ? { atomic: true } : {}),
            }
          : { atomic },
      ),
    );
    check();
    if (!answer || answer.success === false)
      throw new TemplateFileError('write', relative, answer?.error);
  }

  return {
    directory: base,
    path,
    exists,
    readText: (relative) => read(relative, false),
    async readBytes(relative) {
      const text = await read(relative, true);
      if (text === null) return null;
      const bytes = fromBase64(text);
      if (!bytes) throw new TemplateFileError('read', relative, '宿主返回的内容不是 Base64');
      return bytes;
    },
    writeText: (relative, text, options) => write(relative, text, false, options?.atomic ?? false),
    writeBytes: (relative, bytes, options) =>
      write(relative, `base64:${toBase64(bytes)}`, true, options?.atomic ?? false, options?.append),
  };
}
