// 查询语法与 Title Formatting 综合清单，供高亮、补全与参考面板共用；
// 条目包含标识与代码示例，说明文案位于语言包 `query.syntax.<kind>.<id>`；字段与函数命名遵循宿主规范

export type SyntaxKind = 'operator' | 'field' | 'function' | 'variable' | 'misc';

/** 参考面板里的分组，也是补全按上下文挑条目的依据 */
export type SyntaxGroup =
  'field' | 'condition' | 'time' | 'connect' | 'sort' | 'function' | 'variable' | 'other';

/** 用在查询里，还是用在 Title Formatting 里（引号里的字段位置、`SORT BY` 之后），或两处 */
export type SyntaxScope = 'query' | 'format';

/** 字段与函数在参考面板里的小节：一组太长时按主题分开，好找 */
export type SyntaxTopic =
  | 'tags'
  | 'stats'
  | 'file'
  | 'audio'
  | 'gain'
  | 'logic'
  | 'read'
  | 'text'
  | 'path'
  | 'math'
  | 'time'
  | 'extra';

export interface SyntaxEntry {
  readonly kind: SyntaxKind;
  /** 稳定标识，语言包键的一段 */
  readonly id: string;
  /** 记号原样：`HAS`、`%artist%`、`$left` */
  readonly name: string;
  /** 签名，参考面板与说明行里原样写出：`<field> HAS <string>`、`$left(X,Y)` */
  readonly signature: string;
  /** 接进框里的模板 */
  readonly insert: string;
  /** 一句完整的写法，参考面板与说明行里原样写出 */
  readonly example?: string;
  /** 接入之后选中的那一截在 `insert` 里的起止，用户直接打字替换；不给时光标落在末尾 */
  readonly select?: readonly [number, number];
  readonly group: SyntaxGroup;
  /** 所在小节；运算符不分小节 */
  readonly topic?: SyntaxTopic;
  readonly scopes: readonly SyntaxScope[];
  /** 字段由别的组件提供：没装时一首都不中 */
  readonly source?: 'playcount';
  /** 与 `source` 连用：另有来源（文件标签）也能提供，没装组件时不算不可用 */
  readonly soft?: boolean;
  /** 技术信息字段：能用，库大时慢 */
  readonly technical?: boolean;
}

const OPERATOR_EXAMPLES: Readonly<Record<string, string>> = {
  has: 'title HAS "blah blah"',
  is: 'artist IS "Igor*"',
  greater: '%rating% GREATER 3',
  less: '%length_seconds% LESS 120',
  equal: '%tracknumber% EQUAL 1',
  missing: 'genre MISSING',
  present: 'genre PRESENT',
  before: '%last_modified% BEFORE 2008',
  after: '%last_modified% AFTER 2008',
  since: '%last_modified% SINCE 2007',
  during: '%last_modified% DURING 2007',
  duringLast: '%added% DURING LAST 2 WEEKS',
  and: 'artist IS blah AND title HAS blah',
  or: 'genre IS rock OR genre IS pop',
  not: 'NOT %rating% PRESENT',
  sortBy: 'artist IS blah SORT BY %title%',
};

const FUNCTION_EXAMPLES: Readonly<Record<string, string>> = {
  if: '$if(%artist%,%artist%,unknown artist)',
  if2: '$if2(%album artist%,%artist%)',
  left: '$left(%date%,3)',
  right: '$right(%date%,2)',
  substr: '$substr(blah,1,2)',
  lower: '$lower(%title%)',
  upper: '$upper(%title%)',
  caps: '$caps(%title%)',
  trim: '$trim(%title%)',
  replace: '$replace(%title%,_, )',
  num: '$num(%tracknumber%,3)',
  abbr: '$abbr(%album%,5)',
  stripprefix: '$stripprefix(%artist%)',
  swapprefix: '$swapprefix(%artist%)',
  meta: '$meta(artist)',
  meta_sep: "$meta_sep(artist,', ',' and ')",
  info: '$info(bitrate)',
  directory: '$directory(%path%,2)',
  directory_path: '$directory_path(%path%)',
  ext: '$ext(%path%)',
  year: '$year(%last_modified%)',
  date: '$date(%last_modified%)',
};

const BOTH: readonly SyntaxScope[] = ['query', 'format'];
const QUERY: readonly SyntaxScope[] = ['query'];
const FORMAT: readonly SyntaxScope[] = ['format'];

