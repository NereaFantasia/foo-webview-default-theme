import type { BuiltinTag } from '../i18n/translate.ts';
import {
  PLUGIN_COMPONENT,
  compareVersions,
  isStableVersion,
  satisfies,
  type Candidate,
} from './contract.ts';
import type { SelectionContext } from './releaseSelection.ts';

/**
 * 累计更新日志：每个发布过的版本一条，每种语言一页：标题、摘要、几条带图标的亮点和修复，全是纯文本。
 * 只用来展示，能不能更新仍看根清单。远端那份与前端包自带的那份格式相同；超出上限的部分截掉，
 * 单条写错时丢掉这一条，不判整份损坏。
 */

export const CHANGELOG_FORMAT = 1;
/** 亮点能用的图标；不认识的图标名按 sparkle 显示。 */
export const CHANGELOG_ICONS = [
  'sparkle',
  'update',
  'log',
  'player',
  'palette',
  'library',
  'lyrics',
  'search',
  'window',
  'fix',
] as const;
export type ChangelogIcon = (typeof CHANGELOG_ICONS)[number];

/** 读日志时的上限，生成日志时按同一套上限校验。文字长度按码点计，截断不会切开 emoji。 */
export const CHANGELOG_LIMITS = {
  entries: 1000,
  languages: 16,
  title: 80,
  summary: 600,
  items: 8,
  fixes: 100,
  text: 1000,
} as const;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/;

export interface ChangelogItem {
  readonly icon: ChangelogIcon;
  readonly title: string;
  /** 一两句说明；没写时为空串。 */
  readonly text: string;
}

/** 一个版本在一种语言下的那一页。 */
export interface ChangelogNotes {
  /** 这一版最主要的变化，必有。 */
  readonly title: string;
  /** 一段摘要；没写时为空串。摘要、亮点、修复至少有一项不空。 */
  readonly summary: string;
  readonly items: readonly ChangelogItem[];
  readonly fixes: readonly string[];
}

export interface ChangelogEntry {
  readonly version: string;
  /** 发布日期，`YYYY-MM-DD`；没写时为 null。 */
  readonly date: string | null;
  /** 规范大小写的语言标签到这一页；写错的语言不收。 */
  readonly notes: Readonly<Record<string, ChangelogNotes>>;
}

/** 按码点计的长度。 */
export function codePoints(value: string): number {
  return Array.from(value).length;
}

