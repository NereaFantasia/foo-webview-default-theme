import type { MirrorSortColumn } from '../../src/server/libraryMirrorProtocol.ts';

/**
 * 文本分量：排序串里的文本字段各存一列秩；秩由比较器对去重后的值排序得出，相等的值同秩
 * （例如大小写不同的标题），同秩时顺延至下一个分量，与宿主整串比较结果一致
 */
export const RANK_COMPONENTS = [
  'title',
  'artist',
  'albumArtist',
  'album',
  'date',
  'dateKey',
  'genre',
  'codec',
  'path',
] as const;
export type RankComponent = (typeof RANK_COMPONENTS)[number];

export const RANK_COLUMN: Readonly<Record<RankComponent, string>> = {
  title: 'r_title',
  artist: 'r_artist',
  albumArtist: 'r_aa',
  album: 'r_album',
  date: 'r_date',
  dateKey: 'r_datekey',
  genre: 'r_genre',
  codec: 'r_codec',
  path: 'r_path',
};

/** 算文本分量要用的字段；既可以来自宿主的行，也可以来自镜像里的列 */
export interface RankSource {
  readonly title: string;
  readonly artist: string;
  readonly albumArtist: string;
  readonly album: string;
  readonly date: string;
  readonly genre: string;
  readonly codec: string;
  readonly absolutePath: string;
}

/** 无标题的曲目按文件名（去扩展名）排，与宿主的 `%title%` 一致 */
function fileStem(path: string): string {
  return path.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
}

/**
 * 排序串里的文本分量：专辑艺人为空时回退至艺人；`dateKey` 为 `$if(%album%,%date%,'9999')`，无专辑曲目排在末尾
 */
export function rankTexts(source: RankSource): Record<RankComponent, string> {
  return {
    title: source.title || fileStem(source.absolutePath),
    artist: source.artist,
    albumArtist: source.albumArtist || source.artist,
    album: source.album,
    date: source.date,
    dateKey: source.album ? source.date : '9999',
    genre: source.genre,
    codec: source.codec,
    path: source.absolutePath,
  };
}

/** 秩的比较器，随系统区域，与 `trackSort.ts` 的 `COLLATOR` 同配置 */
export const RANK_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const TAIL = ['r_aa', 'r_datekey', 'r_album', 'disc', 'track', 'r_title'] as const;

/**
 * 排序列与镜像列的比较顺序，对应 `TRACK_SORT` 排序规则；末尾追加库序 `seq` 保证同值次序稳定，
 * 前序分量已比较的冗余字段此处省略
 */
export const SORT_ORDER: Readonly<Record<MirrorSortColumn, readonly string[]>> = {
  number: ['track', 'r_aa', 'r_datekey', 'r_album', 'disc', 'r_title'],
  title: ['r_title', 'r_aa', 'r_datekey', 'r_album', 'disc', 'track'],
  artist: ['r_artist', 'r_datekey', 'r_album', 'disc', 'track', 'r_title'],
  album: ['r_album', 'r_aa', 'disc', 'track', 'r_title'],
  albumArtist: ['r_aa', 'r_datekey', 'r_album', 'disc', 'track', 'r_title'],
  year: ['r_date', ...TAIL],
  genre: ['r_genre', ...TAIL],
  rating: ['rating', ...TAIL],
  duration: ['dur_s', ...TAIL],
  codec: ['r_codec', ...TAIL],
  bitrate: ['bitrate', ...TAIL],
  sampleRate: ['sample_rate', ...TAIL],
  channels: ['channels', ...TAIL],
  fileSize: ['file_size', ...TAIL],
  path: ['r_path', 'subsong'],
};