function camel(text: string): string {
  const parts = text.split(/[\s_]+/).filter(Boolean);
  return parts
    .map((part, at) => (at === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join('');
}

/** 运算符：`insert` 缺省与名字相同，`select` 取接入后要选中的占位那一截 */
function operator(
  id: string,
  name: string,
  signature: string,
  group: SyntaxGroup,
  insert = name,
  select?: readonly [number, number],
): SyntaxEntry {
  const example = OPERATOR_EXAMPLES[id];
  return { kind: 'operator', id, name, signature, example, insert, select, group, scopes: QUERY };
}

/** 一个主题下的一批字段 */
function fieldsOf(
  topic: SyntaxTopic,
  names: readonly string[],
  extra: Pick<SyntaxEntry, 'technical' | 'source' | 'soft'> = {},
): SyntaxEntry[] {
  return names.map((name) => {
    const text = `%${name}%`;
    return {
      kind: 'field',
      id: camel(name),
      topic,
      name: text,
      signature: text,
      insert: text,
      group: 'field',
      scopes: BOTH,
      ...extra,
    };
  });
}

const tech = { technical: true } as const;
const counted = { source: 'playcount' } as const;
/** 评分：foo_playcount 的数据库里有，文件里的评分标签也读得到 */
const rated = { source: 'playcount', soft: true } as const;

/** 解析主题所属的函数列表；格式为「名称:参数」，无参数仅填名称；首个参数默认选中便于覆写 */
function functionsOf(
  topic: SyntaxTopic,
  specs: readonly string[],
  kind: 'function' | 'variable' = 'function',
): SyntaxEntry[] {
  return specs.map((spec) => {
    const [name = '', args = ''] = spec.split(':');
    const start = name.length + 2;
    const first = args.split(',')[0] ?? '';
    return {
      kind,
      id: camel(name),
      topic,
      name: `$${name}`,
      signature: `$${name}(${args})`,
      example: FUNCTION_EXAMPLES[name],
      insert: `$${name}(${args})`,
      select: args === '' ? undefined : [start, start + first.length],
      group: kind === 'variable' ? 'variable' : 'function',
      scopes: kind === 'variable' ? FORMAT : BOTH,
    };
  });
}

/** 运算符与连接词，按使用的先后：条件、时间、连接、排序 */
export const OPERATORS: readonly SyntaxEntry[] = [
  operator('has', 'HAS', '<field> HAS <string>', 'condition', 'HAS ""', [5, 5]),
  operator('is', 'IS', '<field> IS <string>', 'condition', 'IS ""', [4, 4]),
  operator('greater', 'GREATER', '<field> GREATER <number>', 'condition', 'GREATER 0', [8, 9]),
  operator('less', 'LESS', '<field> LESS <number>', 'condition', 'LESS 0', [5, 6]),
  operator('equal', 'EQUAL', '<field> EQUAL <number>', 'condition', 'EQUAL 0', [6, 7]),
  operator('missing', 'MISSING', '<field> MISSING', 'condition'),
  operator('present', 'PRESENT', '<field> PRESENT', 'condition'),
  operator('before', 'BEFORE', '<time1> BEFORE <time2>', 'time', 'BEFORE 2020', [7, 11]),
  operator('after', 'AFTER', '<time1> AFTER <time2>', 'time', 'AFTER 2020', [6, 10]),
  operator('since', 'SINCE', '<time1> SINCE <time2>', 'time', 'SINCE 2020', [6, 10]),
  operator('during', 'DURING', '<time1> DURING <time2>', 'time', 'DURING 2020', [7, 11]),
  operator(
    'duringLast',
    'DURING LAST',
    '<time> DURING LAST <number> <time-unit>',
    'time',
    'DURING LAST 2 WEEKS',
    [12, 13],
  ),
  operator('and', 'AND', '<expression1> AND <expression2>', 'connect', 'AND '),
  operator('or', 'OR', '<expression1> OR <expression2>', 'connect', 'OR '),
  operator('not', 'NOT', 'NOT <expression>', 'connect', 'NOT '),
  operator('sortBy', 'SORT BY', 'SORT BY <sort-pattern>', 'sort', 'SORT BY %title%', [8, 15]),
  operator(
    'sortDescending',
    'SORT DESCENDING BY',
    'SORT DESCENDING BY <sort-pattern>',
    'sort',
    'SORT DESCENDING BY %title%',
    [19, 26],
  ),
];

/** 字段，帮助里列的；上下文字段（列表序号、播放时间这类）只在播放列表与状态栏里有意义，不收 */
export const FIELDS: readonly SyntaxEntry[] = [
  ...fieldsOf('tags', [
    'title',
    'artist',
    'album artist',
    'track artist',
    'album',
    'date',
    'genre',
    'tracknumber',
    'totaltracks',
    'discnumber',
    'totaldiscs',
  ]),
  ...fieldsOf('stats', ['rating'], rated),
  ...fieldsOf('stats', ['added', 'first_played', 'last_played', 'play_count'], counted),
  ...fieldsOf('file', [
    'filename',
    'filename_ext',
    'directoryname',
    'path',
    'path_sort',
    'subsong',
    'last_modified',
  ]),
  ...fieldsOf('file', ['filesize', 'filesize_natural'], tech),
  ...fieldsOf(
    'audio',
    [
      'codec',
      'codec_profile',
      'codec_long',
      'length',
      'length_seconds',
      'bitrate',
      'channels',
      'samplerate',
      '__encoding',
    ],
    tech,
  ),
  ...fieldsOf('gain', [
    'replaygain_track_gain',
    'replaygain_album_gain',
    'replaygain_track_peak',
    'replaygain_album_peak',
  ]),
];

export const FUNCTIONS: readonly SyntaxEntry[] = [
  ...functionsOf('logic', [
    'if:X,Y,Z',
    'if2:X,Y',
    'if3:X,Y,Z',
    'ifgreater:A,B,C,D',
    'iflonger:A,B,C,D',
    'ifequal:A,B,C,D',
    'and:X,Y',
    'or:X,Y',
    'xor:X,Y',
    'not:X',
    'greater:X,Y',
    'longer:X,Y',
    'strcmp:X,Y',
    'stricmp:X,Y',
  ]),
  ...functionsOf('read', ['meta:X', 'meta_sep:X,Y,Z', 'meta_num:X', 'info:X']),
  ...functionsOf('text', [
    'left:X,Y',
    'right:X,Y',
    'substr:A,B,C',
    'cut:X,Y',
    'len:X',
    'longest:A,B,C',
    'lower:X',
    'upper:X',
    'caps:X',
    'caps2:X',
    'trim:A',
    'replace:A,B,C',
    'insert:A,B,N',
    'repeat:X,N',
    'pad:X,Y,Z',
    'pad_right:X,Y,Z',
    'padcut:X,Y',
    'padcut_right:X,Y',
    'num:X,Y',
    'abbr:X,Y',
    'ansi:X',
    'ascii:X',
    'stripprefix:X',
    'swapprefix:X',
    'strchr:X,Y',
    'strrchr:X,Y',
    'strstr:X,Y',
    'select:N,A,B,C',
    'char:X',
    'tab',
    'fix_eol:X,Y',
  ]),
  ...functionsOf('path', ['directory:X,N', 'directory_path:X', 'ext:X']),
  ...functionsOf('math', [
    'add:X,Y',
    'sub:X,Y',
    'mul:X,Y',
    'div:X,Y',
    'mod:X,Y',
    'min:X,Y',
    'max:X,Y',
    'peak_to_db:X',
    'progress2:A,B,C,D,E',
  ]),
  ...functionsOf('time', [
    'year:time',
    'month:time',
    'day_of_month:time',
    'date:time',
    'time:time',
  ]),
];

export const VARIABLES: readonly SyntaxEntry[] = functionsOf(
  'extra',
  ['put:name,text', 'puts:name,text', 'get:name'],
  'variable',
);

/** 括号里的内容在字段缺失时整段丢弃，与单引号包起来的原样文字 */
export const MISC: readonly SyntaxEntry[] = [
  {
    kind: 'misc',
    id: 'optional',
    topic: 'extra',
    name: '[ ]',
    signature: '[ … ]',
    insert: '[]',
    select: [1, 1],
    group: 'other',
    scopes: FORMAT,
  },
  {
    kind: 'misc',
    id: 'literal',
    topic: 'extra',
    name: "' '",
    signature: "' … '",
    insert: "''",
    select: [1, 1],
    group: 'other',
    scopes: FORMAT,
  },
];

export const SYNTAX_ENTRIES: readonly SyntaxEntry[] = [
  ...OPERATORS,
  ...FIELDS,
  ...FUNCTIONS,
  ...VARIABLES,
  ...MISC,
];

/** 词法要认的关键字：全部大写；时间单位只在 `LAST` 或数字之后才算 */
export const KEYWORDS: ReadonlySet<string> = new Set([
  'AND',
  'OR',
  'NOT',
  'HAS',
  'IS',
  'GREATER',
  'LESS',
  'EQUAL',
  'MISSING',
  'PRESENT',
  'BEFORE',
  'AFTER',
  'SINCE',
  'DURING',
  'LAST',
  'SORT',
  'ASCENDING',
  'DESCENDING',
  'BY',
  'ALL',
]);

export const TIME_UNITS: ReadonlySet<string> = new Set([
  'SECOND',
  'SECONDS',
  'MINUTE',
  'MINUTES',
  'HOUR',
  'HOURS',
  'DAY',
  'DAYS',
  'WEEK',
  'WEEKS',
]);

/** 比较在字段与值之间的运算符：词法凭它认出前面的裸词是字段、后面的是值 */
export const COMPARISONS: ReadonlySet<string> = new Set([
  'HAS',
  'IS',
  'GREATER',
  'LESS',
  'EQUAL',
  'MISSING',
  'PRESENT',
]);

export const TIME_COMPARISONS: ReadonlySet<string> = new Set([
  'BEFORE',
  'AFTER',
  'SINCE',
  'DURING',
]);

const FUNCTION_NAMES: ReadonlySet<string> = new Set(
  [...FUNCTIONS, ...VARIABLES].map((entry) => entry.name.slice(1)),
);

export function isKnownFunction(name: string): boolean {
  return FUNCTION_NAMES.has(name);
}

/** 字段名里没有 `%` 的那一截 */
export function bareFieldName(entry: SyntaxEntry): string {
  return entry.name.slice(1, -1);
}
