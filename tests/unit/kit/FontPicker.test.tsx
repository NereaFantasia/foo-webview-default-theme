// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FontPicker } from '../../../src/kit/FontPicker.tsx';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

function mount(value = '') {
  const onChange = vi.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(FontPicker, { value, defaultLabel: '默认', onChange }));
  });
  const input = () => {
    const found = container.querySelector('input');
    if (!found) throw new Error('没有输入框');
    return found;
  };
  const type = (text: string) =>
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input(), text);
      input().dispatchEvent(new Event('input', { bubbles: true }));
    });
  return {
    onChange,
    input,
    type,
    enter: () =>
      act(async () => {
        input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await Promise.resolve();
      }),
    blur: () =>
      act(() => {
        input().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      }),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('字体选择器', () => {
  let environment: ActEnvironment;

  beforeEach(() => {
    environment = globalThis as ActEnvironment;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    delete environment.IS_REACT_ACT_ENVIRONMENT;
  });

  it('没选时输入框空着，占位是「默认」；有值时显示家族名', () => {
    const empty = mount();
    expect(empty.input().value).toBe('');
    expect(empty.input().placeholder).toBe('默认');
    empty.unmount();
    const chosen = mount('DengXian');
    expect(chosen.input().value).toBe('DengXian');
    chosen.unmount();
  });

  it('输完回车才提交，输入过程中不提交；离开输入框同样提交', async () => {
    const view = mount();
    view.type('Inter');
    expect(view.onChange).not.toHaveBeenCalled();
    await view.enter();
    expect(view.onChange).toHaveBeenCalledExactlyOnceWith('Inter');
    view.type('Georgia');
    view.blur();
    expect(view.onChange).toHaveBeenLastCalledWith('Georgia');
    view.unmount();
  });

  it('输入「默认」按默认给；不合格的字体名也按默认给；没变不提交', async () => {
    const view = mount('Inter');
    view.type('默认');
    await view.enter();
    expect(view.onChange).toHaveBeenLastCalledWith('');
    view.type('bad\u0000name');
    await view.enter();
    expect(view.onChange).toHaveBeenLastCalledWith('');
    view.onChange.mockClear();
    view.type('Inter');
    await view.enter();
    expect(view.onChange).not.toHaveBeenCalled();
    view.unmount();
  });
});
