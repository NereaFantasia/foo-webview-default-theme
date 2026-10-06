import { expect, test, type Page } from '@playwright/test';
import { makePlaylist } from '../fixtures/fakePlaylists.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { DEFAULT_LISTS, openSidebar, type SidebarPage } from '../fixtures/sidebarPage.ts';

// 播放列表节里的各行：右键菜单（鼠标、⋯、Menu 键与 Shift+F10）、按 GUID 执行、删除确认、内联改名、
// 新建、筛选与拖动重排。拖放悬停的观感只能实机看。

const menuOf = (page: Page) => page.getByRole('menu', { name: '播放列表菜单' });

test('按词筛选保留空词、连续空格、大小写、词序与中文匹配规则', async ({ page }) => {
  const { nav, entry, errors } = await openSidebar(page, [
    makePlaylist(0, 'Chill Mix', { isActive: true }),
    makePlaylist(1, 'Late Night Chill'),
    makePlaylist(2, '夜间驾驶'),
  ]);
  await nav.getByRole('button', { name: '筛选列表' }).click();
  const filter = nav.getByRole('textbox', { name: '筛选列表' });
  await expect(filter).toHaveValue('');
  await expect(entry('Chill Mix')).toBeVisible();
  await expect(nav.locator('[data-playlist-entry]')).toHaveCount(3);
  await filter.fill('   ');
  await expect(entry('Chill Mix')).toBeVisible();
  await expect(nav.locator('[data-playlist-entry]')).toHaveCount(3);
  await filter.fill('chill  NIGHT');
  await expect(entry('Late Night Chill')).toBeVisible();
  await expect(nav.locator('[data-playlist-entry]')).toHaveCount(1);
  await filter.fill('night jazz');
  await expect(entry('Late Night Chill')).toHaveCount(0);
  await expect(nav.locator('[data-playlist-entry]')).toHaveCount(0);
  await filter.fill('驾驶');
  await expect(entry('夜间驾驶')).toBeVisible();
  await expect(nav.locator('[data-playlist-entry]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

async function dragBy(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 3);
  await page.mouse.move(to.x, to.y, { steps: 5 });
}

async function middleOf(sidebar: SidebarPage, name: string, dy = 0) {
  const box = await sidebar.entry(name).boundingBox();
  if (!box) throw new Error(`「${name}」那一行没画出来`);
  return { x: box.x + 20, y: box.y + box.height / 2 + dy };
}

test('右键菜单针对右键的那一张、不切换；菜单里改名，回车提交、焦点回到那一行', async ({ page }) => {
  const { host, lists, entry, nav, errors } = await openSidebar(page);
  const guid = lists.guid('Road Trip');
  const row = nav.locator(`[data-playlist-entry="${guid}"]`);
  await entry('Road Trip').click({ button: 'right' });
  await expect(menuOf(page).getByRole('menuitem', { name: '去除重复项' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  expect(host.callsTo('playlist.setActive')).toEqual([]);

  await menuOf(page).getByRole('menuitem', { name: '重命名' }).click();
  const input = nav.getByRole('textbox', { name: '重命名「Road Trip」' });
  await expect(input).toBeFocused();
  // 改名框里的方向键、Home、End 移光标，不被侧边栏的方向键导航带走。
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) await page.keyboard.press(key);
  await expect(input).toBeFocused();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Weekend');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => host.callsTo('playlist.rename'))
    .toEqual([{ playlistGuid: guid, name: 'Weekend' }]);
  await expect(row).toContainText('Weekend');
  await expect(row).toBeFocused();

  // F2 同样进改名；Esc 取消，不发命令。
  await page.keyboard.press('F2');
  await expect(nav.getByRole('textbox', { name: '重命名「Weekend」' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  expect(host.callsTo('playlist.rename')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('改名框失焦就提交；改名途中那张被删了，就退出编辑', async ({ page }) => {
  const { host, lists, entry, nav, errors } = await openSidebar(page);
  const road = lists.guid('Road Trip');
  await entry('Road Trip').focus();
  await page.keyboard.press('F2');
  await page.keyboard.type('Drive');
  await nav.getByRole('button', { name: '专辑', exact: true }).click();
  await expect
    .poll(() => host.callsTo('playlist.rename'))
    .toEqual([{ playlistGuid: road, name: 'Drive' }]);

  await entry('Chill').focus();
  await page.keyboard.press('F2');
  await expect(nav.getByRole('textbox', { name: '重命名「Chill」' })).toBeFocused();
  await host.invoke('playlist.remove', { playlistGuid: lists.guid('Chill') });
  await expect(nav.getByRole('textbox')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('行尾的 ⋯、Menu 键与 Shift+F10 开同一份菜单；转为普通列表按 GUID 发', async ({ page }) => {
  const { host, lists, entry, nav, errors } = await openSidebar(page);
  await entry('Smart').hover();
  await nav.getByRole('button', { name: '「Smart」的更多操作' }).click();
  await menuOf(page).getByRole('menuitem', { name: '转为普通播放列表' }).click();
  await expect
    .poll(() => host.callsTo('playlist.removeAutoplaylist'))
    .toEqual([{ playlistGuid: lists.guid('Smart') }]);
  // 转好之后清单读回，它成了普通列表，菜单里不再有这一项。
  await entry('Smart').click({ button: 'right' });
  await expect(menuOf(page).getByRole('menuitem', { name: '清空' })).toBeEnabled();
  await expect(menuOf(page).getByRole('menuitem', { name: '转为普通播放列表' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  for (const key of ['Shift+F10', 'ContextMenu']) {
    await entry('Default').focus();
    await page.keyboard.press(key);
    await expect(menuOf(page).getByRole('menuitem', { name: '保存播放列表…' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menuOf(page)).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('菜单里的「播放」：去那张的地点、切成活动列表，从第一首播', async ({ page }) => {
  const { host, lists, entry, playlistPage, errors } = await openSidebar(page);
  const road = lists.guid('Road Trip');
  await entry('Road Trip').click({ button: 'right' });
  await menuOf(page).getByRole('menuitem', { name: '播放', exact: true }).click();
  await expect(playlistPage('Road Trip')).toBeVisible();
  await expect(entry('Road Trip')).toHaveAttribute('aria-current', 'page');
  await expect
    .poll(() => host.callsTo('playlist.playTrack'))
    .toEqual([{ playlistGuid: road, index: 0 }]);
  await expect.poll(() => lists.activeGuid()).toBe(road);
  expect(errors).toEqual([]);
});

test('A 在播时切到 B、再从菜单播放 B：正在播放的标记挪到 B', async ({ page }) => {
  const { entry, errors } = await openSidebar(page);
  await expect(entry('Chill').getByLabel('正在播放')).toBeVisible();
  await entry('Road Trip').click();
  await expect(entry('Road Trip')).toHaveAttribute('aria-current', 'page');
  await entry('Road Trip').click({ button: 'right' });
  await menuOf(page).getByRole('menuitem', { name: '播放', exact: true }).click();
  await expect(entry('Road Trip').getByLabel('正在播放')).toBeVisible();
  await expect(entry('Chill').getByLabel('正在播放')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('行尾平时是曲目数；悬停、焦点在这一行、菜单开着时同一个位置换成 ⋯，名字宽度不变', async ({
  page,
}) => {
  const { nav, entry, errors } = await openSidebar(page);
  const row = entry('Road Trip');
  const count = row.getByText('48', { exact: true });
  const more = nav.getByRole('button', { name: '「Road Trip」的更多操作' });
  const label = row.getByText('Road Trip', { exact: true });
  const only = async (shown: typeof count, hidden: typeof count) => {
    await expect(shown).toBeVisible();
    await expect(hidden).toBeHidden();
  };
  const away = () => page.mouse.move(700, 400);

  await away();
  await only(count, more);
  const width = (await label.boundingBox())?.width;
  await row.hover();
  await only(more, count);
  expect((await label.boundingBox())?.width).toBe(width);
  await away();
  await only(count, more);

  await row.focus();
  await only(more, count);
  await entry('Default').focus();
  await only(count, more);

  await row.click({ button: 'right' });
  await away();
  await expect(menuOf(page)).toBeVisible();
  await only(more, count);
  await page.keyboard.press('Escape');
  await expect(menuOf(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('菜单弹出按 Windows 11 的入场：83 ms 淡入配 250 ms 位移，不用 Fluent 缺省的 400 ms', async ({
  page,
}) => {
  const { entry, errors } = await openSidebar(page);
  await entry('Road Trip').click({ button: 'right' });
  await expect(menuOf(page)).toBeVisible();
  const durations = await page.evaluate(() =>
    [...document.querySelectorAll('.fui-MenuPopover')]
      .flatMap((popover) => popover.getAnimations())
      .map((animation) => animation.effect?.getTiming().duration),
  );
  expect(durations.sort()).toEqual([250, 83].sort());
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('新建先在节末出一行名字框、缺省名全选；Esc 什么都不建，清单与历史不变，焦点回到「新建」', async ({
  page,
}) => {
  const { host, lists, nav, albumsPage, errors } = await openSidebar(page);
  const create = nav.getByRole('button', { name: '新建', exact: true });
  await create.click();
  const input = nav.getByRole('textbox', { name: '播放列表名称' });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('新建播放列表');
  expect(
    await input.evaluate((box: HTMLInputElement) => [box.selectionStart, box.selectionEnd]),
  ).toEqual([0, 6]);
  // 在节末：清单里最后一张的下面。
  const last = await nav.locator(`[data-playlist-entry="${lists.guid('Smart')}"]`).boundingBox();
  const row = await input.boundingBox();
  expect(row && last && row.y > last.y).toBe(true);
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(create).toBeFocused();
  expect(host.callsTo('playlist.create')).toEqual([]);
  expect(lists.names()).toEqual(DEFAULT_LISTS.map((item) => item.name));
  await expect(albumsPage).toBeVisible();
  await expect(page.locator('[data-nav="back"]')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('键盘回车与右键菜单里的新建：同样先出名字框，Esc 之后焦点回到「新建」', async ({ page }) => {
  const { host, entry, nav, errors } = await openSidebar(page);
  const create = nav.getByRole('button', { name: '新建', exact: true });
  const input = nav.getByRole('textbox', { name: '播放列表名称' });
  await create.focus();
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(create).toBeFocused();
  await entry('Road Trip').click({ button: 'right' });
  await menuOf(page).getByRole('menuitem', { name: '新建播放列表' }).click();
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(create).toBeFocused();
  expect(host.callsTo('playlist.create')).toEqual([]);
  expect(errors).toEqual([]);
});

test('新建时改了名再点别处：按框里的名字建成，去它的地点，不另发改名', async ({ page }) => {
  const { host, nav, playlistPage, errors } = await openSidebar(page);
  await nav.getByRole('button', { name: '新建', exact: true }).click();
  await expect(nav.getByRole('textbox', { name: '播放列表名称' })).toBeFocused();
  await page.keyboard.type('Morning');
  // 点标题栏右半的空处（输出面板与窗口三键之间）：不是可聚焦的元素，名字框只是失焦。
  await page.mouse.click(1040, 24);
  await expect(playlistPage('Morning')).toBeVisible();
  expect(host.callsTo('playlist.create')).toEqual([{ name: 'Morning' }]);
  expect(host.callsTo('playlist.rename')).toEqual([]);
  expect(errors).toEqual([]);
});

test('加了锁的普通列表：名字前是锁、整行压暗，照样能点开', async ({ page }) => {
  const lists = [...DEFAULT_LISTS, makePlaylist(4, 'Archive', { isLocked: true })];
  const { entry, playlistPage, errors } = await openSidebar(page, lists);
  await expect(entry('Archive').getByLabel('已锁定')).toBeVisible();
  const color = (name: string) =>
    entry(name).evaluate((element) => getComputedStyle(element).color);
  expect(await color('Archive')).not.toBe(await color('Road Trip'));
  await entry('Archive').click();
  await expect(playlistPage('Archive')).toBeVisible();
  expect(errors).toEqual([]);
});

test('删除非空列表先确认；确认时按 GUID 删，清单跟着少一张', async ({ page }) => {
  const { host, lists, entry, nav, errors } = await openSidebar(page);
  const road = lists.guid('Road Trip');
  await entry('Road Trip').click({ button: 'right' });
  await menuOf(page).getByRole('menuitem', { name: '删除' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('「Road Trip」里有 48 首曲目');
  await dialog.getByRole('button', { name: '删除' }).click();
  await expect.poll(() => host.callsTo('playlist.remove')).toEqual([{ playlistGuid: road }]);
  await expect(nav.locator(`[data-playlist-entry="${road}"]`)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('新建后回车：按缺省名建成，去它的地点并切成活动列表，焦点落在新的那一行；双击只出一行', async ({
  page,
}) => {
  const { host, lists, nav, playlistPage, errors } = await openSidebar(page);
  await nav.getByRole('button', { name: '新建', exact: true }).dblclick();
  const input = nav.getByRole('textbox', { name: '播放列表名称' });
  await expect(input).toBeFocused();
  await expect(input).toHaveCount(1);
  expect(host.callsTo('playlist.create')).toEqual([]);
  await page.keyboard.press('Enter');
  await expect(playlistPage('新建播放列表')).toBeVisible();
  expect(host.callsTo('playlist.create')).toEqual([{ name: '新建播放列表' }]);
  const created = lists.guid('新建播放列表');
  await expect.poll(() => lists.activeGuid()).toBe(created);
  await expect(input).toHaveCount(0);
  await expect(nav.locator(`[data-playlist-entry="${created}"]`)).toBeFocused();
  expect(errors).toEqual([]);
});

test('宿主建不成：名字框收起，报操作没成功，焦点回到「新建」，不去哪儿', async ({ page }) => {
  const { host, nav, albumsPage, errors } = await openSidebar(page);
  host.answer('playlist.create', hostFailure('INTERNAL_ERROR'));
  const create = nav.getByRole('button', { name: '新建', exact: true });
  await create.click();
  await page.keyboard.press('Enter');
  await expect(nav.getByText('播放列表操作失败')).toBeVisible();
  await expect(nav.getByRole('textbox', { name: '播放列表名称' })).toHaveCount(0);
  await expect(create).toBeFocused();
  await expect(albumsPage).toBeVisible();
  expect(errors).toEqual([]);
});

test('人手的双击：第二下隔了一会儿才到，也只出一行，不抢名字框的焦点', async ({ page }) => {
  const { host, nav, errors } = await openSidebar(page);
  const box = await nav.getByRole('button', { name: '新建', exact: true }).boundingBox();
  if (!box) throw new Error('「新建」没画出来');
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const input = nav.getByRole('textbox', { name: '播放列表名称' });
  await page.mouse.click(at.x, at.y);
  await expect(input).toBeFocused();
  // 只补第二下：按下与松开都带 clickCount 2，浏览器据此把 click 的 detail 记成 2。
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
  // 第二下不抢名字框的焦点，接着打字就是在起名。
  await expect(input).toBeFocused();
  await expect(input).toHaveCount(1);
  await page.keyboard.type('Morning');
  await page.keyboard.press('Enter');
  await expect.poll(() => host.callsTo('playlist.create')).toEqual([{ name: 'Morning' }]);
  expect(host.callsTo('playlist.rename')).toEqual([]);
  expect(errors).toEqual([]);
});

test('节头放大镜的筛选：按词收窄、框尾是命中张数，Esc 收起并把焦点还给放大镜；筛选中不重排', async ({
  page,
}) => {
  const sidebar = await openSidebar(page);
  const { host, nav, errors } = sidebar;
  const search = nav.getByRole('button', { name: '筛选列表' });
  await expect(search).toHaveAttribute('aria-expanded', 'false');
  await search.click();
  const filter = nav.getByRole('textbox', { name: '筛选列表' });
  await expect(filter).toBeFocused();
  await expect(search).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.type('r');
  // 筛选框里的方向键、Home、End、翻页移光标，不被侧边栏的方向键导航带走。
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp']) {
    await page.keyboard.press(key);
  }
  await expect(filter).toBeFocused();
  await expect(nav.locator('[data-playlist-entry]')).toHaveCount(2);
  await expect(nav.locator('[data-playlist-filter]').locator('..')).toContainText('2');

  await dragBy(page, await middleOf(sidebar, 'Road Trip'), await middleOf(sidebar, 'Smart', 12));
  await page.mouse.up();
  await sidebar.entry('Road Trip').focus();
  await page.keyboard.press('Alt+ArrowDown');
  expect(host.callsTo('playlist.reorderPlaylists')).toEqual([]);

  await filter.focus();
  await page.keyboard.press('Escape');
  await expect(filter).toHaveCount(0);
  await expect(search).toBeFocused();
  await expect(nav.locator('[data-playlist-entry]')).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('放大镜再点一次收起筛选、清掉词；这一节收着时点它先展开再出筛选框', async ({ page }) => {
  const { nav, errors } = await openSidebar(page);
  const search = nav.getByRole('button', { name: '筛选列表' });
  const filter = nav.getByRole('textbox', { name: '筛选列表' });
  await search.click();
  await page.keyboard.type('road');
  await expect(nav.locator('[data-playlist-entry]')).toHaveCount(1);
  await search.click();
  await expect(filter).toHaveCount(0);
  await expect(search).toBeFocused();
  await expect(nav.locator('[data-playlist-entry]')).toHaveCount(4);

  await nav.getByRole('button', { name: '展开或收起「播放列表」' }).click();
  await expect(nav.locator('[data-playlist-entry]')).toHaveCount(0);
  await search.click();
  await expect(filter).toBeFocused();
  await expect(nav.locator('[data-playlist-entry]')).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('拖动重排：过阈值才算拖，松手按插入位发整份排列、不当单击；Alt+↓ 下移一位', async ({
  page,
}) => {
  const sidebar = await openSidebar(page);
  const { host, entry, albumsPage, errors } = sidebar;
  await dragBy(page, await middleOf(sidebar, 'Default'), await middleOf(sidebar, 'Road Trip', 12));
  await expect(entry('Default')).toHaveAttribute('data-dragging', 'true');
  await page.mouse.up();
  await expect
    .poll(() => host.callsTo('playlist.reorderPlaylists'))
    .toEqual([{ newOrder: [1, 2, 0, 3] }]);
  await expect(albumsPage).toBeVisible();

  await entry('Chill').focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect
    .poll(() => host.callsTo('playlist.reorderPlaylists').at(-1))
    .toEqual({ newOrder: [1, 0, 2, 3] });
  await expect(entry('Chill')).toBeFocused();
  expect(errors).toEqual([]);
});

test('连按 Alt+↓：上一次读回之前的那一下不接，焦点跟着被挪的那张，下一次按新清单算', async ({
  page,
}) => {
  const { host, lists, entry, errors } = await openSidebar(page);
  await entry('Default').focus();
  const held = host.hold('playlist.getAll');
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(() => host.callsTo('playlist.reorderPlaylists')).toHaveLength(1);
  await page.keyboard.press('Alt+ArrowDown');
  held.release();
  await expect(entry('Default')).toBeFocused();
  expect(host.callsTo('playlist.reorderPlaylists')).toEqual([{ newOrder: [1, 0, 2, 3] }]);

  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(() => lists.names()).toEqual(['Chill', 'Road Trip', 'Default', 'Smart']);
  await expect(entry('Default')).toBeFocused();
  expect(errors).toEqual([]);
});

test('改名中不重排：拖另一行不起拖，改名框失焦照常提交', async ({ page }) => {
  const sidebar = await openSidebar(page);
  const { host, lists, entry, nav, errors } = sidebar;
  const road = lists.guid('Road Trip');
  await entry('Road Trip').focus();
  await page.keyboard.press('F2');
  await expect(nav.getByRole('textbox', { name: '重命名「Road Trip」' })).toBeFocused();
  await page.keyboard.type('Drive');
  await dragBy(page, await middleOf(sidebar, 'Default'), await middleOf(sidebar, 'Smart', 12));
  await expect(entry('Default')).not.toHaveAttribute('data-dragging', 'true');
  await page.mouse.up();
  await expect
    .poll(() => host.callsTo('playlist.rename'))
    .toEqual([{ playlistGuid: road, name: 'Drive' }]);
  expect(host.callsTo('playlist.reorderPlaylists')).toEqual([]);
  expect(errors).toEqual([]);
});

test('拖动中 Esc、窗口失焦、pointercancel、丢了捕获、清单变了都取消，不发重排', async ({
  page,
}) => {
  const sidebar = await openSidebar(page);
  const { host, entry, errors } = sidebar;
  const cancels: [string, () => Promise<unknown>][] = [
    ['Esc', () => page.keyboard.press('Escape')],
    ['失焦', () => page.evaluate(() => window.dispatchEvent(new Event('blur')))],
    [
      'pointercancel',
      () =>
        page.evaluate(() =>
          window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })),
        ),
    ],
    ['丢了捕获', () => page.evaluate(() => document.body.releasePointerCapture(1))],
    ['清单变了', () => host.invoke('playlist.create', { name: 'Late' })],
  ];
  for (const [label, cancel] of cancels) {
    await dragBy(
      page,
      await middleOf(sidebar, 'Default'),
      await middleOf(sidebar, 'Road Trip', 12),
    );
    await expect(entry('Default'), label).toHaveAttribute('data-dragging', 'true');
    await cancel();
    // 这两种不是当场生效：清单的签名在下一次移动（或边缘滚动的定时器）时核对，丢了捕获的事件在下一次
    // 指针事件之前才补发。
    if (label === '清单变了' || label === '丢了捕获') await page.mouse.move(40, 600);
    await expect(entry('Default'), label).not.toHaveAttribute('data-dragging', 'true');
    await page.mouse.up();
  }
  expect(host.callsTo('playlist.reorderPlaylists')).toEqual([]);
  expect(errors).toEqual([]);
});

test('拖动中途取消（Esc、清单变了）后在按下的那一行松手：不当单击，不去那张列表', async ({
  page,
}) => {
  const sidebar = await openSidebar(page);
  const { host, entry, playlistPage, errors } = sidebar;
  const cancels: [string, () => Promise<unknown>][] = [
    ['Esc', () => page.keyboard.press('Escape')],
    ['清单变了', () => host.invoke('playlist.create', { name: 'Late' })],
  ];
  for (const [label, cancel] of cancels) {
    const start = await middleOf(sidebar, 'Road Trip', -6);
    await dragBy(page, start, await middleOf(sidebar, 'Road Trip', 6));
    await expect(entry('Road Trip'), label).toHaveAttribute('data-dragging', 'true');
    await cancel();
    await page.mouse.move(start.x, start.y + 8);
    await expect(entry('Road Trip'), label).not.toHaveAttribute('data-dragging', 'true');
    await page.mouse.up();
  }
  await expect(playlistPage('Road Trip')).toHaveCount(0);
  expect(host.callsTo('playlist.setActive')).toEqual([]);
  expect(host.callsTo('playlist.reorderPlaylists')).toEqual([]);
  expect(errors).toEqual([]);
});

test('拖动中按 F2 不进改名，拖动照旧', async ({ page }) => {
  const sidebar = await openSidebar(page);
  const { entry, nav, errors } = sidebar;
  await dragBy(page, await middleOf(sidebar, 'Default'), await middleOf(sidebar, 'Road Trip', 12));
  await expect(entry('Default')).toHaveAttribute('data-dragging', 'true');
  await page.keyboard.press('F2');
  await expect(nav.locator('[data-rename-input]')).toHaveCount(0);
  await expect(entry('Default')).toHaveAttribute('data-dragging', 'true');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('拖出滚动区再松手：不交出去，也不当单击', async ({ page }) => {
  const sidebar = await openSidebar(page);
  const { host, entry, albumsPage, errors } = sidebar;
  await dragBy(page, await middleOf(sidebar, 'Default'), await middleOf(sidebar, 'Road Trip', 12));
  await expect(entry('Default')).toHaveAttribute('data-dragging', 'true');
  await page.mouse.move(700, 400, { steps: 5 });
  await page.mouse.up();
  await expect(entry('Default')).not.toHaveAttribute('data-dragging', 'true');
  expect(host.callsTo('playlist.reorderPlaylists')).toEqual([]);
  await expect(albumsPage).toBeVisible();
  expect(errors).toEqual([]);
});

test('拖到滚动区下沿附近停住：一行一行往下滚', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const many = Array.from({ length: 30 }, (_, index) =>
    makePlaylist(index, `List ${String(index).padStart(2, '0')}`, { isActive: index === 0 }),
  );
  const sidebar = await openSidebar(page, many);
  const scroller = sidebar
    .entry('List 00')
    .locator('xpath=ancestor::div[contains(@class,"scroller")][1]');
  const box = await scroller.boundingBox();
  if (!box) throw new Error('滚动区没画出来');
  await dragBy(page, await middleOf(sidebar, 'List 00'), {
    x: box.x + 20,
    y: box.y + box.height - 4,
  });
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(sidebar.errors).toEqual([]);
});

test('Alt+↓ 把可见区最下面一行挪出去：它跟着滚进来，焦点还在它身上', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const many = Array.from({ length: 30 }, (_, index) =>
    makePlaylist(index, `List ${String(index).padStart(2, '0')}`, { isActive: index === 0 }),
  );
  const sidebar = await openSidebar(page, many);
  const { lists, entry, errors } = sidebar;
  const scroller = entry('List 00').locator('xpath=ancestor::div[contains(@class,"scroller")][1]');
  // 列表多到这一节自己滚动；取可见区里最下面那张完整露出来的列表。
  const last = await scroller.evaluate((element) => {
    const bottom = element.getBoundingClientRect().bottom;
    const rows = [...element.querySelectorAll<HTMLElement>('[data-playlist-entry]')];
    const shown = rows.filter((row) => row.getBoundingClientRect().bottom <= bottom);
    return {
      guid: shown.at(-1)?.getAttribute('data-playlist-entry') ?? '',
      clipped: shown.length < rows.length,
    };
  });
  expect(last.clipped).toBe(true);
  const name = lists.items.find((item) => item.guid === last.guid)?.name ?? '';
  const index = lists.names().indexOf(name);
  await entry(name).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(() => lists.names().indexOf(name)).toBe(index + 1);
  await expect(entry(name)).toBeFocused();
  const inside = (guid: string) =>
    scroller.evaluate((element, target) => {
      const box = element.getBoundingClientRect();
      const row = element
        .querySelector(`[data-playlist-entry="${target}"]`)
        ?.getBoundingClientRect();
      return row !== undefined && row.top >= box.top && row.bottom <= box.bottom;
    }, guid);
  await expect.poll(() => inside(last.guid)).toBe(true);
  expect(errors).toEqual([]);
});

test('清单下方的空白处右键：出新建、载入、保存全部，不针对哪一张', async ({ page }) => {
  // 窗口高一些，清单下面才留得出空白。
  await page.setViewportSize({ width: 1280, height: 1000 });
  const { host, entry, errors } = await openSidebar(page);
  const last = await entry('Smart').boundingBox();
  if (!last) throw new Error('列表行没画出来');
  await page.mouse.click(last.x + 20, last.y + last.height + 40, { button: 'right' });
  await expect(menuOf(page).getByRole('menuitem')).toHaveText([
    '新建播放列表',
    '载入播放列表…',
    '保存全部播放列表…',
  ]);
  await menuOf(page).getByRole('menuitem', { name: '载入播放列表…' }).click();
  await expect
    .poll(() => host.callsTo('menu.runMainMenuCommand'))
    .toEqual([{ command: '{D94393D4-9DBB-4E5C-BE8C-BE9CA80E214D}' }]);
  expect(errors).toEqual([]);
});
