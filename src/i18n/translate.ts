import { en, type MessageKey, type Messages } from './en.ts';
import { zhCN } from './zhCN.ts';

/** 内置支持的语言标签集合。扩展语言由 profile 下的外部文件提供 */
export type BuiltinTag = 'en' | 'zh-CN';
export const BUILTIN_TAGS: readonly BuiltinTag[] = ['en', 'zh-CN'];
export const BUILTIN_MESSAGES: Readonly<Record<BuiltinTag, Messages>> = { en, 'zh-CN': zhCN };

export function isBuiltinTag(tag: string): tag is BuiltinTag {
  return tag === 'en' || tag === 'zh-CN';
}

/** 将语言标签映射为内置包。以 zh 开头的标签映射到 zh-CN，其余回退到 en */
export function resolveBuiltin(tag: string): BuiltinTag {
  return tag.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export type TranslateParams = Readonly<Record<string, string | number>>;
export type Translate = (key: MessageKey, params?: TranslateParams) => string;

/**
 * 创建翻译函数。优先读取覆盖层，缺失时回落到基准包。
 * `{name}` 占位符按参数替换，未提供参数时保留原占位符以便排查
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

/** 校验并清理外部语言包对象，仅保留合法的 MessageKey 且值为字符串的条目 */
export function sanitizeMessages(input: unknown): Partial<Messages> {
  const messages: Partial<Messages> = {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return messages;
  const entries: [string, unknown][] = Object.entries(input);
  for (const [key, value] of entries) {
    if (isMessageKey(key) && typeof value === 'string') messages[key] = value;
  }
  return messages;
}
