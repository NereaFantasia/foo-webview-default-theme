// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStableCallback } from '../../../src/kit/useStableCallback.ts';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

describe('useStableCallback', () => {
  let environment: ActEnvironment;

  beforeEach(() => {
    environment = globalThis as ActEnvironment;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    delete environment.IS_REACT_ACT_ENVIRONMENT;
  });

  it('引用跨渲染不变，调用时转给最近一次渲染的回调', () => {
    const root = createRoot(document.createElement('div'));
    const seen: ((value: number) => string)[] = [];
    function Harness({ prefix }: { readonly prefix: string }) {
      seen.push(useStableCallback((value: number) => `${prefix}${value}`));
      return null;
    }
    act(() => root.render(createElement(Harness, { prefix: 'a' })));
    act(() => root.render(createElement(Harness, { prefix: 'b' })));
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[0]?.(7)).toBe('b7');
    act(() => root.unmount());
  });
});
