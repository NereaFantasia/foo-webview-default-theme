export type QueryMode = 'text' | 'advanced';

export interface QueryInput {
  readonly mode: QueryMode;
  readonly text: string;
  readonly advancedText: string;
}

export const EMPTY_QUERY_INPUT: QueryInput = { mode: 'text', text: '', advancedText: '' };

export const QUERY_DEBOUNCE_MS = 300;

export function queryInputText(input: QueryInput): string {
  return input.mode === 'advanced' ? input.advancedText : input.text;
}

export function changeQueryText(input: QueryInput, text: string): QueryInput {
  return input.mode === 'advanced' ? { ...input, advancedText: text } : { ...input, text };
}
