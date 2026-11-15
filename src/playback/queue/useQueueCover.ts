import { useAtomValueRawSync } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import { useEffect, useMemo, type RefObject } from 'react';
import { useService } from '../../kit/useService.ts';
import { queueKey } from './queueServices.ts';
import { queueCoverKey, queueCoverSize, queueCoverUrlsAtom } from './queueCovers.ts';

/**
 * 行只在可见时取图；没有观察目标时用于常驻的当前曲目预览。`preview` 给数字时是要的边长（物理像素），
 * 显示得比预览档还大的封面（Coverflow 正中那张）自己按显示尺寸要图。`album` 是行所属专辑的键，同专辑的
 * 各行共用一次取图；预览与 Coverflow 要的是这一首自己的图，不给
 */
export function useQueueCover(
  path: string,
  preview: boolean | number,
  target?: RefObject<HTMLElement | null>,
  album?: string | null,
) {
  const { covers } = useService(queueKey);
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
  const size = typeof preview === 'number' ? preview : queueCoverSize(preview, ratio);
  // 每行只订阅自己的地址；另一张封面答回时，不让整段可见曲目一起重画
  const coverAtom = useMemo(
    () =>
      atom((get) => {
        const urls = get(queueCoverUrlsAtom);
        return (
          urls.get(queueCoverKey(path, size)) ??
          (preview ? urls.get(queueCoverKey(path, queueCoverSize(false, ratio))) : null) ??
          null
        );
      }),
    [path, size, preview, ratio],
  );
  const cover = useAtomValueRawSync(coverAtom);
  useEffect(() => {
    if (!path) return;
    if (!target) return covers.watch(path, size, album ?? undefined);
    const element = target.current;
    if (!element) return;
    let release: (() => void) | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !release)
          release = covers.watch(path, size, album ?? undefined);
        else if (!entry.isIntersecting && release) {
          release();
          release = undefined;
        }
      },
      { rootMargin: '96px' },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      release?.();
    };
  }, [covers, path, size, target, album]);
  return cover;
}

/**
 * 只要这一档尺寸的图：没到就是 `null`，不拿别的档垫（`useQueueCover` 在预览档没到时会退回行缩略图，
 * 那一档比调用方手里已有的图还小时，垫上去反而更糊）。`size` 是要的边长（物理像素），`path` 为空不取
 */
export function useExactQueueCover(path: string, size: number): string | null {
  const { covers } = useService(queueKey);
  const coverAtom = useMemo(
    () => atom((get) => get(queueCoverUrlsAtom).get(queueCoverKey(path, size)) ?? null),
    [path, size],
  );
  const cover = useAtomValueRawSync(coverAtom);
  useEffect(() => {
    if (!path) return;
    return covers.watch(path, size);
  }, [covers, path, size]);
  return cover;
}
