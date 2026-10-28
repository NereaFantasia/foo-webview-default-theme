import type { Track } from 'foo-webview-sdk';
import { atom, type Atom } from 'jotai/vanilla';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import { MUSIC_TRACKS_LIMIT } from '../server/musicProtocol.ts';
import { type MusicQuality, type MusicRef, type MusicTrack } from '../server/musicObjects.ts';
import type { MusicClient } from './musicClient.ts';
import { readOnlineAddress } from '../server/onlineAddress.ts';

/** 记住的条数上限，超出时先丢最早记下的；队列一次最多带 2000 首在线曲目 */
const MAX_ENTRIES = 5000;

/** 身份只看平台与 ID，与端口、档位无关 */
export function onlineKey(ref: MusicRef): string {
  return `${ref.platform}:${ref.id}`;
}

type OnlineFields = 'path' | 'title' | 'artist' | 'artists' | 'album' | 'duration';

/** 值为 null 表示后端答没有这一首：上游已下架，或 LX 的记录已淘汰 */
const infoAtom = atom<ReadonlyMap<string, MusicTrack | null>>(new Map());

/** 按 `onlineKey` 查已取到的展示信息；还没取过的不在里面 */
export const onlineTracksAtom: Atom<ReadonlyMap<string, MusicTrack | null>> = atom((get) =>
  get(infoAtom),
);

/** 占位地址对应的展示信息；不是在线曲目、还没取到或后端答没有时为 null */
export function onlineInfoOf(
  path: string,
  tracks: ReadonlyMap<string, MusicTrack | null>,
): MusicTrack | null {
  const address = readOnlineAddress(path);
  return (address && tracks.get(onlineKey(address.ref))) ?? null;
}

/** 网易云封面最小的一档边长，设备像素；往上每档翻倍 */
const COVER_STEP_PX = 128;

/**
 * 在线封面按设备像素要图；不给边长时取原图。网易云的图床收 `param=宽y高`，边长向上取到 128、256、512……
 * 里的一档：显示尺寸相近的几处（如结果页与队列的行）要的是同一个地址，图床答的缓存期是一年，换个地方显示
 * 直接用浏览器缓存里的那份。它不查 Referer，也答跨源许可，页面直接加载
 * ponytail: 只处理网易云，接入要 Referer 的平台时改经宿主带 Referer 取
 */
export function onlineCoverUrl(url: string, px?: number): string {
  try {
    const address = new URL(url);
    if (px && px > 0 && address.hostname.endsWith('.music.126.net')) {
      const side = COVER_STEP_PX * 2 ** Math.max(0, Math.ceil(Math.log2(px / COVER_STEP_PX)));
      address.searchParams.set('param', `${side}y${side}`);
    }
    return address.href;
  } catch {
    return url;
  }
}

/**
 * 把在线曲目的展示信息盖在宿主报的标签上：fb2k 对占位地址只报地址或流里自带的标签。时长以宿主读到的为准，
 * 它还没读到时用上游给的。不是在线曲目或还没有展示信息时原样交回
 */
export function withOnlineTrack<T extends Pick<Track, OnlineFields>>(
  tagged: T,
  tracks: ReadonlyMap<string, MusicTrack | null>,
): T {
  const info = onlineInfoOf(tagged.path, tracks);
  if (!info) return tagged;
  const artists = info.artists.map((artist) => artist.name);
  return {
    ...tagged,
    title: info.title,
    artist: artists.join(', '),
    artists,
    album: info.album?.title ?? '',
    duration:
      tagged.duration > 0 || info.durationMs === null ? tagged.duration : info.durationMs / 1000,
  };
}

export interface OnlineTracksService {
  /** 补取这些曲目里还没取过的展示信息；已取过或正在取的不重复取。取不到时下次再要会重取 */
  want(refs: readonly MusicRef[]): void;
  /** 手上已有展示信息的曲目（搜索结果之类）直接记下，起播后不必再向后端要 */
  remember(items: readonly MusicTrack[]): void;
  dispose(): void;
}

