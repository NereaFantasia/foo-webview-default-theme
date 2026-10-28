export const MUSIC_PLATFORMS = ['wy', 'tx', 'kw', 'kg', 'mg'] as const;
export const MUSIC_QUALITIES = ['128k', '320k', 'flac', 'flac24bit'] as const;
export const MUSIC_ACCESS = ['free', 'vip', 'purchase', 'unavailable'] as const;

export type MusicPlatform = (typeof MUSIC_PLATFORMS)[number];
export type MusicQuality = (typeof MUSIC_QUALITIES)[number];
export type MusicAccess = (typeof MUSIC_ACCESS)[number];

/** 平台加平台内的 ID 就是在线对象的身份，与由哪个上游取数据无关；对象种类由所在字段决定 */
export interface MusicRef {
  readonly platform: MusicPlatform;
  readonly id: string;
}

/** `ref` 为 null 时只有名字可显示，不能跳转 */
export interface MusicArtistCredit {
  readonly ref: MusicRef | null;
  readonly name: string;
}

export interface MusicAlbumCredit {
  readonly ref: MusicRef | null;
  readonly title: string;
}

export interface MusicTrack {
  readonly ref: MusicRef;
  readonly title: string;
  /** 别名或译名 */
  readonly subtitle: string | null;
  /** 保持上游顺序 */
  readonly artists: readonly MusicArtistCredit[];
  readonly album: MusicAlbumCredit | null;
  /** 毫秒；有的上游只精确到秒 */
  readonly durationMs: number | null;
  readonly artwork: string | null;
  /** 曲目本身提供的档位，不代表当前账号都能取到 */
  readonly qualities: readonly MusicQuality[];
  /** 各档的文件大小，字节；只有网易云给，一档都没有时省略 */
  readonly sizes?: Readonly<Partial<Record<MusicQuality, number>>>;
  /** 取数据那一刻的快照，能否播放以取地址时为准；上游不提供时为 null */
  readonly access: MusicAccess | null;
}

export const MUSIC_ALBUM_KINDS = ['album', 'single', 'ep', 'compilation'] as const;
export type MusicAlbumKind = (typeof MUSIC_ALBUM_KINDS)[number];

export const MUSIC_ALBUM_SUBTYPES = ['studio', 'live', 'remix', 'instrumental', 'demo'] as const;
export type MusicAlbumSubType = (typeof MUSIC_ALBUM_SUBTYPES)[number];

export interface MusicAlbum {
  readonly ref: MusicRef;
  readonly title: string;
  readonly artists: readonly MusicArtistCredit[];
  readonly artwork: string | null;
  /** `YYYY-MM-DD` */
  readonly releaseDate: string | null;
  readonly trackCount: number | null;
  /** 上游没标或标的不是这几种时为 null */
  readonly kind: MusicAlbumKind | null;
  /** 录音室、现场等版本类别；网易云的艺人专辑与专辑详情给，搜索结果与其他来源省略 */
  readonly subType?: MusicAlbumSubType;
}

export interface MusicArtist {
  readonly ref: MusicRef;
  readonly name: string;
  readonly avatar: string | null;
  /** 平台自报，同一位艺人在不同平台的数目不同，不跨平台比较 */
  readonly albumCount: number | null;
  readonly trackCount: number | null;
}

export const MUSIC_PLAYLIST_KINDS = ['playlist', 'chart'] as const;
export type MusicPlaylistKind = (typeof MUSIC_PLAYLIST_KINDS)[number];

export interface MusicPlaylist {
  readonly ref: MusicRef;
  readonly title: string;
  readonly cover: string | null;
  readonly trackCount: number | null;
  /** 榜单也是一张歌单，曲目照歌单取 */
  readonly kind: MusicPlaylistKind;
  /** 平台原样给的简介，可能有多行 */
  readonly description: string | null;
  readonly playCount: number | null;
  /** 榜单的更新说明，如「刚刚更新」，原样显示 */
  readonly updateNote: string | null;
}

// 以下取值规则也用于读传输协议里的其他字段，两边按同一套长度与格式核对
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isText(value: unknown, limit = 2048): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
}

export function isNullableText(value: unknown): value is string | null {
  return value === null || isText(value);
}

export function isInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

