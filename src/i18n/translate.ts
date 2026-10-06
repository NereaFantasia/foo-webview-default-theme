import { en, type MessageKey, type Messages } from './en.ts';
import { zhCN } from './zhCN.ts';

/** 内置的两档语言。其他语言只由用户放进 profile 的外部文件提供，不预置半成品翻译。 */
export type BuiltinTag = 'en' | 'zh-CN';
export const BUILTIN_TAGS: readonly BuiltinTag[] = ['en', 'zh-CN'];
export const BUILTIN_MESSAGES: Readonly<Record<BuiltinTag, Messages>> = { en, 'zh-CN': zhCN };

export function isBuiltinTag(tag: string): tag is BuiltinTag {
  return tag === 'en' || tag === 'zh-CN';
}

/** 宿主或浏览器给的语言标签落到哪个内置包：zh 开头的（含繁体）走简体中文，其余一律英文。 */
export function resolveBuiltin(tag: string): BuiltinTag {
  return tag.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export type TranslateParams = Readonly<Record<string, string | number>>;
export type Translate = (key: MessageKey, params?: TranslateParams) => string;

/**
 * 取文案时先查覆盖层，缺的键回落基准包，界面上不会露出键名。
 * `{name}` 占位按参数替换；没给的占位原样留着，一眼看得出漏传。
 */
export function createTranslate(base: Messages, overlay: Partial<Messages>): Translate {
  return (key, params) => {
    const raw = overlay[key] ?? base[key];
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (whole: string, name: string) => {
      const value = params[name];
      return value === undefined ? whole : String(value);
    });
  };
}

function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(en, key);
}

/** 外部语言文件是用户写的：只留已知的键、且值是字符串的条目，其余一律丢掉。 */
export function sanitizeMessages(input: unknown): Partial<Messages> {
  const messages: Partial<Messages> = {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return messages;
  const entries: [string, unknown][] = Object.entries(input);
  for (const [key, value] of entries) {
    if (isMessageKey(key) && typeof value === 'string') messages[key] = value;
  }
  return messages;
}
