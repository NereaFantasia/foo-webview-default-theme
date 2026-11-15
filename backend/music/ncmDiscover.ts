import {
  MUSIC_DISCOVER_LIMITS,
  type MusicBanner,
  type MusicChart,
  type MusicChartRegion,
  type MusicDiscoverArea,
  type MusicDiscoverKind,
  type MusicDiscoverRequest,
} from '../../src/server/musicDiscover.ts';
import type { MusicAlbum, MusicPlaylist, MusicTrack } from '../../src/server/musicObjects.ts';
import { isRecord } from './lxSource.ts';
import { MusicError } from './musicError.ts';
import {
  artwork,
  ncmText,
  readNcmAlbum,
  positive,
  readNcmAlbumList,
  readNcmChart,
  readNcmItems,
  readNcmPlaylist,
  readNcmTracksInOrder,
} from './ncmRecords.ts';

/** 公共推荐用到的上游接口；调用约定同 NCM 适配里的 `call`：超时、限流冷却与错误码都由它处理 */
export type NcmDiscoverCall = (
  name:
    | 'banner'
    | 'top_song'
    | 'personalized'
    | 'album_new'
    | 'song_detail'
    | 'album'
    | 'playlist_detail'
    | 'toplist_detail',
  query: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<Record<string, unknown>>;

const HOUR_MS = 3_600_000;
/** 结果在后端留多久：榜单与横幅有「刚刚更新」；推荐歌单同一天里顺序不变 */
const KEEP_MS: Readonly<Record<MusicDiscoverKind, number>> = {
  banners: HOUR_MS,
  charts: HOUR_MS,
  playlists: 24 * HOUR_MS,
  'new-tracks': 6 * HOUR_MS,
  'new-albums': 6 * HOUR_MS,
};
/** 有的榜或横幅目标没取到时，结果只缓存这段时间，过后再补取 */
const PARTIAL_MS = 5 * 60_000;

/**
 * 榜单行的榜：官方榜按热歌、飙升、新歌、原创，后接各国家与地区的榜
 * ID 是网易云的榜单 ID，多年未变；取不到的榜直接不出
 */
const CHARTS: readonly (readonly [id: string, region: MusicChartRegion | null])[] = [
  ['3778678', null], // 热歌榜
  ['19723756', null], // 飙升榜
  ['3779629', null], // 新歌榜
  ['2884035', null], // 原创榜
  ['60198', 'us'], // 美国 Billboard 榜
  ['180106', 'uk'], // UK 排行榜周榜
  ['60131', 'jp'], // 日本 Oricon 榜
  ['27135204', 'fr'], // 法国 NRJ Vos Hits 周榜
  ['6939992364', 'ru'], // 俄罗斯 top hit 流行音乐榜
  ['745956260', 'kr'], // 网易云韩语榜
  ['7095271308', 'th'], // 泰语榜
  ['6732014811', 'vn'], // 越南语榜
  ['3812895', 'global'], // Beatport 全球电子舞曲榜
];

/** `top_song` 的地区编号 */
const SONG_AREAS: Readonly<Record<MusicDiscoverArea, number>> = {
  all: 0,
  zh: 7,
  ea: 96,
  jp: 8,
  kr: 16,
};
/** `album_new` 的地区代码 */
const ALBUM_AREAS: Readonly<Record<MusicDiscoverArea, string>> = {
  all: 'ALL',
  zh: 'ZH',
  ea: 'EA',
  jp: 'JP',
  kr: 'KR',
};

/** 横幅只收指向歌曲（1）与专辑（10）的；跳网页、演出的不收 */
const BANNER_TRACK = 1;
const BANNER_ALBUM = 10;

function idsOf(list: unknown, limit: number): string[] {
  if (!Array.isArray(list)) throw new MusicError('invalid-upstream');
  const ids = new Set<string>();
  for (const item of list) {
    const id = isRecord(item) ? positive(item.id) : null;
    if (id) ids.add(String(id));
    if (ids.size >= limit) break;
  }
  return [...ids];
}

/** 横幅里收下的一条，目标的名字还没取 */
interface Picked {
  readonly id: string;
  readonly label: string;
  readonly image: string;
  readonly kind: 'track' | 'album';
}

interface Fetched<T> {
  readonly value: T;
  /** 有一部分没取到 */
  readonly partial: boolean;
}

/** 请求方撤销时只让它自己先返回，取数继续进行，结果照样留给后来的请求 */
function waitFor<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new MusicError('cancelled'));
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new MusicError('cancelled'));
    signal.addEventListener('abort', stop, { once: true });
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

