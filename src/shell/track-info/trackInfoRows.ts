import type { MessageKey } from '../../i18n/en.ts';
import type { Translate } from '../../i18n/translate.ts';
import {
  findInfoTag,
  infoTags,
  INFO_SECTIONS,
  type InfoSection,
  type InfoTag,
  type TrackInfoState,
} from './trackInfoModel.ts';

export interface InfoRow {
  readonly label: MessageKey;
  readonly values: readonly string[];
  readonly missing?: MessageKey;
}

type TagField = readonly [MessageKey, ...string[]];
const METADATA: readonly TagField[] = [
  ['trackInfo.trackTitle', 'TITLE'],
  ['trackInfo.artist', 'ARTIST'],
  ['trackInfo.albumArtist', 'ALBUM ARTIST', 'ALBUMARTIST'],
  ['trackInfo.album', 'ALBUM'],
  ['trackInfo.date', 'DATE'],
  ['trackInfo.genre', 'GENRE'],
  ['trackInfo.trackNumber', 'TRACKNUMBER'],
  ['trackInfo.totalTracks', 'TOTALTRACKS', 'TRACKTOTAL'],
  ['trackInfo.discNumber', 'DISCNUMBER'],
  ['trackInfo.totalDiscs', 'TOTALDISCS', 'DISCTOTAL'],
];
const CREDITS: readonly TagField[] = [
  ['trackInfo.composer', 'COMPOSER'],
  ['trackInfo.lyricist', 'LYRICIST', 'LYRICS BY'],
  ['trackInfo.performer', 'PERFORMER'],
  ['trackInfo.conductor', 'CONDUCTOR'],
  ['trackInfo.work', 'WORK'],
  ['trackInfo.movement', 'MOVEMENT', 'MOVEMENTNAME'],
  ['trackInfo.label', 'LABEL', 'PUBLISHER'],
  ['trackInfo.catalog', 'CATALOGNUMBER', 'CATALOG'],
  ['trackInfo.originalDate', 'ORIGINALDATE', 'ORIGINAL RELEASE DATE'],
  ['trackInfo.bpm', 'BPM'],
  ['trackInfo.comment', 'COMMENT', 'DESCRIPTION'],
];

function taggedRows(tags: readonly InfoTag[], fields: readonly TagField[]): InfoRow[] {
  return fields.map(([label, ...names]) => ({
    label,
    values: findInfoTag(tags, names),
    missing: 'trackInfo.notTagged',
  }));
}

function row(label: MessageKey, value: string | undefined): InfoRow {
  return { label, values: value === undefined || value === '' ? [] : [value] };
}

function positive(value: number | undefined, suffix = ''): string | undefined {
  return value !== undefined && value > 0 ? `${value}${suffix}` : undefined;
}

export function infoDuration(seconds: number | undefined): string | undefined {
  if (!seconds || seconds < 0) return undefined;
  const value = Math.floor(seconds);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value / 60) % 60;
  return `${hours ? `${hours}:${String(minutes).padStart(2, '0')}` : minutes}:${String(value % 60).padStart(2, '0')}`;
}

