import type { MenuTreeNode } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import { startLocale } from '../../../src/i18n/locale.ts';
import { mainMenuAtom, startMainMenu } from '../../../src/shell/mainMenu.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const PLAYBACK: MenuTreeNode = {
  type: 'submenu',
  label: 'Playback',
  displayLabel: '播放',
  children: [
    { type: 'command', label: 'Stop', guid: 'stop-guid', path: 'Playback/Stop' },
    {
      type: 'command',
      label: 'Stop after current',
      guid: 'sac-guid',
      path: 'Playback/Stop after current',
      checked: true,
    },
    { type: 'command', label: 'Secret', guid: 'secret-guid', path: 'Playback/Secret' },
  ],
};

function answerTree(host: UnitHost, items: MenuTreeNode[], extra: { source?: 'v1-hmenu' } = {}) {
  host.answer('menu.getMainMenu', (params) => ({
    success: true,
    root: '',
    requestedRoot: '',
    rootMatched: true,
    locale: typeof params['locale'] === 'string' ? params['locale'] : 'auto',
    i18n: true,
    withAvailability: true,
    items,
    ...extra,
  }));
}

async function start(host: UnitHost) {
  const store = createStore();
  const menu = startMainMenu(store, host.fb);
  await menu.ready;
  await settle();
  return { store, menu, state: () => store.get(mainMenuAtom) };
}

describe('startMainMenu', () => {
  it('初读带上界面语言；默认隐藏的命令按初始化时读的枚举收进「更多」', async () => {
    const host = installFakeHost();
    answerTree(host, [PLAYBACK]);
    host.answer('discovery.getMainMenuCommands', {
      success: true,
      count: 1,
      expandDynamic: false,
      includeHidden: true,
      dynamicCount: 0,
      commands: [
        {
          name: 'Secret',
          description: '',
          guid: 'SECRET-GUID',
          parentGuid: 'playback',
          index: 0,
          path: 'Secret',
          isDynamic: false,
          isDynamicParent: false,
          source: 'mainmenu_static',
          executable: true,
          unaddressableReason: '',
          enabled: true,
          checked: false,
          radioChecked: false,
          hidden: true,
          stateKnown: true,
          flags: 8,
        },
      ],
    });
    const { state } = await start(host);
    expect(host.callsTo('menu.getMainMenu')[0]).toMatchObject({ locale: 'en' });
    expect(host.callsTo('discovery.getMainMenuCommands')).toEqual([
      { includeHidden: true, expandDynamic: false },
    ]);
    expect(state().tier).toBe('tree');
    expect(state().roots[0]?.children?.map((node) => node.label)).toEqual([
      'Stop',
      'Stop after current',
    ]);
    expect(state().tucked[0]?.children?.map((node) => node.label)).toEqual(['Secret']);
  });

  it('只按 GUID 执行；执行中不接第二条；成败都重读一次', async () => {
    const host = installFakeHost();
    answerTree(host, [PLAYBACK]);
    const { menu, state } = await start(host);
    const stop = PLAYBACK.children?.[0];
    if (!stop) throw new Error('fixture');
    const held = host.hold('menu.runMainMenuCommand');
    const first = menu.run(stop);
    await settle();
    expect(state().running).toBe(true);
    await menu.run(stop);
    expect(held.pending).toEqual([{ command: 'stop-guid' }]);

    const reads = host.callsTo('menu.getMainMenu').length;
    held.respond(0, hostFailure('MENU_COMMAND_NOT_FOUND'));
    await first;
    expect(state()).toMatchObject({ running: false, failure: 'command' });
    expect(host.callsTo('menu.getMainMenu').length).toBe(reads + 1);
    await menu.run({ type: 'command', label: 'No guid', commandId: 3 });
    expect(held.pending).toEqual([]);
  });

  it('快速开合时只认最后一次读取；读失败记一笔，手上的树不动', async () => {
    const host = installFakeHost();
    answerTree(host, [PLAYBACK]);
    const { menu, state } = await start(host);
    const held = host.hold('menu.getMainMenu');
    const older = menu.refresh();
    const newer = menu.refresh();
    held.respond(1, {
      success: true,
      root: '',
      requestedRoot: '',
      rootMatched: true,
      locale: 'en',
      i18n: true,
      withAvailability: true,
      items: [],
    });
    await newer;
    held.respond(0);
    await older;
    expect(state().tier).toBe('none');
    held.release();

    answerTree(host, [PLAYBACK]);
    await menu.refresh();
    host.answer('menu.getMainMenu', hostFailure('INTERNAL_ERROR'));
    await menu.refresh();
    expect(state()).toMatchObject({ tier: 'tree', failure: 'read' });
  });

  it('读成功就清掉之前的读取失败，读到的是空树也一样', async () => {
    const host = installFakeHost();
    host.answer('menu.getMainMenu', hostFailure('INTERNAL_ERROR'));
    const { menu, state } = await start(host);
    expect(state().failure).toBe('read');

    answerTree(host, []);
    await menu.refresh();
    expect(state()).toMatchObject({ failure: null, tier: 'none', roots: [] });
  });

  it('「已读过」只在读成功时立起：首读回来之前、首读失败都为假，读到过之后再失败也不落回去', async () => {
    const host = installFakeHost();
    const held = host.hold('menu.getMainMenu');
    const store = createStore();
    // 首读被扣着，`ready` 要等它答完才兑现，这里不等。
    const menu = startMainMenu(store, host.fb);
    await settle();
    expect(held.pending).toHaveLength(1);
    expect(store.get(mainMenuAtom)).toMatchObject({ status: 'connected', loaded: false });

    held.respond(0, hostFailure('INTERNAL_ERROR'));
    await menu.ready;
    expect(store.get(mainMenuAtom)).toMatchObject({ loaded: false, failure: 'read' });
    held.release();

    answerTree(host, []);
    await menu.refresh();
    expect(store.get(mainMenuAtom)).toMatchObject({ loaded: true, roots: [], failure: null });
    host.answer('menu.getMainMenu', hostFailure('INTERNAL_ERROR'));
    await menu.refresh();
    expect(store.get(mainMenuAtom)).toMatchObject({ loaded: true, failure: 'read' });
  });

  it('宿主标了扁平回退或 Win32 菜单档，照实记下', async () => {
    const host = installFakeHost();
    answerTree(host, [PLAYBACK], { source: 'v1-hmenu' });
    const { state } = await start(host);
    expect(state()).toMatchObject({ tier: 'tree', fromWin32Menu: true });
  });

  it('切界面语言后不等打开就重读', async () => {
    const host = installFakeHost();
    answerTree(host, [PLAYBACK]);
    const store = createStore();
    const locale = startLocale(store, host.fb, 'en');
    const menu = startMainMenu(store, host.fb);
    await locale.ready;
    await menu.ready;
    await locale.choose('zh-CN');
    await settle();
    expect(host.callsTo('menu.getMainMenu').at(-1)).toMatchObject({ locale: 'zh-CN' });
  });
});
