import {
  CHANGELOG_FORMAT,
  CHANGELOG_ICONS,
  CHANGELOG_LIMITS,
  canonicalLanguage,
  codePoints,
  isCalendarDate,
  readChangelog,
  type ChangelogEntry,
  type ChangelogIcon,
  type ChangelogItem,
  type ChangelogNotes,
} from './changelog.ts';
import { CHANGELOG_LIMIT, compareVersions, isStableVersion } from './contract.ts';

/**
 * 更新日志的源文件，即仓库根的 CHANGELOG.md，写法如下：
 *
 *   ## 0.2.0 - 2026-10-25         版本与日期，日期可省；版本从高到低排
 *   ### zh-CN                     语言，写成规范的大小写
 *   #### 页标题
 *   一段摘要，可以折成几行
 *   - [update] **亮点标题** 说明   续行缩进两格以上
 *   ##### 修复                    标题文字随语言自定，只用在发行页正文里
 *   - 一条修复
 *
 * 第一个版本标题之前是给人看的导语，不解析。这里比读日志的一侧严格：那边遇到写错的条目丢掉了事，
 * 这里遇到就报错停下，并指出是第几行。
 */

export interface SourceEntry extends ChangelogEntry {
  /** 每种语言的修复小节标题，只用来拼发行页正文。 */
  readonly fixesTitles: Readonly<Record<string, string>>;
}

interface DraftLine {
  readonly at: number;
  text: string;
}
interface DraftItem extends DraftLine {
  readonly icon: ChangelogIcon;
  readonly title: string;
}
interface DraftPage {
  readonly at: number;
  readonly language: string;
  title: string | null;
  summary: string | null;
  /** 摘要后面空过一行或已经出现亮点，再来一段就是第二段。 */
  summaryClosed: boolean;
  readonly items: DraftItem[];
  readonly fixes: DraftLine[];
  fixesTitle: string | null;
  /** 缩进的续行接到哪里；空行之后不再接。 */
  open: 'summary' | 'item' | 'fix' | null;
}
interface DraftEntry {
  readonly at: number;
  readonly version: string;
  readonly date: string | null;
  readonly pages: DraftPage[];
}

const HEADING = /^(#{1,6})(?: +(.*))?$/;
const VERSION_HEADING = /^(\S+)(?: - (\S+))?$/;
const ITEM = /^- \[([^\]]*)\] \*\*(.+?)\*\*(?: +(.*))?$/;
const CONTINUATION = /^ {2,}(\S.*)$/;
const OTHER_LIST = /^\s*(?:[*+]|\d+[.)])\s/;
const WIDE = /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u;

function fail(at: number, message: string): never {
  throw new Error(`CHANGELOG.md 第 ${at} 行：${message}`);
}

function limit(at: number, label: string, value: string, max: number): string {
  if (codePoints(value) > max) fail(at, `${label}超过 ${max} 个字符`);
  return value;
}

/** 折行接回一行：接缝两边都是中文字符或全角标点时直接相连，否则隔一个空格。 */
function joinLines(head: string, tail: string): string {
  const last = Array.from(head).at(-1) ?? '';
  const first = Array.from(tail).at(0) ?? '';
  return WIDE.test(last) && WIDE.test(first) ? head + tail : `${head} ${tail}`;
}

function isIcon(value: string): value is ChangelogIcon {
  return (CHANGELOG_ICONS as readonly string[]).includes(value);
}

function startEntry(at: number, heading: string, before: readonly SourceEntry[]): DraftEntry {
  const match = VERSION_HEADING.exec(heading);
  const version = match?.[1] ?? '';
  const date = match?.[2] ?? null;
  if (!isStableVersion(version))
    fail(at, '二级标题要写成「版本」或「版本 - YYYY-MM-DD」，版本是稳定版号');
  if (date !== null && !isCalendarDate(date)) fail(at, `日期 ${date} 不存在，要写成 YYYY-MM-DD`);
  if (before.some((entry) => entry.version === version)) fail(at, `版本 ${version} 写了两次`);
  const previous = before.at(-1);
  if (previous && (compareVersions(previous.version, version) ?? 0) <= 0)
    fail(at, `版本要从高到低排，${version} 不应排在 ${previous.version} 后面`);
  if (before.length >= CHANGELOG_LIMITS.entries)
    fail(at, `版本超过 ${CHANGELOG_LIMITS.entries} 个`);
  return { at, version, date, pages: [] };
}

