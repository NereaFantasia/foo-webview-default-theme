import type { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../host/hostCall.ts';
import type { TemplateFiles } from './templateFiles.ts';

/**
 * 共用检测。主窗口在 `state/sessions/<启动标识>.json` 写运行标记，启动时写一次，之后每 5 分钟刷新，
 * 退出前尽量删掉。刷新后若别的标记的修改时间晚于本标记第一次写入的时间，说明这次启动之后还有另一个
 * foobar2000 在用这个模板目录，自动更新与清理随即停下。两个时间都取自同一个文件系统，不用本机时钟；
 * 修改时间只精确到整秒（FAT32、exFAT 上是 2 秒），对方恰好落在同一秒时要到下一轮才发现。
 * 崩溃留下的、浏览器进程重建前的旧标记不再刷新，不会触发；清理时顺带删掉它们。
 */

export type RunMarkerHost = {
  readonly file: Pick<typeof fb.file, 'write' | 'getInfo' | 'list' | 'delete'>;
  readonly on: typeof fb.on;
};
export interface RunMarker {
  /** 发现过另一个 foobar2000 就一直为真，直到这次运行结束。 */
  shared(): boolean;
  /** 写入或刷新一次，再比对别的标记；任何一步失败都按「没发现」处理，下一轮再看。 */
  refresh(): Promise<void>;
  /** 早于本标记第一次写入、已不再刷新的标记，相对模板目录的路径。 */
  stale(): Promise<string[]>;
  dispose(): void;
}

const DIRECTORY = 'state/sessions';
const REFRESH_MS = 5 * 60_000;
const NAME = /^[0-9a-f-]{36}\.json$/;

export function startRunMarker(
  files: TemplateFiles,
  host: RunMarkerHost,
  id: string,
  onShared?: () => void,
): RunMarker {
  const own = `${DIRECTORY}/${id}.json`;
  let firstWritten: number | null = null;
  let shared = false;
  let disposed = false;

  async function modified(relative: string): Promise<number | null> {
    const info = await settle(() => host.file.getInfo(files.path(relative)));
    return info && info.success !== false && info.exists && typeof info.modified === 'number'
      ? info.modified
      : null;
  }
  async function others(): Promise<{ path: string; modified: number }[]> {
    const listing = await settle(() => host.file.list(files.path(DIRECTORY)));
    if (!listing || listing.success === false) return [];
    const found = [];
    for (const name of listing.files) {
      const path = `${DIRECTORY}/${name}`;
      if (!NAME.test(name) || path === own) continue;
      const time = await modified(path);
      if (time !== null) found.push({ path, modified: time });
    }
    return found;
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    const written = await settle(() =>
      host.file.write(files.path(own), JSON.stringify({ schema: 1, id })),
    );
    if (disposed || !written || written.success === false) return;
    firstWritten ??= await modified(own);
    if (disposed || firstWritten === null) return;
    const start = firstWritten;
    const found = await others();
    if (!disposed && !shared && found.some((marker) => marker.modified > start)) {
      shared = true;
      onShared?.();
    }
  }

  const timer = setInterval(() => void refresh(), REFRESH_MS);
  const off = host.on('app:beforeQuit', () => {
    void settle(() => host.file.delete(files.path(own), { moveToTrash: false }));
  });

  return {
    shared: () => shared,
    refresh,
    async stale() {
      if (firstWritten === null) return [];
      const start = firstWritten;
      return (await others())
        .filter((marker) => marker.modified < start)
        .map((marker) => marker.path);
    },
    dispose() {
      disposed = true;
      clearInterval(timer);
      off();
    },
  };
}
