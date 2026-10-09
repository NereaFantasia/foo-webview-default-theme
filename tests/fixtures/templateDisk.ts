import type { FakeHost } from './fakeHost.ts';
import { hostFailure } from './hostAnswers.ts';

export const TEMPLATE_DIRECTORY = 'E:\\FB2K\\profile\\webview-ui\\default';

/**
 * 给宿主替身装上一个内存里的模板目录：文件按相对路径存成字节，file.write 的 binary 模式照宿主解码 `base64:` 前缀，
 * 原子写与否记在 `atomic` 里。`failWrites`、`failReads`、`failDeletes` 里的相对路径答 OPERATION_FAILED，
 * `corrupt` 里的相对路径读回时换成别的字节。修改时间取自 `tick` 推进的时钟，照宿主截到整秒。
 */
export function answerTemplateDisk(
  host: FakeHost,
  initial: Readonly<Record<string, string>> = {},
  directory = TEMPLATE_DIRECTORY,
) {
  const files = new Map<string, Uint8Array>(
    Object.entries(initial).map(([path, text]) => [path, new TextEncoder().encode(text)]),
  );
  const modified = new Map<string, number>();
  const atomic = new Map<string, boolean>();
  const failWrites = new Set<string>();
  const failReads = new Set<string>();
  const failDeletes = new Set<string>();
  const corrupt = new Set<string>();
  const removedAsync: string[] = [];
  let clock = 0;

  function relative(value: unknown): string {
    if (value === directory) return '';
    if (typeof value !== 'string' || !value.startsWith(`${directory}\\`))
      throw new Error(`路径越过模板目录：${String(value)}`);
    return value.slice(directory.length + 1).replaceAll('\\', '/');
  }
  function bytesOf(content: string, binary: boolean): Uint8Array {
    if (binary && content.startsWith('base64:'))
      return new Uint8Array(Buffer.from(content.slice(7), 'base64'));
    return new TextEncoder().encode(content);
  }
  function inside(path: string): string[] {
    const prefix = path ? `${path}/` : '';
    return [...files.keys()].filter((key) => key.startsWith(prefix));
  }
  function store(path: string, bytes: Uint8Array): void {
    files.set(path, bytes);
    modified.set(path, Math.floor(clock / 1000) * 1000);
  }
  for (const path of files.keys()) modified.set(path, 0);

  host.answer('file.read', (params) => {
    const path = relative(params['path']);
    const bytes = files.get(path);
    if (failReads.has(path) || !bytes) return hostFailure('OPERATION_FAILED');
    const stored = corrupt.has(path) ? new Uint8Array([...bytes, 0]) : bytes;
    const content =
      params['encoding'] === 'binary'
        ? Buffer.from(stored).toString('base64')
        : new TextDecoder().decode(stored);
    return { success: true, content, size: stored.length };
  });
  host.answer('file.exists', (params) => {
    const path = relative(params['path']);
    const isFile = files.has(path);
    const isDirectory = inside(path).length > 0;
    return { success: true, exists: isFile || isDirectory, isFile, isDirectory };
  });
  host.answer('file.write', (params) => {
    const path = relative(params['path']);
    if (failWrites.has(path)) return hostFailure('OPERATION_FAILED', '磁盘已满');
    const bytes = bytesOf(String(params['content']), params['encoding'] === 'binary');
    const previous = params['append'] === true ? files.get(path) : undefined;
    if (previous) {
      const combined = new Uint8Array(previous.length + bytes.length);
      combined.set(previous);
      combined.set(bytes, previous.length);
      store(path, combined);
    } else store(path, bytes);
    atomic.set(path, params['atomic'] === true);
    return { success: true, bytesWritten: bytes.length };
  });
  host.answer('file.move', (params) => {
    const source = relative(params['source']);
    const destination = relative(params['destination']);
    const bytes = files.get(source);
    if (!bytes) return hostFailure('NOT_FOUND');
    if (failWrites.has(destination)) return hostFailure('OPERATION_FAILED');
    store(destination, bytes);
    files.delete(source);
    return {
      success: true,
      source: String(params['source']),
      destination: String(params['destination']),
    };
  });
  host.answer('file.getInfo', (params) => {
    const path = relative(params['path']);
    const bytes = files.get(path);
    if (bytes)
      return {
        success: true,
        exists: true,
        isFile: true,
        isDirectory: false,
        size: bytes.length,
        modified: modified.get(path) ?? 0,
      };
    if (inside(path).length)
      return { success: true, exists: true, isFile: false, isDirectory: true };
    return { success: true, exists: false };
  });
  host.answer('file.list', (params) => {
    const path = relative(params['path']);
    const prefix = path ? `${path}/` : '';
    const names = inside(path).map((key) => key.slice(prefix.length));
    if (!names.length) return hostFailure('NOT_FOUND');
    const children = (folder: boolean) => [
      ...new Set(
        names
          .filter((name) => name.includes('/') === folder)
          .map((name) => name.split('/')[0] ?? ''),
      ),
    ];
    return {
      success: true,
      files: children(false),
      directories: children(true),
      items: children(false),
    };
  });
  host.answer('file.delete', (params) => {
    const path = relative(params['path']);
    if (failDeletes.has(path)) return hostFailure('OPERATION_FAILED', '文件被占用');
    if (files.delete(path)) return { success: true };
    if (inside(path).length) return hostFailure('OPERATION_FAILED', '目录不是空的');
    return hostFailure('NOT_FOUND');
  });
  host.answer('file.deleteAsync', (params) => {
    const paths = Array.isArray(params['paths']) ? params['paths'].map(relative) : [];
    for (const path of paths) {
      removedAsync.push(path);
      for (const key of [path, ...inside(path)]) files.delete(key);
    }
    return { success: true, operationId: 'op-1', totalCount: paths.length };
  });

  return {
    files,
    atomic,
    failWrites,
    failReads,
    failDeletes,
    corrupt,
    removedAsync,
    tick: (ms: number) => {
      clock += ms;
    },
    write: (path: string, text: string) => store(path, new TextEncoder().encode(text)),
    text: (path: string) => {
      const bytes = files.get(path);
      return bytes ? new TextDecoder().decode(bytes) : undefined;
    },
  };
}