function startPage(at: number, language: string, entry: DraftEntry): DraftPage {
  const canonical = canonicalLanguage(language);
  if (canonical === null) fail(at, `语言标签 ${language} 写错了，要写成 zh-CN、en 这样的标签`);
  if (canonical !== language) fail(at, `语言标签要写成规范形式 ${canonical}`);
  if (entry.pages.some((page) => page.language === language)) fail(at, `语言 ${language} 写了两次`);
  if (entry.pages.length >= CHANGELOG_LIMITS.languages)
    fail(at, `语言超过 ${CHANGELOG_LIMITS.languages} 种`);
  return {
    at,
    language,
    title: null,
    summary: null,
    summaryClosed: false,
    items: [],
    fixes: [],
    fixesTitle: null,
    open: null,
  };
}

function pageHeading(at: number, level: number, heading: string, page: DraftPage | null): void {
  if (level === 4) {
    if (!page) fail(at, '四级页标题要写在三级语言标题下面');
    if (page.title !== null) fail(at, '每页只能有一个四级页标题');
    if (!heading) fail(at, '页标题是空的');
    page.title = limit(at, '页标题', heading, CHANGELOG_LIMITS.title);
    return;
  }
  if (level === 5) {
    if (!page || page.title === null) fail(at, '修复小节要写在页标题后面');
    if (page.fixesTitle !== null) fail(at, '每页只能有一个修复小节');
    if (!heading) fail(at, '修复小节的标题是空的');
    page.fixesTitle = heading;
    page.summaryClosed = true;
    page.open = null;
    return;
  }
  fail(at, `认不出的 ${level} 级标题，版本里只用二到五级`);
}

function pageLine(at: number, line: string, page: DraftPage | null): void {
  if (!page) fail(at, '内容要写在三级语言标题下面');
  if (page.title === null) fail(at, '语言标题下第一项要是四级页标题');
  const continued = CONTINUATION.exec(line);
  if (continued) {
    const rest = continued[1] ?? '';
    const last =
      page.open === 'item'
        ? page.items.at(-1)
        : page.open === 'fix'
          ? page.fixes.at(-1)
          : undefined;
    if (!last) fail(at, '缩进的续行要紧跟在亮点或修复后面');
    last.text = last.text ? joinLines(last.text, rest) : rest;
    return;
  }
  if (OTHER_LIST.test(line)) fail(at, '列表只用 - 开头');
  if (line === '-' || line.startsWith('- ')) {
    page.summaryClosed = true;
    if (page.fixesTitle === null) {
      const item = ITEM.exec(line);
      if (!item) fail(at, '亮点要写成 - [图标] **标题** 说明');
      const icon = item[1] ?? '';
      if (!isIcon(icon)) fail(at, `图标 ${icon} 不认识，可用：${CHANGELOG_ICONS.join('、')}`);
      if (page.items.length >= CHANGELOG_LIMITS.items)
        fail(at, `亮点超过 ${CHANGELOG_LIMITS.items} 条`);
      const title = limit(at, '亮点标题', (item[2] ?? '').trim(), CHANGELOG_LIMITS.title);
      page.items.push({ at, icon, title, text: (item[3] ?? '').trim() });
      page.open = 'item';
    } else {
      const text = line.slice(1).trim();
      if (!text) fail(at, '修复是空的');
      if (page.fixes.length >= CHANGELOG_LIMITS.fixes)
        fail(at, `修复超过 ${CHANGELOG_LIMITS.fixes} 条`);
      page.fixes.push({ at, text });
      page.open = 'fix';
    }
    return;
  }
  if (page.summaryClosed) fail(at, '摘要只能有一段，并且写在亮点之前');
  const text = line.trim();
  page.summary = page.summary === null ? text : joinLines(page.summary, text);
  page.open = 'summary';
}

