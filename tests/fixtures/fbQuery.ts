import type { PlaylistTrack } from 'foo-webview-sdk';

/**
 * 宿主替身用的 fb2k 查询求值，只覆盖主题会生成的子集：`HAS`、`IS`、`EQUAL`、`GREATER`、`LESS`、`PRESENT`、
 * `MISSING`、`DURING LAST`（替身里没有时间，一律不命中）、`AND`、`OR`、`NOT`、括号与 `ALL`。字段只认标题、艺人、
 * 专辑艺人、专辑、流派、日期（含前四位）、注释、文件名、评分、时长、编码；别的字段当没有值。语法认不出时答
 * `'invalid'`，与宿主答 `INVALID_PARAMS` 对应。文字比较不分大小写，足够测试用，不模仿宿主对大小写的规则
 */
export type QueryVerdict = boolean | 'invalid';

class QuerySyntaxError extends Error {}

function tokensOf(query: string): string[] {
  const tokens: string[] = [];
  const pattern = /\s*(\(|\)|"[^"]*"|[^\s()"]+)/y;
  let at = 0;
  for (;;) {
    pattern.lastIndex = at;
    const match = pattern.exec(query);
    if (!match) break;
    tokens.push(match[1] ?? '');
    at = pattern.lastIndex;
  }
  if (query.slice(at).trim() !== '') throw new QuerySyntaxError(query);
  return tokens;
}

const unquote = (token: string) =>
  token.startsWith('"') && token.endsWith('"') && token.length >= 2 ? token.slice(1, -1) : token;
const text = (value: unknown) =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
const present = (value: string) => (value === '' ? [] : [value]);

function valuesOf(row: PlaylistTrack, field: string): string[] {
  const name = field.replace(/^%|%$/g, '').toLowerCase();
  switch (name) {
    case 'title':
      return present(text(row.title));
    case 'artist': {
      const artists = (row.artists ?? []).filter((artist) => artist !== '');
      return artists.length > 0 ? artists : present(text(row.artist));
    }
    case 'album artist':
      return present(text(row.albumArtist));
    case 'album':
      return present(text(row.album));
    case 'genre':
      return text(row.genre)
        .split(', ')
        .filter((genre) => genre !== '');
    case 'date':
      return present(text(row.date));
    case '$left(%date%,4)':
      return present(text(row.date).slice(0, 4));
    case 'comment':
      return present(text(row.comment));
    case 'filename':
      return present(
        text(row.path)
          .slice(text(row.path).lastIndexOf('/') + 1)
          .replace(/\.[^.]*$/, ''),
      );
    case 'rating':
      return row.rating ? [String(row.rating)] : [];
    case 'length_seconds':
      return present(text(row.duration));
    case 'codec':
      return present(text(row.codec));
    default:
      return [];
  }
}

class Evaluation {
  private at = 0;

  constructor(
    private readonly tokens: readonly string[],
    private readonly row: PlaylistTrack,
  ) {}

  run(): boolean {
    const value = this.or();
    if (this.at < this.tokens.length) throw new QuerySyntaxError('多余的记号');
    return value;
  }

  private take(): string {
    const token = this.tokens[this.at];
    if (token === undefined) throw new QuerySyntaxError('查询在中途结束');
    this.at += 1;
    return token;
  }

  private keyword(word: string): boolean {
    if (this.tokens[this.at] !== word) return false;
    this.at += 1;
    return true;
  }

  private or(): boolean {
    let value = this.and();
    while (this.keyword('OR')) {
      const next = this.and();
      value = value || next;
    }
    return value;
  }

  private and(): boolean {
    let value = this.not();
    while (this.keyword('AND')) {
      const next = this.not();
      value = value && next;
    }
    return value;
  }

  private not(): boolean {
    return this.keyword('NOT') ? !this.not() : this.primary();
  }

  private primary(): boolean {
    const token = this.take();
    if (token === '(') {
      const value = this.or();
      if (this.take() !== ')') throw new QuerySyntaxError('括号没有配对');
      return value;
    }
    return token === 'ALL' ? true : this.clause(token);
  }

  private clause(fieldToken: string): boolean {
    const values = valuesOf(this.row, unquote(fieldToken));
    const operator = this.take();
    if (operator === 'PRESENT') return values.length > 0;
    if (operator === 'MISSING') return values.length === 0;
    if (operator === 'DURING') {
      // `DURING LAST 2 WEEKS`：替身里没有时间，不命中
      this.take();
      this.take();
      this.take();
      return false;
    }
    const operand = unquote(this.take()).toLowerCase();
    if (operator === 'HAS') return values.some((value) => value.toLowerCase().includes(operand));
    if (operator === 'IS') return values.some((value) => value.toLowerCase() === operand);
    const number = Number(operand);
    if (Number.isNaN(number)) throw new QuerySyntaxError('不是数字');
    if (operator === 'EQUAL') return values.some((value) => Number(value) === number);
    if (operator === 'GREATER') return values.some((value) => Number(value) > number);
    if (operator === 'LESS') return values.some((value) => Number(value) < number);
    throw new QuerySyntaxError(`不认识的运算符 ${operator}`);
  }
}

export function matchFbQuery(query: string, row: PlaylistTrack): QueryVerdict {
  try {
    return new Evaluation(tokensOf(query), row).run();
  } catch (error) {
    if (error instanceof QuerySyntaxError) return 'invalid';
    throw error;
  }
}
