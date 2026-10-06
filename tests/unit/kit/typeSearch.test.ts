import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTypeSearch,
  TYPE_SEARCH_EXPIRY_MS,
  TYPE_SEARCH_MAX_CHARS,
} from '../../../src/kit/typeSearch.ts';

afterEach(() => {
  vi.useRealTimers();
});

function setup(words: string[]) {
  const applied: string[] = [];
  const search = createTypeSearch(
    (text) => words.find((word) => word.startsWith(text)),
    (hit) => applied.push(hit),
  );
  return { search, applied };
}

describe('createTypeSearch', () => {
  it('串一变就同步找一次，命中交给 apply', () => {
    const { search, applied } = setup(['apple', 'banana']);
    expect(search.input('b')).toBe(true);
    expect(search.input('a')).toBe(true);
    expect(applied).toEqual(['banana', 'banana']);
    expect(search.state).toEqual({ text: 'ba', noMatch: false });
  });

  it('找不到亮 noMatch，Backspace 退一格再找', () => {
    const { search } = setup(['apple']);
    search.input('x');
    expect(search.state).toEqual({ text: 'x', noMatch: true });
    expect(search.input('Backspace')).toBe(true);
    expect(search.state).toEqual({ text: '', noMatch: false });
    expect(search.input('Backspace')).toBe(false);
  });

  it('不收修饰键名、控制字符与开头的空白；Esc 不归它', () => {
    const { search } = setup(['a b']);
    expect(search.input('Shift')).toBe(false);
    expect(search.input('\u0007')).toBe(false);
    expect(search.input(' ')).toBe(false);
    search.input('a');
    expect(search.input(' ')).toBe(true);
    expect(search.input('Escape')).toBe(false);
    expect(search.state.text).toBe('a ');
  });

  it('串满了吞键不追加', () => {
    const { search } = setup([]);
    for (let at = 0; at < TYPE_SEARCH_MAX_CHARS + 3; at += 1) search.input('z');
    expect(search.state.text).toHaveLength(TYPE_SEARCH_MAX_CHARS);
  });

  it('1 s 没有新键清串，订阅方收到变化', () => {
    vi.useFakeTimers();
    const { search } = setup(['apple']);
    const seen: string[] = [];
    const off = search.subscribe(() => seen.push(search.state.text));
    search.input('a');
    vi.advanceTimersByTime(TYPE_SEARCH_EXPIRY_MS - 1);
    search.input('p');
    vi.advanceTimersByTime(TYPE_SEARCH_EXPIRY_MS);
    expect(seen).toEqual(['a', 'ap', '']);
    off();
    search.input('x');
    expect(seen).toHaveLength(3);
  });

  it('释放后不再收键，定时器撤掉', () => {
    vi.useFakeTimers();
    const { search } = setup(['apple']);
    search.input('a');
    search.dispose();
    expect(search.input('p')).toBe(false);
    vi.advanceTimersByTime(TYPE_SEARCH_EXPIRY_MS);
    expect(search.state.text).toBe('a');
  });
});
