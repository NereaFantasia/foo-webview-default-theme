import { expect, test } from '@playwright/test';
import { openHome } from '../fixtures/homePage.ts';
import type { HeldCalls } from '../fixtures/fakeHost.ts';
import { hostFailure, listParam } from '../fixtures/hostAnswers.ts';

test('统计未完成不阻塞专辑，返回保持候选和滚动', async ({ page }) => {
  let held: HeldCalls<'playcount.getBatch'> | undefined;
  const { view, errors } = await openHome(page, {
    configure: (host) => {
      held = host.hold('playcount.getBatch');
    },
  });
  const explore = view.getByRole('region', { name: '探索音乐' });
  await expect(view.getByText('正在读取播放统计')).toBeVisible();
  await expect.poll(() => held?.pending.length).toBe(1);
  held?.respond(0);
  await expect(
    view.getByRole('region', { name: '最近听过' }).locator('[data-home-album]'),
  ).toHaveCount(6);
  await explore.getByLabel('换一批').click();
  const before = await explore
    .locator('[data-home-album]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-home-album')));
  await explore.locator('[data-home-album] button').first().focus();
  const scroll = await view.evaluate((node) => node.scrollTop);
  await explore.locator('[data-home-album] button').first().click();
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  await page.getByRole('button', { name: /^后退/ }).click();
  await expect(view).toBeVisible();
  expect(
    await explore
      .locator('[data-home-album]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-home-album'))),
  ).toEqual(before);
  await expect.poll(() => view.evaluate((node) => node.scrollTop)).toBeCloseTo(scroll, 0);
  await explore.getByLabel('专辑时长', { exact: true }).selectOption('30');
  await expect(explore.getByText('没有符合条件的专辑')).toBeVisible();
  await explore.getByRole('tab', { name: '曲目推荐' }).click();
  await expect(explore.locator('[data-home-track]')).toHaveCount(6);
  expect(errors).toEqual([]);
});