function finishPage(page: DraftPage): { notes: ChangelogNotes; fixesTitle: string | null } {
  const title = page.title;
  if (title === null) fail(page.at, '这一页缺四级页标题');
  if (page.fixesTitle !== null && page.fixes.length === 0) fail(page.at, '修复小节下面没有条目');
  const summary = limit(page.at, '摘要', page.summary ?? '', CHANGELOG_LIMITS.summary);
  const items: ChangelogItem[] = page.items.map((item) => ({
    icon: item.icon,
    title: item.title,
    text: limit(item.at, '亮点说明', item.text, CHANGELOG_LIMITS.text),
  }));
  const fixes = page.fixes.map((fix) => limit(fix.at, '修复', fix.text, CHANGELOG_LIMITS.text));
  if (!summary && items.length === 0 && fixes.length === 0)
    fail(page.at, '这一页只有标题：摘要、亮点、修复至少写一项');
  return { notes: { title, summary, items, fixes }, fixesTitle: page.fixesTitle };
}

function finishEntry(entry: DraftEntry): SourceEntry {
  if (entry.pages.length === 0) fail(entry.at, '这个版本一种语言都没写');
  const notes: Record<string, ChangelogNotes> = {};
  const fixesTitles: Record<string, string> = {};
  for (const page of entry.pages) {
    const done = finishPage(page);
    notes[page.language] = done.notes;
    if (done.fixesTitle !== null) fixesTitles[page.language] = done.fixesTitle;
  }
  return { version: entry.version, date: entry.date, notes, fixesTitles };
}

/** 按版本从高到低交回全部条目；任何一处写得不合要求都抛错，消息里带行号。 */
export function parseChangelogSource(source: string): SourceEntry[] {
  const entries: SourceEntry[] = [];
  let entry: DraftEntry | null = null;
  let page: DraftPage | null = null;
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const at = index + 1;
    const line = raw.trimEnd();
    const heading = HEADING.exec(line);
    const level = heading?.[1]?.length ?? 0;
    const title = (heading?.[2] ?? '').trim();
    if (level === 2) {
      if (entry) entries.push(finishEntry(entry));
      entry = startEntry(at, title, entries);
      page = null;
    } else if (!entry) {
      // 导语
    } else if (level === 3) {
      page = startPage(at, title, entry);
      entry.pages.push(page);
    } else if (level > 0) {
      pageHeading(at, level, title, page);
    } else if (!line) {
      if (page?.open === 'summary') page.summaryClosed = true;
      if (page) page.open = null;
    } else {
      pageLine(at, line, page);
    }
  }
  if (entry) entries.push(finishEntry(entry));
  return entries;
}

function published(entry: ChangelogEntry) {
  return {
    version: entry.version,
    ...(entry.date === null ? {} : { date: entry.date }),
    notes: entry.notes,
  };
}

/**
 * 到 `upto` 为止的累计日志文本，前端包自带的副本与发行附件是同一份。生成后按读日志的同一套代码读回，
 * 内容对不上或超出大小上限就报错。
 */
export function changelogJson(entries: readonly ChangelogEntry[], upto: string): string {
  const kept = entries.filter((entry) => (compareVersions(entry.version, upto) ?? 1) <= 0);
  const text =
    JSON.stringify({ format: CHANGELOG_FORMAT, entries: kept.map(published) }, null, 2) + '\n';
  if (new TextEncoder().encode(text).length > CHANGELOG_LIMIT)
    throw new Error(`更新日志超过 ${CHANGELOG_LIMIT} 字节`);
  const expected = kept.map(({ version, date, notes }) => ({ version, date, notes }));
  if (JSON.stringify(readChangelog(text)) !== JSON.stringify(expected))
    throw new Error('读回的更新日志与生成的不一致');
  return text;
}

/** 发行页正文：每种语言一段 Markdown，zh-CN、en 排在前面。 */
export function releaseNotes(entry: SourceEntry): Record<string, string> {
  const notes: Record<string, string> = {};
  for (const language of ['zh-CN', 'en', ...Object.keys(entry.notes)]) {
    const page = entry.notes[language];
    if (!page || Object.hasOwn(notes, language)) continue;
    const blocks = [`### ${page.title}`];
    if (page.summary) blocks.push(page.summary);
    if (page.items.length)
      blocks.push(
        page.items
          .map((item) => `- **${item.title}**${item.text ? ` ${item.text}` : ''}`)
          .join('\n'),
      );
    if (page.fixes.length)
      blocks.push(
        `#### ${entry.fixesTitles[language] ?? 'Fixes'}`,
        page.fixes.map((fix) => `- ${fix}`).join('\n'),
      );
    notes[language] = blocks.join('\n\n');
  }
  return notes;
}
