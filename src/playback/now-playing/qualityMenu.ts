import { Bookmark20Regular } from '@fluentui/react-icons';
import type { Track } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { createElement } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import type { Translate } from '../../i18n/translate.ts';
import type { ContextMenuBranch } from '../../kit/context-menu/contextMenuItems.ts';
import { useService } from '../../kit/useService.ts';
import { onlineUnblockedAtom } from '../onlineFailures.ts';
import { onlinePlaybackKey, qualitySwitchAtom, type QualitySwitch } from '../onlinePlayback.ts';
import { ONLINE_QUALITY, onlineQualityKey } from '../onlineQuality.ts';
import { onlineKey, onlineSourceOf, onlineTracksAtom } from '../onlineTracks.ts';
import { trackKeyOf } from '../playbackContract.ts';
import { MUSIC_QUALITIES, type MusicQuality, type MusicTrack } from '../../server/musicObjects.ts';
import type { FormatReading } from '../../track/trackFormat.ts';
import { nowPlayingAtom } from './nowPlaying.ts';

export interface QualityChoice {
  readonly quality: MusicQuality;
  /** 档位名：标准、高、无损、Hi-Res */
  readonly name: string;
  /** 右侧说明：这一档的规格与体积（只有网易云给体积），或它为什么不能选、实际取到了什么 */
  readonly detail: string;
  readonly disabled: boolean;
  /** 设置里的默认音质，名称后面挂「默认」徽章 */
  readonly preferred: boolean;
}

export interface QualityMenuModel {
  /** 这一首加入时请求的档位，菜单里勾它 */
  readonly requested: MusicQuality;
  /** 标记上写的字 */
  readonly badge: string;
  /** 正在换成另一档：标记写目标档位 */
  readonly switching: boolean;
  /** 第三方补全的版本：标记写「补全」，实际音质未知 */
  readonly unblocked: boolean;
  readonly choices: readonly QualityChoice[];
  /** 请求的档位已是默认音质，「设为默认音质」置灰 */
  readonly isDefault: boolean;
}

export interface QualityMenuInput {
  readonly track: Pick<Track, 'path' | 'bitrate'>;
  /** 这一首的格式细节；读的不是这一首时按 pending 给 */
  readonly reading: FormatReading;
  readonly tracks: ReadonlyMap<string, MusicTrack | null>;
  /** 设置里的默认音质 */
  readonly preferred: MusicQuality;
  readonly unblocked: ReadonlySet<string>;
  readonly switching: QualitySwitch | null;
}

const rank = (quality: MusicQuality) => MUSIC_QUALITIES.indexOf(quality);

/** 字节数写成 MB，按 1024 进位、一位小数。规格与体积之间用半个字宽的空白（U+2002）隔开，不放符号 */
const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/**
 * fb2k 读出的实际档位与写法：无损按位深分无损与 Hi-Res，有损写码率并按 320k 为界归档。还没读出、
 * 读不出时为 null。不用上游回报的档位：页面重载后正在播的那首也认得出，上游不报的档位（192k、经 LX 取的）
 * 也照实写
 */
function actualOf(bitrate: number, reading: FormatReading, t: Translate) {
  if (reading === 'pending' || reading === 'failed') return null;
  if (reading.lossless === true) {
    const quality: MusicQuality = (reading.bits ?? 0) >= 24 ? 'flac24bit' : 'flac';
    return { quality, label: t(`online.quality.${quality}`) };
  }
  if (reading.lossless !== false || bitrate <= 0) return null;
  const quality: MusicQuality = bitrate >= 320 ? '320k' : '128k';
  return { quality, label: `${bitrate}k` };
}

