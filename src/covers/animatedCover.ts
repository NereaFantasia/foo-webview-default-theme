import { atom, type Atom } from 'jotai/vanilla';
import { trackAbilities } from '../host/trackOrigin.ts';
import { settle } from '../host/hostCall.ts';
import { defineLocalPref, ON_OFF, type PrefStorage } from '../kit/localPref.ts';
import type { Store } from '../kit/store.ts';
import { reducedMotionAtom } from '../motion/reducedMotion.ts';
import { currentTrackAtom } from '../playback/playback.ts';
import { trackKeyOf } from '../playback/playbackContract.ts';
import { playbackConnectedAtom } from '../playback/playerAtoms.ts';
import { scanAnimation, type AnimationScan } from './animatedImage.ts';
import type { TrackArtwork } from './trackArtwork.ts';

export const ANIMATED_COVER_STORAGE_KEY = 'default-theme.cover.animated.v1';

/** 「动态封面」开关，缺省开：封面是动图时在大封面上播放；随这台机器记住 */
export const ANIMATED_COVER_PREF = defineLocalPref<boolean>({
  key: ANIMATED_COVER_STORAGE_KEY,
  fallback: true,
  ...ON_OFF,
});

/**
 * 动图整张读进内存的上限，字节：超过的按静图。封面按原尺寸解码，几十兆的动图会让页面卡住，
 * 也留不下合理的内存占用
 */
const MAX_BYTES = 12 * 1024 * 1024;
/** 记住「不是动图」的曲目数上限：只为同一首反复进出页面时不再读一遍，满了清空重记 */
const KNOWN_LIMIT = 500;

export interface AnimatedCover {
  /** 这张图属于哪一首，口径同 `trackKeyOf` */
  readonly key: string;
  /** 动图的 blob 地址，服务换曲或停掉时收回 */
  readonly url: string;
}

const coverAtom = atom<AnimatedCover | null>(null);
/** 此刻有几处界面要画动图；没有时服务不读原图 */
const wantedAtom = atom(0);

/** 正在播放的这一首的动图；不是动图、没读到或还在读时为 `null` */
export const animatedCoverAtom: Atom<AnimatedCover | null> = atom((get) => get(coverAtom));

/** 界面要画动图时登记，卸载时调返回的函数撤销 */
export function wantAnimatedCover(store: Store): () => void {
  store.set(wantedAtom, (count) => count + 1);
  return () => store.set(wantedAtom, (count) => count - 1);
}

/** 拼成一块新缓冲区；返回类型写死 `ArrayBuffer`，`Blob` 不收可能是共享缓冲区的视图 */
function joined(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

/**
 * 读取封面数据块；若前几个字节已可判定为静态图，立即中止请求，仅对动图读取完整内容。
 * 若需更多字节辅助判定，则在读取总量成倍增长时重新扫描，避免频繁重复解析
 */
async function readAnimated(
  url: string,
  request: typeof fetch,
  signal: AbortSignal,
): Promise<{ readonly bytes: Uint8Array<ArrayBuffer>; readonly type: string } | null> {
  const response = await request(url, { signal });
  if (!response.ok || !response.body) return null;
  const reader = response.body.getReader();
  let chunks: Uint8Array[] = [];
  let total = 0;
  let verdict: AnimationScan = 'more';
  let rescanAt = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      chunks.push(value);
      total += value.length;
    }
    if (total > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    if (verdict === 'more' && (done || total >= rescanAt)) {
      const head = joined(chunks);
      chunks = [head];
      verdict = scanAnimation(head);
      rescanAt = total * 2;
      if (verdict === 'still') {
        await reader.cancel();
        return null;
      }
    }
    if (done) break;
  }
  return verdict === 'animated'
    ? { bytes: joined(chunks), type: response.headers.get('content-type') ?? '' }
    : null;
}

export interface AnimatedCoverOptions {
  /** 取曲目封面地址；不带 `maxSize` 问，宿主交原文件 */
  readonly artwork: Pick<TrackArtwork, 'urlOf'>;
  readonly request?: typeof fetch;
  readonly storage?: PrefStorage | null;
}

/**
 * 正在播放的这一首的封面是 GIF、WebP、APNG 动图时，把原文件读进内存、交出能放的 blob 地址
 *
 * 封面各处请求都带 `maxSize`，宿主为缩小会把大于它的图重新编码成 JPEG，动画就没了；不带 `maxSize` 才是原文件，
 * 所以动图另走这一条。只在界面登记了要画（`wantAnimatedCover`）、开关开着、没要求减弱动效、本地曲目时读：
 * 在线曲目的封面是上游给的缩略图，宿主也不替它取。同一首读过且不是动图的记下来，再进页面不重读
 */
export function startAnimatedCover(
  store: Store,
  options: AnimatedCoverOptions,
): { dispose(): void } {
  const request = options.request ?? ((...args) => fetch(...args));
  ANIMATED_COVER_PREF.load(store, options.storage);
  const known = new Set<string>();
  let disposed = false;
  let generation = 0;
  let followed = '';
  let controller: AbortController | undefined;

  function publish(next: AnimatedCover | null): void {
    const previous = store.get(coverAtom);
    if (previous && previous.url !== next?.url) URL.revokeObjectURL(previous.url);
    store.set(coverAtom, next);
  }

  async function load(path: string, key: string, mine: number): Promise<void> {
    const answer = await settle(() => options.artwork.urlOf(path, 'front'));
    if (disposed || mine !== generation) return;
    const url = answer && answer.success !== false && answer.available ? answer.dataUrl : '';
    const own = new AbortController();
    controller = own;
    let found: Awaited<ReturnType<typeof readAnimated>> = null;
    if (url) {
      try {
        found = await readAnimated(url, request, own.signal);
      } catch {
        // 读不到不记成静图：下次进页面再试
        return;
      }
    }
    if (disposed || mine !== generation) return;
    if (!found) {
      if (known.size >= KNOWN_LIMIT) known.clear();
      known.add(key);
      return;
    }
    publish({ key, url: URL.createObjectURL(new Blob([found.bytes], { type: found.type })) });
  }

  function follow(): void {
    const track = store.get(currentTrackAtom);
    // 要宿主能取封面、又能同步打开文件：在线曲目与网络流都不满足
    const abilities = track ? trackAbilities(track.path) : null;
    const wanted =
      track !== null &&
      abilities?.hostArtwork === true &&
      abilities.opensLocally &&
      store.get(playbackConnectedAtom) &&
      store.get(wantedAtom) > 0 &&
      store.get(ANIMATED_COVER_PREF.atom) &&
      !store.get(reducedMotionAtom);
    const key = wanted ? trackKeyOf(track) : '';
    if (key === followed) return;
    followed = key;
    generation += 1;
    controller?.abort();
    publish(null);
    if (wanted && !known.has(key)) void load(track.handle, key, generation);
  }

  const stops = [
    currentTrackAtom,
    playbackConnectedAtom,
    wantedAtom,
    ANIMATED_COVER_PREF.atom,
    reducedMotionAtom,
  ].map((source) => store.sub(source, follow));
  follow();
  return {
    dispose() {
      disposed = true;
      generation += 1;
      controller?.abort();
      stops.forEach((stop) => stop());
      publish(null);
    },
  };
}
