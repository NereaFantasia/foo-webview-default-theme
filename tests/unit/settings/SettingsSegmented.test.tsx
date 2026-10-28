import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsSegmented } from '../../../src/settings/SettingsSegmented.tsx';
import { SettingsLayoutContext } from '../../../src/settings/useSettingsLayout.ts';

const OPTIONS = [
  { value: 'a', label: '甲', icon: <i data-icon="a" /> },
  { value: 'b', label: '乙', icon: <i data-icon="b" /> },
  { value: 'c', label: '丙', icon: <i data-icon="c" /> },
] as const;

function render(compact: boolean, value: 'a' | 'b' | 'c', disabled = false): string {
  return renderToStaticMarkup(
    <FluentProvider theme={webLightTheme}>
      <SettingsLayoutContext.Provider value={{ compact }}>
        <SettingsSegmented
          label="分组"
          options={OPTIONS}
          value={value}
          disabled={disabled}
          onChange={() => {}}
        />
      </SettingsLayoutContext.Provider>
    </FluentProvider>,
  );
}

describe('SettingsSegmented', () => {
  it('宽卡是一排页签，选中的是 value 那一项，图标在文字前', () => {
    const html = render(false, 'b');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="分组"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.indexOf('data-icon="b"')).toBeLessThan(html.indexOf('乙'));
    expect(html).not.toContain('type="radio"');
  });

  it('窄卡换成单选，选中的仍是 value 那一项，图标与文字都在', () => {
    const html = render(true, 'c');
    expect(html).not.toContain('role="tablist"');
    const inputs = [...html.matchAll(/<input\b[^>]*type="radio"[^>]*>/g)].map((m) => m[0]);
    expect(inputs).toHaveLength(3);
    expect(inputs.map((input) => /\bchecked\b/.test(input))).toStrictEqual([false, false, true]);
    expect(html).toContain('aria-label="分组"');
    for (const mark of ['data-icon="a"', '甲', '乙', '丙']) expect(html).toContain(mark);
  });

  it('禁用：宽卡借 fieldset 把页签一起禁掉，窄卡的单选逐个禁用', () => {
    expect(render(false, 'a', true)).toMatch(/<fieldset[^>]*disabled/);
    expect(render(false, 'a')).not.toMatch(/<fieldset[^>]*disabled/);
    const inputs = [...render(true, 'a', true).matchAll(/<input\b[^>]*type="radio"[^>]*>/g)];
    expect(inputs).toHaveLength(3);
    expect(inputs.every((match) => /\bdisabled\b/.test(match[0]))).toBe(true);
  });
});
