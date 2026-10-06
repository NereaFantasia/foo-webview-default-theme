import { onTestFinished, vi } from 'vitest';
import type { HostResponse } from './fakeHost.ts';

// 沉浸视图封面几份单测共用的应答与桩：`artwork.getFb2kUrlByPath` 与 `artwork.getAvailableArtwork` 的
// 几种应答、可由测试决定何时兑现的 Promise，以及 Node 里没有的 `ImageData`。

type CoverAnswer = HostResponse<'artwork.getFb2kUrlByPath'>;
type ListedArt = Extract<HostResponse<'artwork.getAvailableArtwork'>, { success: true }>;

/** 宿主给 `path` 拼的地址，与宿主一样把整条路径编码进查询串。 */
export function coverUrl(path: string): string {
  return `fb2k://artwork/?path=${encodeURIComponent(path)}`;
}

/** 地址拼出来了；`url` 缺省按路径拼。 */
export function foundCover(path: string, url: string = coverUrl(path)): CoverAnswer {
  return { success: true, available: true, type: 'front', path, dataUrl: url };
}

/** 应答里没有地址。 */
export function noCover(path: string): CoverAnswer {
  return { success: true, available: false, type: 'front', path, dataUrl: '' };
}

/** 文件内嵌了 `types` 这几类图，目录里另有 `sources`（`folder:<名>`）。 */
export function listedArt(types: readonly string[], sources: readonly string[] = []): ListedArt {
  return {
    success: true,
    available: types.length > 0,
    artworks: types.map((type) => ({ type, source: 'embedded' })),
    sources: [...(types.length > 0 ? ['embedded'] : []), ...sources],
  };
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: Error): void;
}

export function defer<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** 只记像素与尺寸的 `ImageData`，按浏览器的构造签名 `(data, width, height?)`。 */
export class FakeImageData {
  readonly colorSpace = 'srgb';
  readonly height: number;

  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    height?: number,
  ) {
    this.height = height ?? data.length / 4 / width;
  }
}

/** 在当前测试里把全局的 `ImageData` 换成 `FakeImageData`，测试结束时还原。 */
export function installImageData(): void {
  vi.stubGlobal('ImageData', FakeImageData);
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
}
