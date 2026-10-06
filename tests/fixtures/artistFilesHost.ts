import { hostFailure } from './hostAnswers.ts';
import { installFakeHost } from './unitHost.ts';

export const ARTIST_PROFILE = 'E:\\FB2K\\test-profile';

/** 完整路径：profile 下 `webview-ui-artists` 目录里的 `file`。 */
export function artistFile(file: string): string {
  return `${ARTIST_PROFILE}\\webview-ui-artists\\${file}`;
}

/** 宿主替身：profile 路径固定，文件读写落在内存里的 `files`。 */
export function installArtistFiles(initial: Readonly<Record<string, string>> = {}) {
  const host = installFakeHost();
  const files = new Map<string, string>(Object.entries(initial));
  host.answer('misc.getProfilePath', {
    success: true,
    path: ARTIST_PROFILE,
    value: ARTIST_PROFILE,
  });
  host.answer('file.read', (params) => {
    const text = files.get(String(params['path']));
    return text === undefined
      ? hostFailure('NOT_FOUND')
      : { success: true, content: text, size: text.length };
  });
  host.answer('file.write', (params) => {
    const path = String(params['path']);
    files.set(path, String(params['content']));
    return {
      success: true,
      path,
      bytesWritten: new TextEncoder().encode(String(params['content'])).length,
    };
  });
  return { host, files };
}
