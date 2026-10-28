import type { Track } from 'foo-webview-sdk';
import {
  albumArtistOf,
  trackAlbumKeyOf,
  type Album,
  type TrackAlbumFields,
} from '../host/libraryContract.ts';
import type { ObjectRef } from '../nav/objectRef.ts';
import { isPlainGenre } from '../nav/places.ts';
import { onlineInfoOf } from '../playback/onlineTracks.ts';
import type { MusicArtistCredit, MusicRef, MusicTrack } from '../server/musicObjects.ts';
import { trackOrigin } from '../host/trackOrigin.ts';

/** 可链接展示文本段；`ref` 为 null 时作为纯文本展示且不可点击 */
export interface LinkedName {
  readonly text: string;
  readonly ref: ObjectRef | null;
}

/** 曲目关联的可跳转对象集合：包含专辑与已去重的艺人列表（保持标签顺序） */
export interface TrackLinks {
  readonly album: LinkedName | null;
  readonly artists: readonly LinkedName[];
}

/** 允许字段缺失的曲目输入类型；兼容检索命中等仅拉取部分元数据的场景 */
export type LinkableTrack = TrackAlbumFields & Partial<Pick<Track, 'artist'>>;

/** 基于 WeakMap 缓存计算结果，避免虚拟滚动高频渲染重复解析 */
const memo = new WeakMap<
  LinkableTrack,
  { readonly online: ReadonlyMap<string, MusicTrack | null>; readonly links: TrackLinks }
>();

/**
 * 解析曲目元数据中可跳转的对象引用
 * 本地曲目依据标签提取专辑键与多值艺人；在线曲目读取后端署名信息，缺失平台 ID 时作为纯文本呈现
 * 引用仅表达目标身份标识，目标是否存在或可导航由对象打开服务统一解析
 */
export function trackLinks(
  track: LinkableTrack,
  online: ReadonlyMap<string, MusicTrack | null>,
): TrackLinks {
  const cached = memo.get(track);
  if (cached && cached.online === online) return cached.links;
  const links =
    track.path !== undefined && trackOrigin(track.path) === 'online'
      ? onlineLinks(track, onlineInfoOf(track.path, online))
      : localLinks(track);
  memo.set(track, { online, links });
  return links;
}

/** 专辑行上的艺人署名：专辑艺术家，没有时取艺人；署名为空时没有，不生成引用 */
export function albumArtistLink(album: Pick<Album, 'albumArtist' | 'artist'>): LinkedName | null {
  const text = albumArtistOf(album);
  return text.trim() ? { text, ref: { kind: 'artist', name: text } } : null;
}

/** 专辑的流派：标签原值，没有或不是单个流派（见 `isPlainGenre`）时没有，不生成引用 */
export function albumGenreLink(album: Pick<Album, 'genre'>): LinkedName | null {
  const text = album.genre;
  return isPlainGenre(text) && text.trim() ? { text, ref: { kind: 'genre', value: text } } : null;
}

function localLinks(track: LinkableTrack): TrackLinks {
  const key = trackAlbumKeyOf(track);
  const names = unique(track.artists ?? []);
  return {
    album: track.album ? { text: track.album, ref: key ? { kind: 'album', key } : null } : null,
    artists: names.length
      ? names.map((name) => ({ text: name, ref: { kind: 'artist', name } }))
      : plain(track.artist ?? ''),
  };
}

function onlineLinks(track: LinkableTrack, info: MusicTrack | null): TrackLinks {
  if (!info) {
    return {
      album: track.album ? { text: track.album, ref: null } : null,
      artists: plain(track.artist ?? ''),
    };
  }
  return musicTrackLinks(info);
}

/**
 * 手上已有在线曲目的展示信息时的可跳对象（搜索结果、在线列表页的行）：艺人按署名逐位去重，没有平台 ID 的只显示；
 * 专辑没有名字或平台 ID 时没有或只显示
 */
export function musicTrackLinks(info: MusicTrack): TrackLinks {
  const artists = musicArtistLinks(info.artists);
  const album = info.album;
  return {
    album:
      album && album.title.trim()
        ? { text: album.title, ref: album.ref && onlineList('album', album.ref, album.title) }
        : null,
    artists,
  };
}

/** 在线署名的可跳对象：按署名逐位去重，空名丢弃，没有平台 ID 的只显示。专辑图块与曲目行共用 */
export function musicArtistLinks(credits: readonly MusicArtistCredit[]): readonly LinkedName[] {
  const seen = new Set<string>();
  const artists: LinkedName[] = [];
  for (const credit of credits) {
    if (!credit.name.trim() || seen.has(credit.name)) continue;
    seen.add(credit.name);
    artists.push({
      text: credit.name,
      ref: credit.ref && onlineList('artist', credit.ref, credit.name),
    });
  }
  return artists;
}

function onlineList(kind: 'artist' | 'album', ref: MusicRef, title: string): ObjectRef {
  return { kind: 'onlineList', list: { kind, ref, title } };
}

/** 过滤空值与空白字符串，并保留首个出现的唯一名称 */
function unique(names: readonly string[]): readonly string[] {
  return [...new Set(names.filter((name) => name.trim() !== ''))];
}

function plain(text: string): readonly LinkedName[] {
  return text.trim() ? [{ text, ref: null }] : [];
}
