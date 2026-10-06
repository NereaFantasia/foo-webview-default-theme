import { expect, it } from 'vitest';
import {
  changeQueryText,
  EMPTY_QUERY_INPUT,
  queryInputText,
} from '../../../src/track/queryInput.ts';

it('输入内容不改变模式，编辑和清空仅作用于当前草稿', () => {
  const plain = changeQueryText(EMPTY_QUERY_INPUT, '? %title%');
  expect(plain.mode).toBe('text');
  expect(queryInputText(plain)).toBe('? %title%');
  const advanced = changeQueryText({ ...plain, mode: 'advanced' }, 'genre IS jazz');
  expect(queryInputText(advanced)).toBe('genre IS jazz');
  expect(advanced.text).toBe('? %title%');
  expect(changeQueryText(advanced, '')).toEqual({
    mode: 'advanced',
    text: '? %title%',
    advancedText: '',
  });
  expect(queryInputText({ ...advanced, mode: 'text' })).toBe('? %title%');
  expect(EMPTY_QUERY_INPUT).toEqual({ mode: 'text', text: '', advancedText: '' });
});
