/** 日志来源；新增来源先改这里，类型检查会带出所有用到的地方 */
export type LogTag = 'error' | 'host' | 'update' | 'backend';
export type LogLevel = 'warn' | 'error';
/** 字段值只允许这三种；字符串在写入时统一脱敏，调用方不必自己处理 */
export type LogFields = Readonly<Record<string, number | boolean | string>>;

export interface LogEntry {
  /** 最近一次出现的时刻，毫秒时间戳 */
  readonly t: number;
  readonly level: LogLevel;
  readonly tag: LogTag;
  /** 短的英文标识，如 `plugin.cancelled` */
  readonly event: string;
  readonly fields?: LogFields;
  /** 连续重复折叠后的次数与首次出现的时刻；没折叠过时都没有 */
  readonly n?: number;
  readonly first?: number;
}

const CAPACITY = 200;
/** 单个字符串字段的字符数上限，与宿主错误文本的上限同量级 */
const FIELD_LIMIT = 160;
/** 报告全文的字符数上限，给用户自己写的正文留空间 */
const REPORT_LIMIT = 40_000;

const SECRET_LINE = /\b(cookie|set-cookie|authorization)\s*[:=][^\r\n]*/gi;
const SECRET_PAIR =
  /\b(token|MUSIC_U|api[_-]?key|secret|password)["']?\s*[:=]\s*["']?[^\s;,&"']+/gi;
const URL_TEXT = /\bhttps?:\/\/[^\s"'<>)\]]+/gi;
// 盘符与 UNC 路径：目录名可含空格与中文，取到文件名里不能出现的字符为止，冒号后面接分隔符时算下一段盘符
const PATH = /(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\)(?:[^:*?"<>|\r\n]|:(?=[\\/]))*/g;

function withoutQuery(url: string): string {
  try {
    const { origin, pathname } = new URL(url);
    return origin + pathname;
  } catch {
    return '<url>';
  }
}

/** 去掉路径、URL 的查询串与片段、Cookie 与令牌这类有固定形状的敏感内容，并截断 */
export function scrub(text: string): string {
  const clean = text
    .replace(SECRET_LINE, (_, key: string) => `${key}=<secret>`)
    .replace(SECRET_PAIR, (_, key: string) => `${key}=<secret>`)
    .replace(URL_TEXT, withoutQuery)
    .replace(PATH, '<path>');
  return clean.length > FIELD_LIMIT ? `${clean.slice(0, FIELD_LIMIT)}…` : clean;
}

const ring: LogEntry[] = [];

function record(level: LogLevel, tag: LogTag, event: string, fields?: LogFields): void {
  // 写日志不能让调用方失败
  try {
    const t = Date.now();
    const clean =
      fields &&
      Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [
          key,
          typeof value === 'string' ? scrub(value) : value,
        ]),
      );
    const last = ring.at(-1);
    // 字段按写入顺序比较，同一处打点的顺序是固定的
    if (
      last?.level === level &&
      last.tag === tag &&
      last.event === event &&
      JSON.stringify(last.fields) === JSON.stringify(clean)
    ) {
      ring[ring.length - 1] = { ...last, t, n: (last.n ?? 1) + 1, first: last.first ?? last.t };
      return;
    }
    ring.push({ t, level, tag, event, ...(clean ? { fields: clean } : {}) });
    if (ring.length > CAPACITY) ring.shift();
  } catch {
    /* 同上 */
  }
}

/** 同步写入内存环；字符串字段统一脱敏，连续相同的事件折叠成一条 */
export const log = {
  warn: (tag: LogTag, event: string, fields?: LogFields) => record('warn', tag, event, fields),
  error: (tag: LogTag, event: string, fields?: LogFields) => record('error', tag, event, fields),
};

export function entries(): readonly LogEntry[] {
  return ring.slice();
}

export function resetEventLog(): void {
  ring.length = 0;
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

function clock(t: number): string {
  const date = new Date(t);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function stamp(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const zone = `${minutes < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock(date.getTime()).slice(0, 8)} ${zone}`;
}

function line(entry: LogEntry): string {
  const fields = Object.entries(entry.fields ?? {})
    .map(
      ([key, value]) =>
        ` ${key}=${typeof value === 'string' && /^$|[\s"=]/.test(value) ? JSON.stringify(value) : value}`,
    )
    .join('');
  const repeat = entry.n ? ` x${entry.n} (${clock(entry.first ?? entry.t)}-${clock(entry.t)})` : '';
  return `${clock(entry.t)} ${entry.level.toUpperCase().padEnd(5)} ${entry.tag.padEnd(7)} ${entry.event}${fields}${repeat}`;
}

/**
 * 报告全文：调用方给的头在最前，后面是日志。时间用本地时间，块首给日期与时区偏移。超过上限时从最旧一端
 * 截，头与最新的条目必保。不随界面语言变，贴给维护者看
 */
export function reportText(header: string, now = new Date()): string {
  const lines = ring.map(line);
  let from = lines.length;
  let size = header.length;
  while (from > 0 && size + lines[from - 1]!.length + 1 <= REPORT_LIMIT - 200) {
    from -= 1;
    size += lines[from]!.length + 1;
  }
  const omitted = from > 0 ? `, ${from} older omitted` : '';
  return [
    header,
    '',
    `[log] ${lines.length - from} entries, ${stamp(now)}${omitted}`,
    ...lines.slice(from),
  ].join('\n');
}
