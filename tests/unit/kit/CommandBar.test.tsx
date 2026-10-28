import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommandBar } from '../../../src/kit/CommandBar.tsx';

function render(selection?: ReactNode): string {
  return renderToStaticMarkup(
    <FluentProvider theme={webLightTheme}>
      <CommandBar
        tier="wide"
        label="工具"
        find={<i data-find />}
        view={<i data-view />}
        selection={selection}
      />
    </FluentProvider>,
  );
}

describe('CommandBar', () => {
  it('没有选区操作时显示查找组与视图组，选区传 false 与 null 也一样', () => {
    for (const selection of [undefined, null, false]) {
      const html = render(selection);
      expect(html, String(selection)).toContain('data-find');
      expect(html, String(selection)).toContain('data-view');
    }
  });

  it('有选区操作时代替查找组，视图组仍在', () => {
    const html = render(<i data-selection />);
    expect(html).toContain('data-selection');
    expect(html).not.toContain('data-find');
    expect(html).toContain('data-view');
  });
});