export function isHttpUrl(value: unknown): value is string {
  if (!isText(value) || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function readMusicRef(value: unknown): MusicRef | null {
  if (!isRecord(value) || !isText(value.id, 256)) return null;
  const platform = MUSIC_PLATFORMS.find((item) => item === value.platform);
  return platform ? { platform, id: value.id } : null;
}

/** 署名里的引用可以为空，但不能是坏引用 */
function creditRef(value: unknown): MusicRef | null | undefined {
  return value === null ? null : (readMusicRef(value) ?? undefined);
}

function readArtists(value: unknown): MusicArtistCredit[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const artists: MusicArtistCredit[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isText(item.name)) return null;
    const reference = creditRef(item.ref);
    if (reference === undefined) return null;
    artists.push({ ref: reference, name: item.name });
  }
  return artists;
}

function readAlbum(value: unknown): MusicAlbumCredit | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isText(value.title)) return undefined;
  const reference = creditRef(value.ref);
  return reference === undefined ? undefined : { ref: reference, title: value.title };
}

/** 省略时答空对象；键不是档位或值不是正整数时答 null */
function readSizes(value: unknown): Partial<Record<MusicQuality, number>> | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const sizes: Partial<Record<MusicQuality, number>> = {};
  for (const [key, size] of Object.entries(value)) {
    const quality = MUSIC_QUALITIES.find((item) => item === key);
    if (!quality || !isInteger(size, 1)) return null;
    sizes[quality] = size;
  }
  return sizes;
}

export function readMusicTrack(value: unknown): MusicTrack | null {
  if (!isRecord(value)) return null;
  const reference = readMusicRef(value.ref);
  const artists = readArtists(value.artists);
  const album = readAlbum(value.album);
  const qualities = MUSIC_QUALITIES.filter((item) =>
    Array.isArray(value.qualities) ? value.qualities.includes(item) : false,
  );
  const access = value.access === null ? null : MUSIC_ACCESS.find((item) => item === value.access);
  const sizes = readSizes(value.sizes);
  if (
    !reference ||
    !isText(value.title) ||
    !isNullableText(value.subtitle) ||
    !artists ||
    album === undefined ||
    !(value.durationMs === null || isInteger(value.durationMs)) ||
    !(value.artwork === null || isHttpUrl(value.artwork)) ||
    !Array.isArray(value.qualities) ||
    qualities.length !== value.qualities.length ||
    access === undefined ||
    !sizes
  )
    return null;
  return {
    ref: reference,
    title: value.title,
    subtitle: value.subtitle,
    artists,
    album,
    durationMs: value.durationMs,
    artwork: value.artwork,
    qualities,
    ...(Object.keys(sizes).length ? { sizes } : {}),
    access,
  };
}

function count(value: unknown): value is number | null {
  return value === null || isInteger(value);
}

export function readMusicAlbum(value: unknown): MusicAlbum | null {
  if (!isRecord(value)) return null;
  const reference = readMusicRef(value.ref);
  const artists = readArtists(value.artists);
  const date = value.releaseDate;
  const kind = value.kind === null ? null : MUSIC_ALBUM_KINDS.find((item) => item === value.kind);
  const subType =
    value.subType === undefined
      ? null
      : MUSIC_ALBUM_SUBTYPES.find((item) => item === value.subType);
  if (
    !reference ||
    !isText(value.title) ||
    !artists ||
    !(value.artwork === null || isHttpUrl(value.artwork)) ||
    !(date === null || (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))) ||
    !count(value.trackCount) ||
    kind === undefined ||
    subType === undefined
  )
    return null;
  return {
    ref: reference,
    title: value.title,
    artists,
    artwork: value.artwork,
    releaseDate: date,
    trackCount: value.trackCount,
    kind,
    ...(subType ? { subType } : {}),
  };
}

export function readMusicArtist(value: unknown): MusicArtist | null {
  if (!isRecord(value)) return null;
  const reference = readMusicRef(value.ref);
  if (
    !reference ||
    !isText(value.name) ||
    !(value.avatar === null || isHttpUrl(value.avatar)) ||
    !count(value.albumCount) ||
    !count(value.trackCount)
  )
    return null;
  return {
    ref: reference,
    name: value.name,
    avatar: value.avatar,
    albumCount: value.albumCount,
    trackCount: value.trackCount,
  };
}

export function readMusicPlaylist(value: unknown): MusicPlaylist | null {
  if (!isRecord(value)) return null;
  const reference = readMusicRef(value.ref);
  const kind = MUSIC_PLAYLIST_KINDS.find((item) => item === value.kind);
  if (
    !reference ||
    !isText(value.title) ||
    !(value.cover === null || isHttpUrl(value.cover)) ||
    !count(value.trackCount) ||
    !kind ||
    !isNullableText(value.description) ||
    !count(value.playCount) ||
    !isNullableText(value.updateNote)
  )
    return null;
  return {
    ref: reference,
    title: value.title,
    cover: value.cover,
    trackCount: value.trackCount,
    kind,
    description: value.description,
    playCount: value.playCount,
    updateNote: value.updateNote,
  };
}
