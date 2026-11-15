/** 字体名只收不超过 200 个字符、没有控制字符的串；这里放的是单个家族名，不是字体栈 */
export function isFontName(value: string): boolean {
  return (
    value.length <= 200 && [...value].every((char) => char >= ' ' && char.charCodeAt(0) !== 127)
  );
}

/** 读出来的值不合格或只有空白时当没选过 */
export function fontNameOf(raw: unknown): string {
  return typeof raw === 'string' && isFontName(raw.trim()) ? raw.trim() : '';
}

/** 家族名写进 `font-family` 时整个加引号，里面的引号与反斜杠转义 */
export function quoteFont(name: string): string {
  return `"${name.replace(/[\\"]/g, '\\$&')}"`;
}

/** 界面用的两个字体，空串是用默认 */
export interface FontChoice {
  readonly latin: string;
  readonly cjk: string;
}

export const DEFAULT_FONT_CHOICE: FontChoice = { latin: '', cjk: '' };

const FLUENT_TAIL = "-apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', sans-serif";

const joined = (parts: readonly (string | false)[]) => parts.filter(Boolean).join(', ');

/**
 * 界面字体栈：用户的西文字体，默认西文字体，用户的中日韩字体，Fluent 默认栈的其余部分
 * 中日韩字体必须排在 `sans-serif` 之前：Fluent 的默认栈以它收尾，排在后面的字体永远轮不到；
 * 又不能排在西文字体之前，否则会抢走西文字形
 */
export function fontStack({ latin, cjk }: FontChoice): string {
  return joined([
    latin && quoteFont(latin),
    "'Segoe UI'",
    "'Segoe UI Web (West European)'",
    cjk && quoteFont(cjk),
    FLUENT_TAIL,
  ]);
}

/** 菜单与浮层的字体栈：照 Windows 菜单的写法，中日韩字体取微软雅黑 UI，同样让用户的选择排在前面 */
export function menuFontStack({ latin, cjk }: FontChoice): string {
  return joined([
    latin && quoteFont(latin),
    "'Segoe UI Variable'",
    "'Segoe UI'",
    cjk && quoteFont(cjk),
    "'Microsoft YaHei UI'",
    'sans-serif',
  ]);
}
