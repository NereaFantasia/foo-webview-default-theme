import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  SettingsChoice,
  type SettingsChoiceOption,
} from '../../../src/settings/SettingsChoice.tsx';
import { SettingsLayoutContext } from '../../../src/settings/useSettingsLayout.ts';

type Pick = 'a' | 'b' | 'c' | 'd' | 'e';

const OPTIONS: readonly SettingsChoiceOption<Pick>[] = (['a', 'b', 'c', 'd', 'e'] as const).map(
  (value) => ({ value, label: `选项 ${value}`, preview: <i data-preview={value} /> }),
);

function render(
  options: readonly SettingsChoiceOption<Pick>[],
  value: Pick,
  extra: { compact?: boolean; disabled?: boolean; labelId?: string } = {},
): string {
  return renderToStaticMarkup(
    <FluentProvider theme={webLightTheme}>
      <SettingsLayoutContext.Provider value={{ compact: extra.compact ?? false }}>
        <SettingsChoice
          options={options}
          value={value}
          disabled={extra.disabled ?? false}
          labelId={extra.labelId}
          onChange={() => {}}
        />
      </SettingsLayoutContext.Provider>
    </FluentProvider>,
  );
}

const radios = (html: string) =>
  [...html.matchAll(/<input\b[^>]*type="radio"[^>]*>/g)].map((m) => m[0]);
const columns = (html: string) => html.match(/grid-template-columns:\s*repeat\((\d+),/)?.[1];

describe('SettingsChoice', () => {
  it('每个选项一个单选，选中的只有 value 那一项，缩略图对读屏隐藏', () => {
    const html = render(OPTIONS.slice(0, 3), 'b');
    const inputs = radios(html);
    expect(inputs).toHaveLength(3);
    expect(inputs.map((input) => /\bchecked\b/.test(input))).toStrictEqual([false, true, false]);
    expect(html.match(/<label[^>]*aria-hidden="true"/g)).toHaveLength(3);
    expect(html).toContain('data-preview="a"');
    expect(html.match(/data-selected/g)).toHaveLength(1);
  });

  it('单选的无障碍名就是选项的名字：缩略图里的文字（歌词一类）不跟进名字里', () => {
    const withText: readonly SettingsChoiceOption<Pick>[] = OPTIONS.slice(0, 3).map((option) => ({
      ...option,
      preview: <span>一句歌词 {option.value}</span>,
    }));
    const inputs = radios(render(withText, 'a'));
    expect(inputs.map((input) => /aria-label="([^"]*)"/.exec(input)?.[1])).toStrictEqual([
      '选项 a',
      '选项 b',
      '选项 c',
    ]);
  });

  it('外面换了 value，选中跟着换', () => {
    const second = radios(render(OPTIONS.slice(0, 3), 'c'));
    expect(second.map((input) => /\bchecked\b/.test(input))).toStrictEqual([false, false, true]);
  });

  it('禁用的选项与禁用整组：单选禁用，缩略图带禁用标记', () => {
    const one = render([...OPTIONS.slice(0, 2), { ...OPTIONS[2]!, disabled: true }], 'a');
    expect(radios(one).map((input) => /\bdisabled\b/.test(input))).toStrictEqual([
      false,
      false,
      true,
    ]);
    expect(one.match(/data-disabled/g)).toHaveLength(1);
    const all = render(OPTIONS.slice(0, 3), 'a', { disabled: true });
    expect(radios(all).every((input) => /\bdisabled\b/.test(input))).toBe(true);
    expect(all.match(/data-disabled/g)).toHaveLength(3);
  });

  it('组名取卡标题的 id', () => {
    expect(render(OPTIONS.slice(0, 2), 'a', { labelId: 'card-title' })).toContain(
      'aria-labelledby="card-title"',
    );
  });

  it('宽卡按选项数分列，2 到 4 项限宽，5 项均分不限；窄卡最多 3 列', () => {
    const two = render(OPTIONS.slice(0, 2), 'a');
    expect(columns(two)).toBe('2');
    expect(two).toContain('max-width:calc(2 * 190px');
    expect(columns(render(OPTIONS.slice(0, 4), 'a'))).toBe('4');
    const five = render(OPTIONS, 'a');
    expect(columns(five)).toBe('5');
    expect(five).not.toContain('max-width');
    expect(columns(render(OPTIONS, 'a', { compact: true }))).toBe('3');
    expect(columns(render(OPTIONS.slice(0, 2), 'a', { compact: true }))).toBe('2');
    expect(render(OPTIONS.slice(0, 2), 'a', { compact: true })).not.toContain('max-width');
  });
});