export function infoBytes(bytes: number | undefined, locale: string): string | undefined {
  if (bytes === undefined || bytes < 0) return undefined;
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = bytes === 0 ? 0 : Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(bytes / 1024 ** index)} ${units[index]}`;
}

export function trackInfoRows(
  state: TrackInfoState,
  section: InfoSection,
  t: Translate,
  locale: string,
): readonly InfoRow[] {
  const { track, metadata, audio, file, statistics, replayGain } = state;
  if (!track) return [];
  const tags = metadata.status === 'ready' ? infoTags(metadata.value.tags) : [];
  if (section === 'metadata') {
    return metadata.status === 'ready' ? taggedRows(tags, METADATA) : [];
  }
  if (section === 'credits')
    return taggedRows(tags, CREDITS).filter((field) => field.values.length);
  if (section === 'audio') {
    const technical = metadata.status === 'ready' ? metadata.value.info : track;
    const extras = audio.status === 'ready' ? audio.value : {};
    const encoding =
      extras.encoding === 'lossless'
        ? t('trackInfo.lossless')
        : extras.encoding === 'lossy'
          ? t('trackInfo.lossy')
          : extras.encoding;
    const bits = Number(extras.bitDepth);
    return [
      row('trackInfo.duration', infoDuration(technical.duration)),
      row('trackInfo.codec', technical.codec),
      {
        ...row('trackInfo.encoding', encoding),
        missing: audio.status === 'ready' ? 'trackInfo.unknown' : infoReadLabel(audio.status),
      },
      row('trackInfo.bitrate', positive(technical.bitrate, ' kbps')),
      row('trackInfo.sampleRate', positive(technical.sampleRate / 1000, ' kHz')),
      {
        ...row('trackInfo.bitDepth', Number.isInteger(bits) ? positive(bits, ' bit') : undefined),
        missing:
          extras.encoding === 'lossy'
            ? 'trackInfo.notApplicable'
            : audio.status === 'ready'
              ? 'trackInfo.unknown'
              : infoReadLabel(audio.status),
      },
      row('trackInfo.channels', positive(technical.channels)),
    ];
  }
  if (section === 'file') {
    const value = file.status === 'ready' ? file.value : null;
    return [
      row(
        'trackInfo.fileName',
        value?.name ?? (track.absolutePath || track.path).split(/[\\/]/).pop(),
      ),
      row('trackInfo.path', track.absolutePath || track.path),
      ...(track.subsong > 0 ? [row('trackInfo.subsong', String(track.subsong))] : []),
      row(
        track.subsong > 0 ? 'trackInfo.sourceSize' : 'trackInfo.size',
        infoBytes(value?.size, locale),
      ),
      row(
        'trackInfo.modified',
        value?.modified === undefined
          ? undefined
          : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
              value.modified,
            ),
      ),
    ];
  }
  if (section === 'statistics' && statistics.status === 'ready') {
    const stats = statistics.value;
    return [
      row('trackInfo.plays', stats.playCount === undefined ? undefined : String(stats.playCount)),
      row('trackInfo.firstPlayed', stats.firstPlayed),
      row('trackInfo.lastPlayed', stats.lastPlayed),
      row('trackInfo.added', stats.added),
    ];
  }
  if (section === 'replayGain' && replayGain.status === 'ready') {
    const gain = replayGain.value;
    if (![gain.trackGain, gain.albumGain, gain.trackPeak, gain.albumPeak].some(Boolean)) return [];
    return [
      row('trackInfo.trackGain', gain.trackGain),
      row('trackInfo.albumGain', gain.albumGain),
      row('trackInfo.trackPeak', gain.trackPeak),
      row('trackInfo.albumPeak', gain.albumPeak),
    ];
  }
  return [];
}

export function infoReadLabel(status: string): MessageKey {
  switch (status) {
    case 'idle':
      return 'trackInfo.unavailable';
    case 'loading':
      return 'trackInfo.loading';
    case 'failed':
      return 'trackInfo.failed';
    case 'notApplicable':
      return 'trackInfo.notApplicable';
    default:
      return 'trackInfo.unavailable';
  }
}

export function copyInfoFields(state: TrackInfoState, t: Translate, locale: string): string {
  if (!state.track) return '';
  return JSON.stringify(
    Object.fromEntries(
      INFO_SECTIONS.map((section) => {
        const notice = infoSectionNotice(state, section);
        if (notice && section !== 'file') return [t(`trackInfo.${section}`), t(notice)];
        if (section === 'tags' && state.metadata.status === 'ready')
          return [t('trackInfo.tags'), state.metadata.value.tags];
        const fields = Object.fromEntries(
          trackInfoRows(state, section, t, locale).map(({ label, values, missing }) => [
            t(label),
            values.length === 0
              ? t(missing ?? 'trackInfo.unknown')
              : values.length === 1
                ? values[0]
                : values,
          ]),
        );
        if (section === 'metadata' && state.rating.status === 'ready')
          fields[t('trackInfo.rating')] = String(state.rating.value.rating);
        return [t(`trackInfo.${section}`), fields];
      }),
    ),
    null,
    2,
  );
}

export function infoSectionNotice(state: TrackInfoState, section: InfoSection): MessageKey | null {
  const data = state[section === 'credits' || section === 'tags' ? 'metadata' : section];
  if (section === 'audio') return null;
  if (data.status !== 'ready') {
    return section === 'statistics' && data.status === 'unavailable'
      ? 'trackInfo.noStatistics'
      : infoReadLabel(data.status);
  }
  if (section === 'file' && state.file.status === 'ready' && !state.file.value.exists) {
    return 'trackInfo.missingFile';
  }
  return null;
}