test('频道预览、保存、结果、编辑失败与删除', async ({ page }) => {
  const { host, view, channels, errors } = await openHome(page);
  const playlistsBefore = host.callsTo('playlist.create').length;
  await view.getByRole('button', { name: '新建频道', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('名称', { exact: false }).fill('夜间收藏');
  await dialog.getByRole('button', { name: '高级查询', exact: true }).click();
  await dialog.getByRole('combobox', { name: '查询', exact: true }).fill('ALL');
  await expect(dialog.getByText('匹配 16 首曲目')).toBeVisible();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(channels()).toEqual([
    expect.objectContaining({ name: '夜间收藏', query: 'ALL', sort: 'album' }),
  ]);
  expect(host.callsTo('playlist.create')).toHaveLength(playlistsBefore);
  await view.getByRole('button', { name: '夜间收藏', exact: true }).click();
  const channel = page.locator('[data-page="channel"]');
  await expect(channel.getByRole('treegrid')).toBeVisible();
  await expect(
    channel.locator('[data-column-id="title"]').filter({ hasText: 'Abbey Road 1' }),
  ).toBeVisible();
  await channel.getByRole('button', { name: '编辑频道', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: '查询', exact: true }).fill('invalid%');
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await expect(dialog.getByText('查询未能执行')).toBeVisible();
  await expect(dialog.getByText('匹配 16 首曲目')).toHaveCount(0);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: /^后退/ }).click();
  await view
    .getByRole('region', { name: '我的频道' })
    .getByRole('button', { name: '更多', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '删除频道', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除频道', exact: true }).click();
  await expect(view.getByText('暂无已保存的频道')).toBeVisible();
  expect(channels()).toEqual([]);
  expect(errors).toEqual([]);
});

test('离开后统计区插入，键盘后退仍恢复原专辑焦点', async ({ page }) => {
  let held: HeldCalls<'playcount.getBatch'> | undefined;
  const { view } = await openHome(page, {
    configure: (host) => {
      held = host.hold('playcount.getBatch');
    },
  });
  const explore = view.getByRole('region', { name: '探索音乐' });
  const original = explore.locator('[data-home-album] button').first();
  const name = await original.getAttribute('aria-label');
  await expect.poll(() => held?.pending.length).toBe(1);
  await original.click();
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  held?.respond(0);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(view.getByRole('region', { name: '最近听过' })).toBeVisible();
  await expect(
    explore.getByRole('button', { name: name ?? '', exact: true }).first(),
  ).toBeFocused();
});

test('遗珠换到末批后刷新减少候选，不把越界偏移当成空结果', async ({ page }) => {
  const { host, view } = await openHome(page);
  const explore = view.getByRole('region', { name: '探索音乐' });
  await explore.getByRole('tab', { name: '曲目推荐' }).click();
  await expect(explore.locator('[data-home-track]')).toHaveCount(6);
  await explore.getByLabel('换一批').click();
  await explore.getByLabel('换一批').click();
  await expect(explore.locator('[data-home-track]')).toHaveCount(4);
  host.answer('playcount.getBatch', (params) => {
    const paths = listParam(params, 'paths');
    return {
      success: true,
      count: paths.length,
      results: paths.map((path, index) => ({
        path: String(path),
        success: true,
        rating: 5,
        playCount: 1,
        lastPlayed: index < 6 ? '2020-01-01 00:00:00' : '',
      })),
    };
  });
  await host.emit('library:itemsModified', { count: 10, timestamp: 2 });
  await view.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(explore.locator('[data-home-track]')).toHaveCount(6);
  await expect(explore.getByText('没有符合条件的曲目')).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [390, 900, 1280]) {
    test(`无统计的首页可用且不横向溢出 ${scheme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme: scheme });
      const { view, errors } = await openHome(page, { statistics: false });
      await expect(view.getByRole('button', { name: '全库随机', exact: true })).toBeEnabled();
      await expect(view.getByRole('tab', { name: '曲目推荐' })).toBeDisabled();
      await expect(view.getByRole('region', { name: '最近听过' })).toHaveCount(0);
      await expect
        .poll(() => view.evaluate((node) => node.scrollWidth <= node.clientWidth))
        .toBe(true);
      if (width === 390) {
        await view.getByRole('button', { name: '四星及以上', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('combobox', { name: '查询', exact: true })).toBeVisible();
        await expect
          .poll(() => dialog.evaluate((node) => node.scrollWidth <= node.clientWidth))
          .toBe(true);
      }
      expect(errors).toEqual([]);
    });
  }
}

test('最近添加不等播放统计，独立刷新失败仍保留专辑', async ({ page }) => {
  let held: HeldCalls<'playcount.getBatch'> | undefined;
  const { host, view } = await openHome(page, {
    configure: (source) => {
      held = source.hold('playcount.getBatch');
    },
  });
  await expect.poll(() => held?.pending.length).toBe(1);
  const added = view.getByRole('region', { name: '最近添加' });
  await expect(added.locator('[data-home-album]')).toHaveCount(6);
  await expect(view.getByText('正在读取播放统计')).toBeVisible();
  host.answer('library.getRecentlyAdded', hostFailure('OPERATION_FAILED'));
  await added.getByRole('button', { name: '刷新最近添加' }).click();
  await expect(added.getByText('最近添加读取失败')).toBeVisible();
  await expect(added.locator('[data-home-album]')).toHaveCount(6);
  held?.respond(0);
});

test('没有可靠添加时间时不采用修改日期回退', async ({ page }) => {
  const { view } = await openHome(page, { statistics: false });
  await expect(view.getByText('未检测到 foo_playcount，播放统计不可用')).toBeVisible();
  const added = view.getByRole('region', { name: '最近添加' });
  await expect(added.getByText('暂无可用的添加时间')).toBeVisible();
  await expect(added.locator('[data-home-album]')).toHaveCount(0);
});

test('频道模板和普通查询预设可保存，模式草稿分别保留', async ({ page }) => {
  const { view, channels } = await openHome(page);
  await view.getByRole('button', { name: '四星及以上', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('名称', { exact: false })).toHaveValue('四星及以上');
  await expect(dialog.getByRole('combobox', { name: '查询', exact: true })).toHaveValue(
    '%rating% GREATER 3',
  );
  await dialog.getByRole('button', { name: '高级查询', exact: true }).click();
  await dialog.getByRole('combobox', { name: '查询', exact: true }).fill('Jazz');
  await dialog.locator('[data-query-funnel]').click();
  await page.locator('[data-query-option="lossless"]').click();
  await expect(dialog.getByText('匹配 16 首曲目')).toBeVisible();
  await dialog.getByRole('button', { name: '高级查询', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: '查询', exact: true })).toHaveValue(
    '%rating% GREATER 3',
  );
  await dialog.getByRole('button', { name: '高级查询', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: '查询', exact: true })).toHaveValue('Jazz');
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  // 保存先等共享写锁，宿主收到写入要晚于点击。
  await expect.poll(channels).toEqual([
    expect.objectContaining({
      name: '四星及以上',
      query: expect.stringContaining('HAS "jazz"'),
    }),
  ]);
  expect(JSON.stringify(channels())).toContain('%__encoding% IS lossless');
});

test('固定专辑可打开，重新加载保留固定入口', async ({ page }) => {
  const { view } = await openHome(page);
  await view.getByRole('button', { name: '添加固定入口' }).click();
  const dialog = page.getByRole('dialog');
  const pin = dialog.getByRole('button', { name: /^固定 / }).first();
  const album = (await pin.getAttribute('aria-label'))?.slice(3) ?? '';
  await pin.click();
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  let section = view.getByRole('region', { name: '固定入口' });
  await section.getByRole('button', { name: new RegExp(album) }).click();
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  await page.getByRole('button', { name: /^后退/ }).click();
  await page.reload();
  await page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '首页', exact: true })
    .click();
  section = page.locator('[data-page="home"]').getByRole('region', { name: '固定入口' });
  await expect(section.getByRole('button', { name: new RegExp(album) })).toBeVisible();
  await section.getByRole('button', { name: '取消固定', exact: true }).click();
  await expect(section.getByText('暂无固定入口')).toBeVisible();
});

test('固定频道打开结果，频道删除后保留可取消的失效入口', async ({ page }) => {
  const { view } = await openHome(page);
  await view.getByRole('button', { name: '四星及以上', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await view.getByRole('button', { name: '添加固定入口' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: '我的频道' }).click();
  await dialog.getByRole('button', { name: '固定 四星及以上', exact: true }).click();
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  const pins = view.getByRole('region', { name: '固定入口' });
  await pins.getByRole('button', { name: /四星及以上/ }).click();
  await expect(page.locator('[data-page="channel"]')).toBeVisible();
  await page.getByRole('button', { name: /^后退/ }).click();
  await view
    .getByRole('region', { name: '我的频道' })
    .getByRole('button', { name: '更多', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '删除频道', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除频道', exact: true }).click();
  await expect(pins.getByRole('button', { name: /四星及以上/ })).toBeDisabled();
  await pins.getByRole('button', { name: '取消固定', exact: true }).click();
  await expect(pins.getByText('暂无固定入口')).toBeVisible();
});
