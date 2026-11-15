type Query = () => Promise<unknown>;

/** 没有本机字体列表时下拉里给的常用字体；只列本机装了的 */
export const COMMON_FONTS: readonly string[] = [
  'Segoe UI',
  'Segoe UI Variable Text',
  'Microsoft YaHei UI',
  'Microsoft YaHei',
  'DengXian',
  'SimSun',
  'SimHei',
  'KaiTi',
  'FangSong',
  'Yu Gothic UI',
  'Meiryo UI',
  'Malgun Gothic',
  'Arial',
  'Calibri',
  'Cambria',
  'Consolas',
  'Georgia',
  'Times New Roman',
  'Verdana',
  'Tahoma',
  'Bahnschrift',
  'Cascadia Mono',
  'Cascadia Code',
  'Noto Sans SC',
  'Source Han Sans SC',
  'Inter',
];

/** Local Font Access API；没有这个接口时答 undefined */
function localFontsQuery(): Query | undefined {
  const query: unknown = Reflect.get(globalThis, 'queryLocalFonts');
  return typeof query === 'function'
    ? () => Promise.resolve(Reflect.apply(query, globalThis, []))
    : undefined;
}

function familiesOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const families = raw.flatMap((item: unknown) => {
    const family: unknown =
      typeof item === 'object' && item !== null ? Reflect.get(item, 'family') : undefined;
    return typeof family === 'string' && family.trim() ? [family.trim()] : [];
  });
  return [...new Set(families)].sort((a, b) => a.localeCompare(b));
}

/**
 * 本机字体的家族名。接口按命名实例各给一条（Bahnschrift 就有十几条），这里按家族去重排序
 *
 * 必须在用户手势（点击、按键）里调用，否则浏览器直接拒绝；首次会触发 `LocalFonts` 权限请求，
 * 宿主不处理时由 WebView2 自带的询问框决定。用户拒绝、没有接口或出错都答 null，下次调用再试
 * 成功的结果在页面存活期间复用，同时发起的几次调用共用一次请求
 */
export function createSystemFonts(query: () => Query | undefined = localFontsQuery) {
  let cached: readonly string[] | null = null;
  let pending: Promise<readonly string[] | null> | null = null;
  return function load(): Promise<readonly string[] | null> {
    if (cached) return Promise.resolve(cached);
    const ask = query();
    if (!ask) return Promise.resolve(null);
    pending ??= ask()
      .then((raw) => {
        const families = familiesOf(raw);
        cached = families.length > 0 ? families : null;
        return cached;
      })
      .catch(() => null)
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}

export const loadSystemFonts = createSystemFonts();

/** 用 `measure` 量一串字在给定 `font-family` 下的宽度 */
export type MeasureFont = (family: string) => number;

/** 一个绘图上下文量多个字体：每次新建会白白多出一批 */
export function canvasMeasure(): MeasureFont | null {
  if (typeof document === 'undefined') return null;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return null;
  return (family) => {
    context.font = `40px ${family}`;
    return context.measureText('Hamburgefonstiv 春江 iiiWWW').width;
  };
}

/**
 * 本机有没有这个字体：同一个名字分别接 serif 与 monospace 两种后备，两次宽度相同说明用的是它本身，
 * 不同说明名字没匹配上、各自落到了后备字体。拿不到绘图上下文（`measure` 为 null）时当作有
 */
export function fontInstalled(name: string, measure: MeasureFont | null): boolean {
  if (!measure) return true;
  const quoted = `"${name.replace(/[\\"]/g, '\\$&')}"`;
  return measure(`${quoted}, serif`) === measure(`${quoted}, monospace`);
}
