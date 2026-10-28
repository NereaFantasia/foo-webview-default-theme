import type { MessageKey } from '../../i18n/en.ts';
import type { Translate } from '../../i18n/translate.ts';
import type { MusicClientFailureCode } from '../../playback/musicClient.ts';
import { platformName } from '../../playback/musicPlatforms.ts';

const REASONS: Partial<Record<MusicClientFailureCode, MessageKey>> = {
  timeout: 'online.reason.timeout',
  'upstream-unavailable': 'online.reason.upstream',
  'rate-limited': 'online.reason.rateLimited',
};

/** 解析在线音乐客户端故障原因文案；未明确分类的错误代码返回 undefined 并回退基础失败提示 */
export function failureDetail(code: MusicClientFailureCode, t: Translate): string | undefined {
  const reason = REASONS[code];
  return reason && t(reason, { platform: platformName(t, 'wy') });
}