/** 在线曲目的音质标记与菜单；不是在线曲目时为 null */
export function qualityMenuModel(input: QualityMenuInput, t: Translate): QualityMenuModel | null {
  const source = onlineSourceOf(input.track.path, input.unblocked);
  if (!source) return null;
  const requested = source.quality;
  // 展示信息还没取到时不知道曲目有哪几档，都不置灰
  const info = input.tracks.get(onlineKey(source.ref)) ?? null;
  const offered = info?.qualities ?? null;
  const actual = source.unblocked ? null : actualOf(input.track.bitrate, input.reading, t);
  const switching = input.switching?.from === input.track.path ? input.switching.quality : null;
  const badge =
    switching !== null
      ? t(`online.quality.${switching}`)
      : source.unblocked
        ? t('online.unblocked')
        : (actual?.label ?? t(`online.quality.${requested}`));
  const choices = MUSIC_QUALITIES.map((quality): QualityChoice => {
    const missing = quality !== requested && offered !== null && !offered.includes(quality);
    const spec = t(`online.qualityDetail.${quality}`);
    const size = info?.sizes?.[quality];
    const detail =
      quality === requested && actual && rank(actual.quality) < rank(quality)
        ? t('online.qualityActual', { quality: actual.label })
        : missing
          ? t(`online.qualityMissing.${quality}`)
          : size
            ? t('online.qualityWithSize', { quality: spec, size: megabytes(size) })
            : spec;
    return {
      quality,
      name: t(`online.qualityName.${quality}`),
      detail,
      disabled: missing,
      preferred: quality === input.preferred,
    };
  });
  return {
    requested,
    badge,
    switching: switching !== null,
    unblocked: source.unblocked,
    choices,
    isDefault: requested === input.preferred,
  };
}

export interface QualityMenu extends QualityMenuModel {
  /** 换成另一档，从当前位置接着播；选的是当前档、置灰的档或正在换时不响应 */
  pick(quality: MusicQuality): void;
  setDefault(): void;
}

/**
 * `track` 的音质菜单：标题栏、通栏与胶囊的标记和正在播放的右键菜单共用。`track` 是那一行此刻写的曲目，
 * 换曲的退场期间还是上一首，格式细节只在属于它时才用
 */
export function useQualityMenu(track: Track | null): QualityMenu | null {
  const t = useAtomValueRawSync(translateAtom);
  const { key, format } = useAtomValueRawSync(nowPlayingAtom);
  const tracks = useAtomValueRawSync(onlineTracksAtom);
  const preferred = useAtomValueRawSync(ONLINE_QUALITY.atom);
  const unblocked = useAtomValueRawSync(onlineUnblockedAtom);
  const switching = useAtomValueRawSync(qualitySwitchAtom);
  const playback = useService(onlinePlaybackKey);
  const defaults = useService(onlineQualityKey);
  if (!track) return null;
  const reading = key === trackKeyOf(track) ? format : 'pending';
  const model = qualityMenuModel({ track, reading, tracks, preferred, unblocked, switching }, t);
  if (!model) return null;
  return {
    ...model,
    pick(quality) {
      const choice = model.choices.find((item) => item.quality === quality);
      if (switching || !choice || choice.disabled || quality === model.requested) return;
      void playback.switchQuality(quality);
    },
    setDefault() {
      if (!model.isDefault) void defaults.set(model.requested);
    },
  };
}

/** 正在播放的右键菜单里的「音质」子菜单，与标记点开的菜单同样几项；窄窗不放标记时从这里换 */
export function qualityBranch(menu: QualityMenu, t: Translate): ContextMenuBranch {
  return {
    kind: 'submenu',
    id: 'quality',
    label: t('online.quality'),
    items: [
      ...menu.choices.map((choice) => ({
        kind: 'command' as const,
        id: `quality-${choice.quality}`,
        label: choice.name,
        detail: choice.detail,
        ...(choice.preferred ? { badge: t('online.qualityDefault') } : {}),
        disabled: choice.disabled,
        check: 'radio' as const,
        checked: choice.quality === menu.requested,
        onSelect: () => menu.pick(choice.quality),
      })),
      { kind: 'separator', id: 'quality-default-divider' },
      {
        kind: 'command',
        id: 'quality-default',
        label: t('online.setDefaultQuality'),
        icon: createElement(Bookmark20Regular),
        disabled: menu.isDefault,
        onSelect: () => menu.setDefault(),
      },
    ],
  };
}