/**
 * `port` 是本地后端连上的端口。页面载入时后端往往还没连上，那时的请求当即失败；连上或换端口后，
 * 把取不到的几首再取一次，不必等页面重新挂上再来要
 */
export function startOnlineTracks(
  store: Store,
  client: Pick<MusicClient, 'tracks'>,
  port?: Atom<number | null>,
): OnlineTracksService {
  store.set(infoAtom, new Map());
  const lifetime = new AbortController();
  const pending = new Set<string>();
  const missed = new Map<string, MusicRef>();

  /** 新记下的排到最后，超出上限时从最早的丢起 */
  function record(entries: Iterable<readonly [string, MusicTrack | null]>) {
    const next = new Map(store.get(infoAtom));
    for (const [key, value] of entries) {
      missed.delete(key);
      next.delete(key);
      next.set(key, value);
    }
    for (const key of next.keys()) {
      if (next.size <= MAX_ENTRIES) break;
      next.delete(key);
    }
    store.set(infoAtom, next);
  }

  async function fetchBatch(platform: MusicRef['platform'], ids: readonly string[]) {
    try {
      const items = await client.tracks({ platform, ids }, { signal: lifetime.signal });
      const found = new Map(items.map((item) => [onlineKey(item.ref), item]));
      if (!lifetime.signal.aborted)
        record(
          ids.map((id) => {
            const key = onlineKey({ platform, id });
            return [key, found.get(key) ?? null] as const;
          }),
        );
    } catch {
      // 后端暂不可用之类：不记成没有，后端连上或下次再要时重取
      if (!lifetime.signal.aborted)
        for (const id of ids) missed.set(onlineKey({ platform, id }), { platform, id });
    } finally {
      for (const id of ids) pending.delete(onlineKey({ platform, id }));
    }
  }

  const stop = port
    ? store.sub(port, () => {
        if (store.get(port) === null || missed.size === 0) return;
        const refs = [...missed.values()];
        missed.clear();
        service.want(refs);
      })
    : undefined;
  const service: OnlineTracksService = {
    want(refs) {
      if (lifetime.signal.aborted) return;
      const known = store.get(infoAtom);
      const wanted = new Map<MusicRef['platform'], string[]>();
      for (const ref of refs) {
        const key = onlineKey(ref);
        if (known.has(key) || pending.has(key)) continue;
        pending.add(key);
        wanted.set(ref.platform, [...(wanted.get(ref.platform) ?? []), ref.id]);
      }
      for (const [platform, ids] of wanted)
        for (let start = 0; start < ids.length; start += MUSIC_TRACKS_LIMIT)
          void fetchBatch(platform, ids.slice(start, start + MUSIC_TRACKS_LIMIT));
    },
    remember(items) {
      if (!lifetime.signal.aborted)
        record(items.map((item) => [onlineKey(item.ref), item] as const));
    },
    dispose() {
      lifetime.abort();
      stop?.();
    },
  };
  return service;
}

export const onlineTracksKey = serviceKey<OnlineTracksService>('onlineTracks');

/** 信息页「来源」一节：在线曲目是哪个平台的哪一首、按哪一档加进来的，取到的是不是第三方补全 */
export interface OnlineSource {
  readonly ref: MusicRef;
  readonly quality: MusicQuality;
  readonly unblocked: boolean;
}

/** 不是在线曲目时为 null；`unblocked` 是 `onlineUnblockedAtom` 的值 */
export function onlineSourceOf(path: string, unblocked: ReadonlySet<string>): OnlineSource | null {
  const address = readOnlineAddress(path);
  return address
    ? {
        ref: address.ref,
        quality: address.quality,
        unblocked: unblocked.has(onlineKey(address.ref)),
      }
    : null;
}