/** `YYYY-MM-DD`，并且日历上真有这一天。 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** 规范大小写后的语言标签，如 `zh-cn` 读作 `zh-CN`；写错的返回 null。 */
export function canonicalLanguage(tag: unknown): string | null {
  if (typeof tag !== 'string' || !LANGUAGE_PATTERN.test(tag)) return null;
  try {
    const [canonical] = Intl.getCanonicalLocales(tag);
    return canonical ?? null;
  } catch {
    return null;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const characters = Array.from(trimmed);
  return characters.length > max ? characters.slice(0, max).join('') : trimmed;
}

/** 逐项读，读不出的跳过，收满 `max` 项为止。 */
function list<T>(value: unknown, read: (item: unknown) => T | null, max: number): T[] {
  if (!Array.isArray(value)) return [];
  const read_: T[] = [];
  for (const item of value) {
    if (read_.length >= max) break;
    const one = read(item);
    if (one !== null) read_.push(one);
  }
  return read_;
}

function isIcon(value: unknown): value is ChangelogIcon {
  return (CHANGELOG_ICONS as readonly unknown[]).includes(value);
}

function item(value: unknown): ChangelogItem | null {
  if (!record(value)) return null;
  const title = text(value.title, CHANGELOG_LIMITS.title);
  if (!title) return null;
  return {
    icon: isIcon(value.icon) ? value.icon : 'sparkle',
    title,
    text: text(value.text, CHANGELOG_LIMITS.text),
  };
}

function fix(value: unknown): string | null {
  return text(value, CHANGELOG_LIMITS.text) || null;
}

function page(value: unknown): ChangelogNotes | null {
  if (!record(value)) return null;
  const title = text(value.title, CHANGELOG_LIMITS.title);
  const summary = text(value.summary, CHANGELOG_LIMITS.summary);
  const items = list(value.items, item, CHANGELOG_LIMITS.items);
  const fixes = list(value.fixes, fix, CHANGELOG_LIMITS.fixes);
  if (!title || (!summary && items.length === 0 && fixes.length === 0)) return null;
  return { title, summary, items, fixes };
}

function entry(value: unknown): ChangelogEntry | null {
  if (!record(value) || !isStableVersion(value.version) || !record(value.notes)) return null;
  const date = isCalendarDate(value.date) ? value.date : null;
  const notes: Record<string, ChangelogNotes> = {};
  let languages = 0;
  for (const [tag, raw] of Object.entries(value.notes)) {
    const language = canonicalLanguage(tag);
    if (language === null) continue;
    if (languages >= CHANGELOG_LIMITS.languages) break;
    languages += 1;
    const read = page(raw);
    // 大小写不同的同一种语言只留第一份读得出的。
    if (read && !Object.hasOwn(notes, language)) notes[language] = read;
  }
  return { version: value.version, date, notes };
}

/** 读不懂格式或顶层结构不对时返回 null；结果按版本从高到低排列，同一版本只留第一条。 */
export function readChangelog(text: string): readonly ChangelogEntry[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!record(value) || value.format !== CHANGELOG_FORMAT || !Array.isArray(value.entries))
    return null;
  const seen = new Set<string>();
  const entries: ChangelogEntry[] = [];
  for (const item of value.entries.slice(0, CHANGELOG_LIMITS.entries)) {
    const read = entry(item);
    if (!read || seen.has(read.version)) continue;
    seen.add(read.version);
    entries.push(read);
  }
  return entries.sort((a, b) => compareVersions(b.version, a.version) ?? 0);
}

export interface EntryNotes {
  /** 一种语言都没写时为 null。 */
  readonly notes: ChangelogNotes | null;
  /** 实际用的语言；与界面语言不同时界面要标注。 */
  readonly language: string | null;
}

/** 整页取一种语言，不逐项混用：先取界面语言，缺的话改用另一种内置语言，再缺就取第一种写了的语言。 */
export function notesFor(item: ChangelogEntry, tag: BuiltinTag): EntryNotes {
  const other: BuiltinTag = tag === 'en' ? 'zh-CN' : 'en';
  for (const language of [tag, other, ...Object.keys(item.notes)]) {
    const found = item.notes[language];
    if (found) return { notes: found, language };
  }
  return { notes: null, language: null };
}

export interface ChangelogCatalog {
  readonly candidates: readonly Candidate[];
  readonly context: SelectionContext;
  readonly pending: string | null;
  readonly target: string | null;
}

export type ChangelogVersionState =
  | 'current'
  | 'pending'
  | 'revoked'
  | 'available'
  | 'included'
  | 'plugin'
  | 'manual'
  | 'unavailable'
  | 'old';

/** 日志不能授权安装；只有更新器按签名根清单选中的目标才标成可更新。 */
export function changelogVersionState(
  version: string,
  catalog: ChangelogCatalog,
): ChangelogVersionState {
  const { context, candidates, pending, target } = catalog;
  if (version === context.current) return 'current';
  if (version === pending) return 'pending';
  if (context.revoked.includes(version)) return 'revoked';
  if (version === target) return 'available';
  if ((compareVersions(version, context.current) ?? 0) <= 0) return 'old';
  if (target && (compareVersions(version, target) ?? 0) < 0) return 'included';
  const candidate = candidates.find((entry) => entry.version === version);
  if (!candidate) return 'unavailable';
  const plugin = candidate.requires[PLUGIN_COMPONENT];
  if (plugin && !satisfies(context.plugin, plugin)) return 'plugin';
  if (
    !satisfies(context.current, candidate.upgradeFrom) ||
    candidate.requiresLoader > context.loader ||
    Object.keys(candidate.requires).some((name) => name !== PLUGIN_COMPONENT)
  )
    return 'manual';
  return 'unavailable';
}
