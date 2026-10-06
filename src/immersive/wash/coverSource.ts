import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../../kit/store.ts';
import { samplePixels } from '../../theme/coverColor.ts';
import { blurSource, SOURCE_SIZE } from './coverWarp.ts';
import { immersiveCoverAtom } from '../cover/immersiveCover.ts';

export interface CoverSource {
  /**
   * 取图时那张封面的身份（`ImmersiveCoverState.token`，下一首是同一张图时不变）：晚到的结果按它丢弃，
   * 也给上层当淡入淡出的 key。
   */
  token: number;
  /** 缩到 `SOURCE_SIZE` 见方、预糊过的封面。 */
  image: ImageData;
}

/** 把封面地址缩成 `size` 见方的 RGBA 像素，失败语义同 `samplePixels`。 */
export type CoverSampler = (
  url: string,
  size: number,
) => Promise<Uint8ClampedArray<ArrayBuffer> | null>;

export interface CoverSourceOptions {
  /** 缺省 `samplePixels`。 */
  sample?: CoverSampler;
}

export interface CoverSourceService {
  dispose(): void;
}

const sourceAtom = atom<CoverSource | null>(null);

/** 封面底色用的源图；缺图、读取失败、读不出像素或没有曲目时为 `null`，底色层不出现。 */
export const coverSourceAtom: Atom<CoverSource | null> = atom((get) => get(sourceAtom));

/**
 * 启动封面底色的源图：跟着 `immersiveCoverAtom` 走，只在封面解码成功（`shown`）后才取，缺图不取。不另问
 * 宿主要地址：对罗盘那张图的同一个 `fb2k://` 地址 `fetch` 成同源位图（`samplePixels`），缩到 `SOURCE_SIZE`
 * 见方，按 `blurSource` 预糊。
 *
 * 新封面还在加载（`loading`）时留着上一张：底色层等新源图备好再换，中途不先退回纸面色。取图进行中封面
 * 已经换掉或服务已经停下，结果丢掉。
 */
export function startCoverSource(
  store: Store,
  options: CoverSourceOptions = {},
): CoverSourceService {
  const sample = options.sample ?? samplePixels;
  store.set(sourceAtom, null);
  let disposed = false;

  const stale = (token: number) => disposed || token !== store.get(immersiveCoverAtom).token;

  async function refresh(token: number, url: string): Promise<void> {
    try {
      const pixels = await sample(url, SOURCE_SIZE);
      if (stale(token)) return;
      store.set(
        sourceAtom,
        pixels
          ? { token, image: new ImageData(blurSource(pixels, SOURCE_SIZE), SOURCE_SIZE) }
          : null,
      );
    } catch {
      if (!stale(token)) store.set(sourceAtom, null);
    }
  }

  function follow(): void {
    const { token, status, url } = store.get(immersiveCoverAtom);
    if (store.get(sourceAtom)?.token === token) return;
    if (status === 'shown' && url) void refresh(token, url);
    else if (status !== 'loading') store.set(sourceAtom, null);
  }

  const off = store.sub(immersiveCoverAtom, follow);
  follow();

  return {
    dispose() {
      disposed = true;
      off();
    },
  };
}
