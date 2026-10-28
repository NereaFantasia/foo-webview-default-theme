import type { MessageKey } from '../i18n/en.ts';
import type { Translate } from '../i18n/translate.ts';
import type { MusicPlatform } from '../server/musicObjects.ts';

/** 平台名称对应的文案多语言键 */
export const PLATFORM_LABELS = {
  wy: 'online.platform.wy',
  tx: 'online.platform.tx',
  kw: 'online.platform.kw',
  kg: 'online.platform.kg',
  mg: 'online.platform.mg',
} as const satisfies Record<MusicPlatform, MessageKey>;

/** 获取用于界面展示的平台名称文案 */
export function platformName(t: Translate, platform: MusicPlatform): string {
  return t(PLATFORM_LABELS[platform]);
}
