import type { MessageKey } from '../i18n/en.ts';
import type { Translate } from '../i18n/translate.ts';
import { allOf, isQueryableValue } from './trackQuery.ts';

interface ConditionFieldDefinition {
  readonly label: MessageKey;
  readonly expression: string;
  readonly kind: 'text' | 'number' | 'recent';
  readonly playcount?: boolean;
  readonly maximum?: number;
}

export const CONDITION_FIELDS = {
  title: { label: 'query.scopeTitle', expression: 'title', kind: 'text' },
  artist: { label: 'query.scopeArtist', expression: 'artist', kind: 'text' },
  albumArtist: { label: 'query.scopeAlbumArtist', expression: '"album artist"', kind: 'text' },
  album: { label: 'query.scopeAlbum', expression: 'album', kind: 'text' },
  genre: { label: 'query.scopeGenre', expression: 'genre', kind: 'text' },
  filename: { label: 'query.scopeFilename', expression: '%filename%', kind: 'text' },
  path: { label: 'table.path', expression: '%path%', kind: 'text' },
  comment: { label: 'query.scopeComment', expression: 'comment', kind: 'text' },
  codec: { label: 'table.codec', expression: '%codec%', kind: 'text' },
  year: { label: 'table.year', expression: '"$left(%date%,4)"', kind: 'number', maximum: 9999 },
  rating: { label: 'table.rating', expression: '%rating%', kind: 'number', maximum: 5 },
  duration: { label: 'query.durationSeconds', expression: '%length_seconds%', kind: 'number' },
  bitrate: { label: 'query.bitrateKbps', expression: '%bitrate%', kind: 'number' },
  sampleRate: { label: 'query.sampleRateHz', expression: '%samplerate%', kind: 'number' },
  channels: { label: 'query.channels', expression: '"$info(channels)"', kind: 'number' },
  playCount: {
    label: 'table.playCount',
    expression: '%play_count%',
    kind: 'number',
    playcount: true,
  },
  added: { label: 'table.added', expression: '%added%', kind: 'recent', playcount: true },
  lastPlayed: {
    label: 'table.lastPlayed',
    expression: '%last_played%',
    kind: 'recent',
    playcount: true,
  },
} as const satisfies Readonly<Record<string, ConditionFieldDefinition>>;

export type ConditionField = keyof typeof CONDITION_FIELDS;
export type ConditionOperator =
  | 'contains'
  | 'is'
  | 'excludes'
  | 'missing'
  | 'atLeast'
  | 'atMost'
  | 'between'
  | 'recent'
  | 'notRecent';

export const CONDITION_OPERATORS: Readonly<
  Record<ConditionFieldDefinition['kind'], readonly ConditionOperator[]>
> = {
  text: ['contains', 'is', 'excludes', 'missing'],
  number: ['is', 'atLeast', 'atMost', 'between', 'missing'],
  recent: ['recent', 'notRecent', 'missing'],
};

export const OPERATOR_LABELS: Readonly<Record<ConditionOperator, MessageKey>> = {
  contains: 'query.contains',
  is: 'query.equals',
  excludes: 'query.excludes',
  missing: 'query.missing',
  atLeast: 'query.atLeast',
  atMost: 'query.atMost',
  between: 'query.between',
  recent: 'query.recentDays',
  notRecent: 'query.notRecentDays',
};

export interface TrackCondition {
  readonly field: ConditionField;
  readonly operator: ConditionOperator;
  readonly value: string;
  readonly end: string;
}

export function conditionKey(condition: TrackCondition): string {
  return JSON.stringify([condition.field, condition.operator, condition.value, condition.end]);
}

export function conditionQuery(condition: TrackCondition): string | null {
  const definition: ConditionFieldDefinition = CONDITION_FIELDS[condition.field];
  const { expression, kind } = definition;
  const { operator } = condition;
  if (!CONDITION_OPERATORS[kind].includes(operator)) return null;
  if (operator === 'missing')
    return `NOT ${condition.field === 'year' ? 'date' : expression} PRESENT`;
  const value = condition.value.trim();
  if (kind === 'text') {
    if (!value || /["\r\n\0]/.test(value) || (operator === 'is' && !isQueryableValue(value)))
      return null;
    const clause = `${expression} ${operator === 'is' ? 'IS' : 'HAS'} "${value.toLowerCase()}"`;
    return operator === 'excludes' ? `NOT (${clause})` : clause;
  }
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > (definition.maximum ?? Number.MAX_SAFE_INTEGER - 1))
    return null;
  if (kind === 'recent') {
    if (number < 1) return null;
    const clause = `${expression} DURING LAST ${number} DAYS`;
    return operator === 'notRecent' ? `NOT (${clause})` : clause;
  }
  if (operator === 'is') return `${expression} EQUAL ${number}`;
  if (operator === 'atLeast') return `${expression} GREATER ${number - 1}`;
  if (operator === 'atMost') return `${expression} LESS ${number + 1}`;
  if (!/^\d+$/.test(condition.end)) return null;
  const end = Number(condition.end);
  if (
    !Number.isSafeInteger(end) ||
    end < number ||
    end > (definition.maximum ?? Number.MAX_SAFE_INTEGER - 1)
  )
    return null;
  return allOf([`${expression} GREATER ${number - 1}`, `${expression} LESS ${end + 1}`]);
}

export function conditionLabel(condition: TrackCondition, t: Translate): string {
  const field = t(CONDITION_FIELDS[condition.field].label);
  const operator = t(OPERATOR_LABELS[condition.operator]);
  if (condition.operator === 'missing') return `${field} · ${operator}`;
  const value =
    condition.operator === 'between' ? `${condition.value}–${condition.end}` : condition.value;
  return `${field} · ${operator} ${value}`;
}
