import type { ConfigPrefFace } from '../host/configPref.ts';
import { setConfigInScope } from '../host/configWrite.ts';
import { settle } from '../host/hostCall.ts';
import type { DataWriter, DataWriteResult } from '../kit/dataWrite.ts';
import { recordOf } from '../kit/localPref.ts';
import {
  LYRICS_ALIGN_KEY,
  LYRICS_DISPLAY_KEY,
  LYRICS_FONTS_KEY,
  LYRICS_PROCESSING_KEY,
  LYRICS_TYPOGRAPHY_KEY,
  LYRICS_VIEW_KEYS,
  parseLyricsDisplay,
  parseLyricsViewAppearance,
} from './lyricsDisplay.ts';
import {
  effectiveLyricsMotion,
  lyricsMotionConfig,
  LYRICS_MOTION_KEY,
  LYRICS_MOTION_PRESET_VALUES,
  LYRICS_VIEW_MOTION_KEYS,
  parseLyricsMotionPref,
  type LyricsMotionPref,
} from './lyricsMotion.ts';

const OLD_KEYS = [
  LYRICS_DISPLAY_KEY,
  LYRICS_TYPOGRAPHY_KEY,
  LYRICS_ALIGN_KEY,
  LYRICS_FONTS_KEY,
  LYRICS_MOTION_KEY,
];
const CURRENT_KEYS = [
  ...Object.values(LYRICS_VIEW_KEYS),
  ...Object.values(LYRICS_VIEW_MOTION_KEYS),
  LYRICS_PROCESSING_KEY,
];

/**
 * 把旧的歌词偏好迁移到主视图与沉浸视图各自的键。须在服务创建前调用，选择来源与迁移在同一写锁内完成。
 * 每个目标键分别记录代数，失败后可以继续迁移未完成的目标
 */
export function migrateLyricsViewPreferences(
  writer: DataWriter,
  host: Pick<ConfigPrefFace, 'config'>,
): Promise<DataWriteResult<void>> {
  return writer.run(async (scope) => {
    const saved = new Map(
      await Promise.all(
        [...OLD_KEYS, ...CURRENT_KEYS].map(async (key) => {
          const answer = await settle(() => host.config.get(key));
          if (!answer || answer.success === false) throw new Error('读取歌词设置失败');
          return [
            key,
            {
              found: answer.found,
              value: answer.value,
              generation: await scope.generation(`config:${key}`),
            },
          ] as const;
        }),
      ),
    );
    const at = (key: string) => {
      const value = saved.get(key);
      if (!value) throw new Error('缺少歌词设置迁移源');
      return value;
    };
    const newer = (source: string, target: string) =>
      (!at(target).found && at(target).generation === 0) ||
      at(source).generation > at(target).generation;
    const display = parseLyricsDisplay({
      ...recordOf(at(LYRICS_DISPLAY_KEY).value),
      ...recordOf(at(LYRICS_TYPOGRAPHY_KEY).value),
      align: at(LYRICS_ALIGN_KEY).value,
    });
    const font = recordOf(recordOf(at(LYRICS_FONTS_KEY).value).immersive);
    const defaultMotion: LyricsMotionPref = {
      preset: 'amll',
      custom: LYRICS_MOTION_PRESET_VALUES.amll,
    };
    const motion = parseLyricsMotionPref(at(LYRICS_MOTION_KEY).value) ?? defaultMotion;
    const position = effectiveLyricsMotion(motion);

    async function migrate(
      key: string,
      sources: readonly string[],
      value: Parameters<typeof setConfigInScope>[3],
    ) {
      const latest = await scope.latestFormat(
        { id: key, keys: [`config:${key}`], hasValue: at(key).found },
        [
          {
            id: 'previous',
            keys: sources.map((source) => `config:${source}`),
            hasValue: sources.some((source) => at(source).found),
          },
        ],
      );
      if (latest.id !== key) await setConfigInScope(scope, host.config, key, value);
    }

    const mainKey = LYRICS_VIEW_KEYS.main;
    const main = parseLyricsViewAppearance(
      {
        ...recordOf(at(mainKey).value),
        ...(newer(LYRICS_DISPLAY_KEY, mainKey)
          ? { fontSize: display.fontSize, backgroundLast: display.backgroundLast }
          : {}),
        ...(newer(LYRICS_TYPOGRAPHY_KEY, mainKey)
          ? {
              fontSource: display.fontFamily ? 'custom' : 'interface',
              fontFamily: display.fontFamily,
              fontWeight: display.fontWeight,
              translationFontSize: display.translationFontSize,
              showTranslation: display.showTranslation,
              showRomanization: display.showRomanization,
            }
          : {}),
        ...(newer(LYRICS_ALIGN_KEY, mainKey) ? { align: display.align } : {}),
        ...(newer(LYRICS_MOTION_KEY, mainKey)
          ? {
              alignAnchor: position.alignAnchor,
              alignPosition: position.alignPosition,
            }
          : {}),
      },
      'main',
    );
    await migrate(
      mainKey,
      [LYRICS_DISPLAY_KEY, LYRICS_TYPOGRAPHY_KEY, LYRICS_ALIGN_KEY, LYRICS_MOTION_KEY],
      { ...main },
    );

    const immersiveKey = LYRICS_VIEW_KEYS.immersive;
    const immersive = parseLyricsViewAppearance(
      {
        ...(at(immersiveKey).found || at(immersiveKey).generation > 0
          ? recordOf(at(immersiveKey).value)
          : display),
        ...(newer(LYRICS_FONTS_KEY, immersiveKey)
          ? {
              fontSource: typeof font.family === 'string' && font.family.trim() ? 'custom' : 'main',
              fontFamily: font.family,
              fontWeight: font.weight,
            }
          : {}),
      },
      'immersive',
    );
    await migrate(
      immersiveKey,
      [LYRICS_DISPLAY_KEY, LYRICS_TYPOGRAPHY_KEY, LYRICS_ALIGN_KEY, LYRICS_FONTS_KEY],
      { ...immersive },
    );

    const { autoSeek, overscan, maskMode, maskChar, optimize } = display;
    await migrate(LYRICS_PROCESSING_KEY, [LYRICS_DISPLAY_KEY], {
      autoSeek,
      overscan,
      maskMode,
      maskChar,
      optimize: { ...optimize },
    });
    await migrate(LYRICS_VIEW_MOTION_KEYS.main, [LYRICS_MOTION_KEY], lyricsMotionConfig(motion));
    const previousImmersive = at(LYRICS_VIEW_MOTION_KEYS.immersive);
    await migrate(
      LYRICS_VIEW_MOTION_KEYS.immersive,
      [LYRICS_MOTION_KEY],
      lyricsMotionConfig(
        previousImmersive.found || previousImmersive.generation > 0
          ? (parseLyricsMotionPref(previousImmersive.value) ?? defaultMotion)
          : motion,
      ),
    );
  });
}
