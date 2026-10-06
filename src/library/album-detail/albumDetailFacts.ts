import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../../host/hostCall.ts';
import {
  FORMAT_PATTERN,
  kiloHertz,
  parseFormatDetail,
  type FormatDetail,
} from '../../track/trackFormat.ts';
import { trackPathOf } from '../../host/libraryContract.ts';

export interface AlbumFactsFace {
  titleformat: Pick<typeof fb.titleformat, 'evalBatch'>;
}

/** 曲目行里没有、详情页要另外求值的几项。 */
export interface AlbumFacts {
  /** 第一首的编码方式与位深；取不到为 null。 */
  readonly format: FormatDetail | null;
  /** 各碟的副标题（`%discsubtitle%`），按碟号；没有副标题的碟不在里面。 */
  readonly discTitles: ReadonlyMap<number, string>;
}

const NO_FACTS: AlbumFacts = { format: null, discTitles: new Map() };

/** 格式在前、碟副标题在后：副标题里可能有 `|`，拆的时候前两段之后的全归它。 */
const PATTERN = `${FORMAT_PATTERN}|%discsubtitle%`;

/** 每张碟的第一首，按碟号的先后。 */
function discLeaders(tracks: readonly LibraryTrack[]): LibraryTrack[] {
  const leaders = new Map<number, LibraryTrack>();
  for (const track of tracks) {
    if (!leaders.has(track.discNumber)) leaders.set(track.discNumber, track);
  }
  return [...leaders.values()];
}

/**
 * 一次求出第一首的编码方式与位深、各碟的副标题：对每张碟的第一首求值，副标题取那一首的。宿主答失败时
 * 答 `NO_FACTS`，页面只少写位深与副标题。
 */
export async function readAlbumFacts(
  host: AlbumFactsFace,
  tracks: readonly LibraryTrack[],
): Promise<AlbumFacts> {
  const leaders = discLeaders(tracks);
  if (leaders.length === 0) return NO_FACTS;
  const answer = await settle(() => host.titleformat.evalBatch(PATTERN, leaders.map(trackPathOf)));
  if (!answer || answer.success === false) return NO_FACTS;
  let format: FormatDetail | null = null;
  const discTitles = new Map<number, string>();
  answer.results.forEach((row, at) => {
    const leader = leaders[at];
    if (!leader || !row.success || row.result === undefined) return;
    const [encoding = '', bits = '', ...rest] = row.result.split('|');
    if (at === 0) format = parseFormatDetail(`${encoding}|${bits}`);
    const title = rest.join('|').trim();
    if (title) discTitles.set(leader.discNumber, title);
  });
  return { format, discTitles };
}

/** 事实行里的格式要的几项；照专辑的第一首写，文案由页面按语言包拼。 */
export type FormatFact =
  | {
      readonly kind: 'lossless';
      readonly codec: string;
      readonly bits: number;
      readonly rate: string;
    }
  | { readonly kind: 'lossy'; readonly codec: string; readonly bitrate: number }
  | { readonly kind: 'rate'; readonly codec: string; readonly rate: string }
  | { readonly kind: 'codec'; readonly codec: string };

/**
 * 第一首的格式：无损写位深与采样率，有损写比特率；编码方式或位深取不到时只写采样率，采样率也没有就只写
 * 编码。编码不知道时答 null，事实行不写这一项。
 */
export function formatFactOf(
  track: Pick<LibraryTrack, 'codec' | 'sampleRate' | 'bitrate'> | undefined,
  format: FormatDetail | null,
): FormatFact | null {
  const codec = track?.codec.trim().toUpperCase() ?? '';
  if (!track || !codec) return null;
  const rate = track.sampleRate > 0 ? kiloHertz(track.sampleRate) : '';
  if (format?.lossless === false && track.bitrate > 0) {
    return { kind: 'lossy', codec, bitrate: track.bitrate };
  }
  if (format?.lossless === true && format.bits !== null && rate) {
    return { kind: 'lossless', codec, bits: format.bits, rate };
  }
  return rate ? { kind: 'rate', codec, rate } : { kind: 'codec', codec };
}
