import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HostMenuList } from '../../../src/kit/HostMenuList.tsx';
import type { MenuNode } from '../../../src/host/menuNodes.ts';
import { hasCommandId } from '../../../src/library/albumMenu.ts';

/** 在服务端把一层菜单画成 HTML，读出每一项的文字与是否置灰。 */
function itemsOf(nodes: readonly MenuNode[], runnable?: (node: MenuNode) => boolean) {
  const html = renderToStaticMarkup(
    <FluentProvider theme={webLightTheme}>
      <HostMenuList nodes={nodes} onRun={() => {}} runnable={runnable} />
    </FluentProvider>,
  );
  const tags = [...html.matchAll(/<div[^>]*role="menuitem(?:checkbox)?"[^>]*>/g)];
  return tags.map((tag, at) => {
    const start = (tag.index ?? 0) + tag[0].length;
    const end = tags[at + 1]?.index ?? html.length;
    const label = html
      .slice(start, end)
      .replace(/<[^>]+>/g, '')
      .trim();
    return { label, disabled: tag[0].includes('aria-disabled="true"') };
  });
}

const command = (label: string, extra: Partial<MenuNode> = {}): MenuNode => ({
  type: 'command',
  label,
  ...extra,
});

describe('HostMenuList', () => {
  it('不传 runnable 时按主菜单的规矩：有 GUID 的能执行，没有 GUID 或标了不能执行的置灰', () => {
    expect(
      itemsOf([
        command('Play', { guid: '{A}' }),
        command('Orphan', { commandId: 7 }),
        command('Locked', { guid: '{B}', executable: false }),
      ]),
    ).toEqual([
      { label: 'Play', disabled: false },
      { label: 'Orphan', disabled: true },
      { label: 'Locked', disabled: true },
    ]);
  });

  it('右键菜单传按编号的判据：有编号的能执行，只有 GUID 的也置灰', () => {
    expect(
      itemsOf(
        [command('Rate', { commandId: 3 }), command('Guid only', { guid: '{A}' })],
        hasCommandId,
      ),
    ).toEqual([
      { label: 'Rate', disabled: false },
      { label: 'Guid only', disabled: true },
    ]);
  });

  it('宿主标了不可用的照样置灰，判据答能执行也一样', () => {
    expect(
      itemsOf(
        [
          command('Off', { commandId: 3, enabled: false }),
          command('Gone', { commandId: 4, available: false }),
        ],
        hasCommandId,
      ),
    ).toEqual([
      { label: 'Off', disabled: true },
      { label: 'Gone', disabled: true },
    ]);
  });
});
