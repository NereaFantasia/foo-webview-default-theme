// 查询菜单里的预设与写法。预设可以勾上、叠加为条件；写法只填进过滤框接着改。两样都是一份清单，各页共用。

export type PresetGroup = 'rating' | 'plays' | 'quality' | 'tags';

export type PresetId =
  | 'highRated'
  | 'unrated'
  | 'recentlyAdded'
  | 'recentlyPlayed'
  | 'frequent'
  | 'neverPlayed'
  | 'lossless'
  | 'hiRes'
  | 'long'
  | 'missingTags';

export interface QueryPreset {
  readonly id: PresetId;
  readonly group: PresetGroup;
  readonly query: string;
}

/** 播放与加入时间那一节要 foo_playcount：没装时它的字段不存在，几条都一首不中，整节置灰。 */
export const PLAYCOUNT_GROUP: PresetGroup = 'plays';

export const PRESET_GROUPS: readonly PresetGroup[] = ['rating', 'plays', 'quality', 'tags'];

/** 阈值与写法都在宿主上核过能用。 */
export const QUERY_PRESETS: readonly QueryPreset[] = [
  { id: 'highRated', group: 'rating', query: '%rating% GREATER 3' },
  { id: 'unrated', group: 'rating', query: '%rating% MISSING' },
  { id: 'recentlyAdded', group: 'plays', query: '%added% DURING LAST 2 WEEKS' },
  { id: 'recentlyPlayed', group: 'plays', query: '%last_played% DURING LAST 1 WEEK' },
  { id: 'frequent', group: 'plays', query: '%play_count% GREATER 4' },
  { id: 'neverPlayed', group: 'plays', query: 'NOT %last_played% PRESENT' },
  { id: 'lossless', group: 'quality', query: '%__encoding% IS lossless' },
  { id: 'hiRes', group: 'quality', query: '%samplerate% GREATER 48000' },
  { id: 'long', group: 'quality', query: '%length_seconds% GREATER 600' },
  { id: 'missingTags', group: 'tags', query: 'NOT %album% PRESENT OR NOT %artist% PRESENT' },
];

export function presetOf(id: PresetId): QueryPreset {
  const preset = QUERY_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`没有这一条预设：${id}`);
  return preset;
}

export function isPresetId(value: unknown): value is PresetId {
  return QUERY_PRESETS.some((preset) => preset.id === value);
}

/** 两条同时勾上一定一首不中：勾上一条时把与它冲突的取消。 */
const CONFLICTS: readonly (readonly [PresetId, PresetId])[] = [
  ['highRated', 'unrated'],
  ['frequent', 'neverPlayed'],
  ['recentlyPlayed', 'neverPlayed'],
];

/** 勾上或取消一条；勾上时去掉与它冲突的。返回新的一份，次序按清单。 */
export function togglePreset(selected: ReadonlySet<PresetId>, id: PresetId): Set<PresetId> {
  const next = new Set(selected);
  if (next.delete(id)) return next;
  next.add(id);
  for (const [a, b] of CONFLICTS) {
    if (a === id) next.delete(b);
    if (b === id) next.delete(a);
  }
  return new Set(QUERY_PRESETS.map((preset) => preset.id).filter((one) => next.has(one)));
}

export type SnippetId = 'decade' | 'format' | 'and' | 'or' | 'not';

/**
 * 「写法」一节：填进框里的一段。`text` 是要接上的那一段，`select` 是填进去之后选中的那一截在 `text` 里的起止，
 * 用户直接打字就换掉它；不给时光标落在末尾。`and`、`or` 只接连接词，前面得已有查询。
 */
export interface QuerySnippet {
  readonly id: SnippetId;
  readonly text: string;
  readonly select?: readonly [number, number];
}

const DECADE = '"$left(%date%,3)" IS 199';
const FORMAT = '%codec% IS flac';

export const QUERY_SNIPPETS: readonly QuerySnippet[] = [
  { id: 'decade', text: DECADE, select: [DECADE.length - 3, DECADE.length] },
  { id: 'format', text: FORMAT, select: [FORMAT.length - 4, FORMAT.length] },
  { id: 'and', text: 'AND ' },
  { id: 'or', text: 'OR ' },
  { id: 'not', text: 'NOT ' },
];

/** 写进框里之后的样子：框里的字与要选中的一截（光标落在末尾时起止相同）。 */
export interface FilledQuery {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** 只编辑高级草稿，不转换文字草稿；返回待选中的参数范围。 */
export function fillQuery(
  current: string,
  piece: Pick<QuerySnippet, 'text' | 'select'>,
  connector = true,
): FilledQuery {
  const existing = current.trim();
  const head = existing === '' ? '' : `${existing} ${connector ? 'AND ' : ''}`;
  const text = `${head}${piece.text}`;
  const [from, to] = piece.select ?? [piece.text.length, piece.text.length];
  return { text, start: head.length + from, end: head.length + to };
}

/** 一段写法填进框时要不要先接 AND：连接词自己就是连接，不再加。 */
export function needsConnector(id: SnippetId): boolean {
  return id !== 'and' && id !== 'or';
}