export function startNcmDiscover(call: NcmDiscoverCall, now: () => number = Date.now) {
  // 取数由几个页面请求共用，不跟着某一个请求撤销；每次上游调用仍有自己的超时
  const shared = new AbortController().signal;
  let tail: Promise<unknown> = Promise.resolve();
  /** 上游调用排成一队依次发：首页一打开就要好几类，并发会触发「操作频繁」 */
  function queued(
    name: Parameters<NcmDiscoverCall>[0],
    query: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const next = tail.then(() => call(name, query, shared));
    tail = next.catch(() => undefined);
    return next;
  }

  async function tracksInOrder(ids: readonly string[]): Promise<MusicTrack[]> {
    if (!ids.length) return [];
    const body = await queued('song_detail', { ids: ids.join(',') });
    return readNcmTracksInOrder(body, ids).items;
  }

  async function banners(): Promise<Fetched<MusicBanner[]>> {
    const body = await queued('banner', { type: 0 });
    if (!Array.isArray(body.banners)) throw new MusicError('invalid-upstream');
    const picked = body.banners
      .flatMap((item: unknown): Picked[] => {
        if (!isRecord(item)) return [];
        const id = positive(item.targetId);
        const label = ncmText(item.typeTitle);
        const image = artwork(item.bigImageUrl) ?? artwork(item.imageUrl);
        const kind =
          item.targetType === BANNER_TRACK
            ? 'track'
            : item.targetType === BANNER_ALBUM
              ? 'album'
              : null;
        return id && label && label.length <= 64 && image && kind
          ? [{ id: String(id), label, image, kind }]
          : [];
      })
      .slice(0, MUSIC_DISCOVER_LIMITS.banners);
    const tracks = new Map(
      (await tracksInOrder(picked.filter((item) => item.kind === 'track').map((item) => item.id)))
        // 没有版权的歌不上横幅
        .filter((track) => track.access !== 'unavailable')
        .map((track) => [track.ref.id, track]),
    );
    let partial = false;
    const items: MusicBanner[] = [];
    const seen = new Set<string>();
    for (const { id, label, image, kind } of picked) {
      if (seen.has(`${kind}:${id}`)) continue;
      seen.add(`${kind}:${id}`);
      if (kind === 'track') {
        const track = tracks.get(id);
        if (track) items.push({ label, image, target: { kind, track } });
        continue;
      }
      try {
        const album = readNcmAlbumList(await queued('album', { id })).owner;
        items.push({ label, image, target: { kind, album } });
      } catch {
        partial = true;
      }
    }
    return { value: items, partial };
  }

  /** 榜单详情不带更新说明（「刚刚更新」「每周三更新」），要从榜单目录按 ID 取；取不到时为 null */
  async function chartNotes(): Promise<ReadonlyMap<string, string> | null> {
    try {
      const body = await queued('toplist_detail', {});
      const notes = new Map<string, string>();
      for (const list of Array.isArray(body.list) ? body.list : []) {
        const id = isRecord(list) ? positive(list.id) : null;
        const note = isRecord(list) ? ncmText(list.updateFrequency) : null;
        if (id && note) notes.set(String(id), note);
      }
      return notes;
    } catch {
      return null;
    }
  }

  async function charts(): Promise<Fetched<MusicChart[]>> {
    const notes = await chartNotes();
    const items: MusicChart[] = [];
    let failure: unknown = null;
    for (const [id, region] of CHARTS) {
      try {
        const body = await queued('playlist_detail', { id });
        items.push(readNcmChart(body, region, notes?.get(id) ?? null));
      } catch (error) {
        failure ??= error;
      }
    }
    if (!items.length && failure) throw failure;
    return { value: items, partial: notes === null || failure !== null };
  }

  async function playlists(): Promise<Fetched<MusicPlaylist[]>> {
    const body = await queued('personalized', { limit: MUSIC_DISCOVER_LIMITS.playlists });
    const list = Array.isArray(body.result) ? body.result : null;
    // 推荐歌单的封面字段叫 picUrl，其余与歌单详情相同
    const { items } = readNcmItems(
      list?.map((item: unknown) => (isRecord(item) ? { ...item, coverImgUrl: item.picUrl } : item)),
      readNcmPlaylist,
    );
    return { value: items.slice(0, MUSIC_DISCOVER_LIMITS.playlists), partial: false };
  }

  async function newTracks(area: MusicDiscoverArea): Promise<Fetched<MusicTrack[]>> {
    const body = await queued('top_song', { type: SONG_AREAS[area] });
    // 新歌速递的曲目是旧版字段，缺音质档位与部分封面；按 ID 重取一遍详情
    const ids = idsOf(body.data, MUSIC_DISCOVER_LIMITS['new-tracks']);
    const items = (await tracksInOrder(ids)).filter((track) => track.access !== 'unavailable');
    return { value: items, partial: false };
  }

  async function newAlbums(area: MusicDiscoverArea): Promise<Fetched<MusicAlbum[]>> {
    const body = await queued('album_new', {
      area: ALBUM_AREAS[area],
      limit: MUSIC_DISCOVER_LIMITS['new-albums'],
      offset: 0,
    });
    const { items } = readNcmItems(body.albums, readNcmAlbum);
    return { value: items.slice(0, MUSIC_DISCOVER_LIMITS['new-albums']), partial: false };
  }

  function load(input: MusicDiscoverRequest): Promise<Fetched<unknown>> {
    switch (input.kind) {
      case 'banners':
        return banners();
      case 'charts':
        return charts();
      case 'playlists':
        return playlists();
      case 'new-tracks':
        return newTracks(input.area);
      case 'new-albums':
        return newAlbums(input.area);
    }
  }

  const cache = new Map<string, { until: number; readonly work: Promise<Fetched<unknown>> }>();
  return {
    /** 同一类同一地区在有效期内只取一次，并发的请求共用同一次取数；失败不留 */
    run(input: MusicDiscoverRequest, signal: AbortSignal): Promise<unknown> {
      const key = 'area' in input ? `${input.kind}:${input.area}` : input.kind;
      const kept = cache.get(key);
      if (kept && kept.until > now())
        return waitFor(
          kept.work.then(({ value }) => value),
          signal,
        );
      const work = load(input);
      const entry = { until: Infinity, work };
      cache.set(key, entry);
      work.then(
        ({ partial }) => {
          entry.until = now() + (partial ? PARTIAL_MS : KEEP_MS[input.kind]);
        },
        () => {
          if (cache.get(key) === entry) cache.delete(key);
        },
      );
      return waitFor(
        work.then(({ value }) => value),
        signal,
      );
    },
  };
}
