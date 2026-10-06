import type { Track } from 'foo-webview-sdk';
import type { fb } from 'foo-webview-sdk/bridge';

type SuccessOf<T extends (...args: never[]) => unknown> = Extract<
  Awaited<ReturnType<T>>,
  { success: true }
>;

export type InfoRead<T> =
  | { readonly status: 'idle' | 'loading' | 'failed' | 'unavailable' | 'notApplicable' }
  | { readonly status: 'ready'; readonly value: T };

export type InfoMetadata = SuccessOf<typeof fb.metadata.read>;
export type InfoFile = SuccessOf<typeof fb.file.getInfo>;
export type InfoStatistics = SuccessOf<typeof fb.playcount.get>['results'][number];
export type InfoReplayGain = SuccessOf<typeof fb.replaygain.get>['results'][number];
export type InfoRating = SuccessOf<typeof fb.rating.get>;

export interface InfoAudioExtras {
  readonly bitDepth?: string;
  readonly encoding?: string;
}

export type InfoSection =
  'metadata' | 'audio' | 'credits' | 'file' | 'statistics' | 'replayGain' | 'tags';
export const INFO_SECTIONS: readonly InfoSection[] = [
  'metadata',
  'audio',
  'credits',
  'file',
  'statistics',
  'replayGain',
  'tags',
];
export const INITIAL_INFO_SECTIONS: readonly InfoSection[] = ['metadata', 'audio'];

export interface TrackInfoState {
  readonly track: Track | null;
  readonly metadata: InfoRead<InfoMetadata>;
  readonly audio: InfoRead<InfoAudioExtras>;
  readonly file: InfoRead<InfoFile>;
  readonly statistics: InfoRead<InfoStatistics>;
  readonly replayGain: InfoRead<InfoReplayGain>;
  readonly rating: InfoRead<InfoRating>;
  readonly tagSource: 'host' | 'file';
  readonly action: 'idle' | 'copying' | 'copied' | 'copyFailed' | 'openFailed';
}

export function emptyTrackInfo(track: Track | null): TrackInfoState {
  return {
    track,
    metadata: { status: 'idle' },
    audio: { status: 'idle' },
    file: { status: 'idle' },
    statistics: { status: 'idle' },
    replayGain: { status: 'idle' },
    rating: { status: 'idle' },
    tagSource: 'host',
    action: 'idle',
  };
}

/** 只把普通文件交给同步文件接口，未知协议也不尝试打开。 */
export function infoMediaKind(track: Track): 'file' | 'container' | 'stream' {
  const scheme = /^([a-z][a-z\d+.-]+):/i.exec(track.path)?.[1]?.toLowerCase();
  if (!scheme || scheme === 'file' || scheme === 'file-relative') return 'file';
  return scheme === 'unpack' || scheme === 'cdda' ? 'container' : 'stream';
}

export function infoFilePath(track: Track): string | null {
  if (infoMediaKind(track) !== 'file') return null;
  const path = track.absolutePath;
  return /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(path) ? path : null;
}

export function infoTitle(track: Track): string {
  if (track.title) return track.title;
  const name = (track.absolutePath || track.path).split(/[\\/]/).pop() ?? '';
  return name.replace(/\.[^.]+$/, '') || track.path;
}

export function infoIdentity(state: TrackInfoState): Track | null {
  const { track, metadata } = state;
  if (!track || metadata.status !== 'ready') return track;
  const tags = infoTags(metadata.value.tags);
  const artists = [...findInfoTag(tags, ['ARTIST'])];
  return {
    ...track,
    title: findInfoTag(tags, ['TITLE'])[0] ?? '',
    artist: artists.join(', '),
    artists,
    album: findInfoTag(tags, ['ALBUM'])[0] ?? '',
  };
}

export interface InfoTag {
  readonly name: string;
  readonly values: readonly string[];
}

/** 数组保持原顺序；逗号属于值，不拿它拆分艺人。 */
export function infoTags(tags: InfoMetadata['tags']): readonly InfoTag[] {
  return Object.entries(tags).map(([name, value]) => ({
    name,
    values: (Array.isArray(value) ? value : [value]).map((item) =>
      typeof item === 'string' ? item : JSON.stringify(item),
    ),
  }));
}

export function findInfoTag(tags: readonly InfoTag[], names: readonly string[]): readonly string[] {
  return tags.filter((tag) => names.includes(tag.name.toUpperCase())).flatMap((tag) => tag.values);
}

export function filterInfoTags(tags: readonly InfoTag[], query: string): readonly InfoTag[] {
  const term = query.trim().toLocaleLowerCase();
  return tags.filter((tag) =>
    [tag.name, ...tag.values].some((value) => value.toLocaleLowerCase().includes(term)),
  );
}

/** JSON 数组在剪贴板里仍能区分单个含分隔符的值与多个值。 */
export function copyInfoTags(tags: readonly InfoTag[]): string {
  return JSON.stringify(
    Object.fromEntries(
      tags.map(({ name, values }) => [name, values.length === 1 ? values[0] : values]),
    ),
    null,
    2,
  );
}
