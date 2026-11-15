// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRetained } from '../../../src/kit/useRetained.ts';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

describe('useRetained', () => {
  let environment: ActEnvironment;

  beforeEach(() => {
    environment = globalThis as ActEnvironment;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    delete environment.IS_REACT_ACT_ENVIRONMENT;
  });

  it('值被清空后仍给最近一次的非空值，新的非空值来了就换成新的', () => {
    const root = createRoot(document.createElement('div'));
    const seen: (string | undefined)[] = [];
    function Harness({ value }: { readonly value: string | null | undefined }) {
      seen.push(useRetained(value));
      return null;
    }
    const render = (value: string | null | undefined) =>
      act(() => root.render(createElement(Harness, { value })));
    render(null);
    render('a');
    render(null);
    render(undefined);
    render('b');
    render(null);
    act(() => root.unmount());
    // 最后一次渲染之前的重复项来自同一轮里的补渲染，只看相邻去重后的序列
    expect(seen.filter((value, index) => index === 0 || value !== seen[index - 1])).toEqual([
      undefined,
      'a',
      'b',
    ]);
  });
});
