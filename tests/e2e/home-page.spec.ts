import { expect, test, type Locator } from '@playwright/test';
import { HOME_SECTIONS_KEY } from '../../src/library/home/homeSections.ts';
import { openHome } from '../fixtures/homePage.ts';
import type { HeldCalls } from '../fixtures/fakeHost.ts';
import { hostFailure, listParam } from '../fixtures/hostAnswers.ts';

test.use({ screenshot: 'off' });

// 快捷入口里固定的与最近播放的入口，不含全库随机那一格
const entriesOf = (quick: Locator) =>
  quick.locator('[data-home-item]:not([data-home-item="shuffle"])');

const LIBRARY_CHANGED = {
  count: 10,
  handles: [],
  truncated: false,
  fromHook: false,
  timestamp: 2,
};

// 在线的几行要后端答公共推荐；这里的页面没有后端，它们与下载卡都不该出
const ONLINE_SECTIONS = ['ncm-setup', 'banners', 'new-tracks', 'charts', 'playlists', 'releases']
  .map((section) => `[data-home-section="${section}"]`)
  .join(', ');

test('统计部分失败仍显示成功内容，重试恢复后撤下提示', async ({ page }) => {
  let fail = true;
  const { view } = await openHome(page, {
    configure: (host) =>
      host.answer('playcount.getBatch', (params) => {
        const paths = listParam(params, 'paths');
        return {
          success: true,
          count: paths.length,
          results: paths.map((path, index) =>
            fail && index === 0
              ? { path: String(path), success: false, error: 'Failed to open file' }
              : {
                  path: String(path),
                  success: true,
                  playCount: 1,
                  lastPlayed: '2026-09-01 00:00:00',
                },
          ),
        };
      }),
  });
  const notice = view.locator('[data-home-section="statistics"]');
  const quick = view.getByRole('region', { name: '固定与最近播放' });
  await expect(notice).toContainText('有 1 首曲目的播放统计未能读取');
  // 八张专辑都听过，一行四格、末两格留给全库随机与管理固定入口，最近播放占六格
  await expect(entriesOf(quick)).toHaveCount(6);
  fail = false;
  await notice.getByRole('button', { name: '重试', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(entriesOf(quick)).toHaveCount(6);
});

test('统计未完成不阻塞最近添加，翻到末页进专辑再后退仍停在末页与原滚动', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let held: HeldCalls<'playcount.getBatch'> | undefined;
  const { view, errors } = await openHome(page, {
    configure: (host) => {
      held = host.hold('playcount.getBatch');
    },
  });
  const added = view.getByRole('region', { name: '最近添加' });
  // 依赖播放统计的行先占着骨架，读到后原位换成真内容
  const mostPlayed = view.getByRole('region', { name: '最常播放' });
  await expect(mostPlayed).toHaveAttribute('aria-busy', 'true');
  await expect(added.locator('[data-home-album]')).toHaveCount(8);
  await expect.poll(() => held?.pending.length).toBe(1);
  held?.respond(0);
  await expect(view.getByRole('region', { name: '重听遗珠' })).toBeVisible();
  await expect(mostPlayed).not.toHaveAttribute('aria-busy', 'true');
  const previous = added.getByRole('button', { name: '上一页', exact: true });
  const next = added.getByRole('button', { name: '下一页', exact: true });
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(next).toBeDisabled();
  await expect(previous).toBeEnabled();
  const last = added.locator('[data-tile-face]').last();
  await last.focus();
  const scroll = await view.evaluate((node) => node.scrollTop);
  await last.click();
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  await page.getByRole('button', { name: /^后退/ }).click();
  await expect(view).toBeVisible();
  await expect(next).toBeDisabled();
  await expect(previous).toBeEnabled();
  await expect.poll(() => view.evaluate((node) => node.scrollTop)).toBeCloseTo(scroll, 0);
  expect(errors).toEqual([]);
});

test('频道预览、保存、结果、编辑失败与删除', async ({ page }) => {
  const { host, view, channels, errors } = await openHome(page);
  const playlistsBefore = host.callsTo('playlist.create').length;
  await view.getByRole('button', { name: '新建频道', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('名称', { exact: false }).fill('夜间收藏');
  await dialog.locator('[data-query-scope]').click();
  await page.locator('[data-query-mode="advanced"]').click();
  await dialog.getByRole('searchbox', { name: '查询', exact: true }).fill('ALL');
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
  await dialog.getByRole('searchbox', { name: '查询', exact: true }).fill('invalid%');
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await expect(dialog.getByText('查询未能执行')).toBeVisible();
  await expect(dialog.getByText('匹配 16 首曲目')).toHaveCount(0);
  // 键入 % 后字段的补全候选弹出来，盖在对话框底部的按钮上；Esc 先收起补全，再点取消
  await dialog.getByRole('searchbox', { name: '查询', exact: true }).press('Escape');
  await expect(page.getByRole('listbox', { name: '补全候选' })).toHaveCount(0);
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

test('离开后快捷入口补上最近播放，键盘后退仍恢复原专辑焦点', async ({ page }) => {
  let held: HeldCalls<'playcount.getBatch'> | undefined;
  const { view } = await openHome(page, {
    configure: (host) => {
      held = host.hold('playcount.getBatch');
    },
  });
  const added = view.getByRole('region', { name: '最近添加' });
  const original = added.locator('[data-tile-face]').first();
  const name = await original.getAttribute('aria-label');
  await expect.poll(() => held?.pending.length).toBe(1);
  await original.click();
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  held?.respond(0);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(entriesOf(view.getByRole('region', { name: '固定与最近播放' }))).toHaveCount(6);
  await expect(added.getByRole('button', { name: name ?? '', exact: true }).first()).toBeFocused();
});

test('遗珠换到末批后刷新减少候选，不把越界偏移当成空结果', async ({ page }) => {
  const { host, view } = await openHome(page);
  const gems = view.getByRole('region', { name: '重听遗珠' });
  // 十六首都是五星、很久没听：一批十二首，换一批剩四首
  await expect(gems.locator('[data-home-track]')).toHaveCount(12);
  await gems.getByRole('button', { name: '换一批', exact: true }).click();
  await expect(gems.locator('[data-home-track]')).toHaveCount(4);
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
  await host.waitForListener('library:itemsModified');
  await host.emit('library:itemsModified', LIBRARY_CHANGED);
  await view.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(gems.locator('[data-home-track]')).toHaveCount(6);
  await expect(gems.getByRole('button', { name: '换一批', exact: true })).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [390, 900, 1280]) {
    test(`无统计、无可靠添加时间时首页可用且不横向溢出 ${scheme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme: scheme });
      const { view, errors } = await openHome(page, { statistics: false });
      await expect(view.getByRole('button', { name: /全库随机/ })).toBeEnabled();
      await expect(view.getByRole('region', { name: '媒体库' })).toBeVisible();
      const quick = view.getByRole('region', { name: '固定与最近播放' });
      await expect(quick.getByRole('button', { name: '添加固定入口' })).toBeVisible();
      await expect(entriesOf(quick)).toHaveCount(0);
      // 宿主按修改时间回退的列表不当成最近添加
      for (const name of ['最近添加', '重听遗珠', '最常播放'])
        await expect(view.getByRole('region', { name, exact: true })).toHaveCount(0);
      await expect
        .poll(() => view.evaluate((node) => node.scrollWidth <= node.clientWidth))
        .toBe(true);
      if (width === 390) {
        await view.getByRole('button', { name: '四星及以上', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('searchbox', { name: '查询', exact: true })).toBeVisible();
        await expect
          .poll(() => dialog.evaluate((node) => node.scrollWidth <= node.clientWidth))
          .toBe(true);
      }
      expect(errors).toEqual([]);
    });
  }
}

test('最近添加不等播放统计，刷新失败仍保留专辑', async ({ page }) => {
  let held: HeldCalls<'playcount.getBatch'> | undefined;
  const { host, view } = await openHome(page, {
    configure: (source) => {
      held = source.hold('playcount.getBatch');
    },
  });
  await expect.poll(() => held?.pending.length).toBe(1);
  const added = view.getByRole('region', { name: '最近添加' });
  await expect(added.locator('[data-home-album]')).toHaveCount(8);
  // 依赖播放统计的行先占着骨架，读到后原位换成真内容
  const mostPlayed = view.getByRole('region', { name: '最常播放' });
  await expect(mostPlayed).toHaveAttribute('aria-busy', 'true');
  host.answer('library.getRecentlyAdded', hostFailure('OPERATION_FAILED'));
  await host.waitForListener('library:itemsModified');
  await host.emit('library:itemsModified', LIBRARY_CHANGED);
  await view.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(added.getByText('最近添加读取失败')).toBeVisible();
  await expect(added.locator('[data-home-album]')).toHaveCount(8);
  held?.respond(0);
});

test('频道模板和普通查询预设可保存，模式草稿分别保留', async ({ page }) => {
  const { view, channels } = await openHome(page);
  await view.getByRole('button', { name: '四星及以上', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('名称', { exact: false })).toHaveValue('四星及以上');
  await expect(dialog.getByRole('searchbox', { name: '查询', exact: true })).toHaveValue(
    '%rating% GREATER 3',
  );
  await dialog.locator('[data-query-scope]').click();
  await page.locator('[data-query-mode="text"]').click();
  await dialog.getByRole('searchbox', { name: '查询', exact: true }).fill('Jazz');
  await dialog.locator('[data-preset="lossless"]').click();
  await expect(dialog.getByText('匹配 16 首曲目')).toBeVisible();
  await dialog.locator('[data-query-scope]').click();
  await page.locator('[data-query-mode="advanced"]').click();
  await expect(dialog.getByRole('searchbox', { name: '查询', exact: true })).toHaveValue(
    '%rating% GREATER 3',
  );
  await dialog.locator('[data-query-scope]').click();
  await page.locator('[data-query-mode="text"]').click();
  await expect(dialog.getByRole('searchbox', { name: '查询', exact: true })).toHaveValue('Jazz');
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  // 保存先等共享写锁，宿主收到写入要晚于点击
  await expect.poll(channels).toEqual([
    expect.objectContaining({
      name: '四星及以上',
      query: expect.stringContaining('HAS "jazz"'),
    }),
  ]);
  expect(JSON.stringify(channels())).toContain('%__encoding% IS lossless');
});

test('频道下拉选择模板和排序后保存对应查询，空模板保留当前草稿', async ({ page }) => {
  const { view, channels, errors } = await openHome(page);
  await view.getByRole('button', { name: '新建频道', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const template = dialog.getByRole('combobox', { name: '模板', exact: true });
  await expect(template).toHaveText('自定义');
  await template.click();
  await dialog.getByRole('option', { name: '四星及以上', exact: true }).click();
  await expect(dialog.getByLabel('名称', { exact: false })).toHaveValue('四星及以上');
  await template.click();
  await dialog.getByRole('option', { name: '自定义', exact: true }).click();
  await expect(template).toHaveText('自定义');
  await expect(dialog.getByRole('searchbox', { name: '查询', exact: true })).toHaveValue(
    '%rating% GREATER 3',
  );
  await dialog.getByRole('combobox', { name: '排序', exact: true }).click();
  await dialog.getByRole('option', { name: '标题', exact: true }).click();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect
    .poll(channels)
    .toEqual([
      expect.objectContaining({ name: '四星及以上', query: '%rating% GREATER 3', sort: 'title' }),
    ]);
  expect(errors).toEqual([]);
});

test('固定专辑排在快捷入口最前、可打开，重新加载后仍在，取消后撤下', async ({ page }) => {
  const { view } = await openHome(page);
  await view.getByRole('button', { name: '添加固定入口' }).click();
  const dialog = page.getByRole('dialog');
  const pin = dialog.getByRole('button', { name: /^固定 / }).first();
  const album = (await pin.getAttribute('aria-label'))?.slice(3) ?? '';
  await pin.click();
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  let quick = view.getByRole('region', { name: '固定与最近播放' });
  // 取消固定键只在悬停或聚焦时显示，按存在与否判断入口是不是固定的
  const unpin = () =>
    quick.getByRole('button', { name: `取消固定 ${album}`, exact: true, includeHidden: true });
  await expect(quick.locator('[data-home-item]').first()).toContainText(album);
  await expect(unpin()).toHaveCount(1);
  await quick.locator('[data-home-item]').first().locator('button').first().click();
  await expect(page.locator('[data-page="album"]')).toBeVisible();
  await page.getByRole('button', { name: /^后退/ }).click();
  await page.reload();
  await page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '首页', exact: true })
    .click();
  quick = page.locator('[data-page="home"]').getByRole('region', { name: '固定与最近播放' });
  const first = quick.locator('[data-home-item]').first();
  await expect(first).toContainText(album);
  await first.hover();
  await quick.getByRole('button', { name: `取消固定 ${album}`, exact: true }).click();
  await expect(unpin()).toHaveCount(0);
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
  const quick = view.getByRole('region', { name: '固定与最近播放' });
  const entry = quick.locator('[data-home-item]').filter({ hasText: '四星及以上' });
  await entry.getByRole('button', { name: /四星及以上/ }).click();
  await expect(page.locator('[data-page="channel"]')).toBeVisible();
  await page.getByRole('button', { name: /^后退/ }).click();
  await view
    .getByRole('region', { name: '我的频道' })
    .getByRole('button', { name: '更多', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '删除频道', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除频道', exact: true }).click();
  await expect(entry.getByRole('button', { name: /四星及以上/ })).toBeDisabled();
  await expect(entry).toContainText('项目暂不可用');
  await entry.hover();
  await entry.getByRole('button', { name: '取消固定 四星及以上', exact: true }).click();
  await expect(entry).toHaveCount(0);
});

test('本地各行齐全、在线行不出，行标题与概览卡进对应页面', async ({ page }) => {
  const { view, errors } = await openHome(page);
  for (const name of ['固定与最近播放', '最近添加', '重听遗珠', '最常播放', '媒体库', '我的频道'])
    await expect(view.getByRole('region', { name, exact: true })).toBeVisible();
  await expect(view.locator(ONLINE_SECTIONS)).toHaveCount(0);
  await view
    .getByRole('region', { name: '重听遗珠' })
    .getByRole('button', { name: '重听遗珠', exact: true })
    .click();
  const songs = page.locator('[data-page="songs"]');
  await expect(songs).toBeVisible();
  // 进歌曲页时带着遗珠的条件，搜索框切到高级查询
  await expect(songs.locator('[data-query-scope="advanced"]')).toBeVisible();
  await page.getByRole('button', { name: /^后退/ }).click();
  await view.getByRole('region', { name: '媒体库' }).locator('[data-home-item="albums"]').click();
  await expect(page.locator('[data-page="albums"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('设置里存的次序与显隐决定首页各行怎么排', async ({ page }) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, 'overview,added,quick,-gems'),
    HOME_SECTIONS_KEY,
  );
  const { view, errors } = await openHome(page);
  const shown = ['quick', 'added', 'gems', 'most-played', 'overview'];
  // 概览挪到了最前，重听遗珠关掉了；没挪的最常播放跟在后面
  await expect
    .poll(() =>
      view
        .locator('[data-home-section]')
        .evaluateAll(
          (nodes, known) =>
            nodes
              .map((node) => node.getAttribute('data-home-section') ?? '')
              .filter((section) => known.includes(section)),
          shown,
        ),
    )
    .toEqual(['overview', 'added', 'quick', 'most-played']);
  expect(errors).toEqual([]);
});

const sectionsOf = (view: Locator) =>
  view
    .locator('[data-home-section]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute('data-home-section') ?? '')
        .filter((section) =>
          ['quick', 'added', 'gems', 'most-played', 'overview'].includes(section),
        ),
    );

test('编辑模式里各行变占位符，可关掉、加回、用键挪动，退出后首页照这个排', async ({ page }) => {
  const { view, errors } = await openHome(page);
  await view.getByRole('button', { name: '编辑首页', exact: true }).click();
  const list = view.getByRole('list', { name: '首页的行' });
  const rows = list.getByRole('listitem');
  await expect(rows).toHaveCount(10);
  // 各行都收成占位符，真内容不在
  await expect(view.getByRole('region', { name: '最近添加' })).toHaveCount(0);
  await list.getByRole('button', { name: '关闭「重听遗珠」', exact: true }).click();
  await expect(rows).toHaveCount(9);
  await view.getByRole('button', { name: '添加行', exact: true }).click();
  await page.getByRole('menuitem', { name: '重听遗珠', exact: true }).click();
  await expect(rows).toHaveCount(10);
  // 加回的行排在末尾；手柄上按 ↑ 往前挪一格，焦点跟着留在手柄上
  await expect(rows.last()).toContainText('重听遗珠');
  await rows.last().getByRole('button', { name: '移动「重听遗珠」', exact: true }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(rows.nth(8)).toContainText('重听遗珠');
  await expect(
    rows.nth(8).getByRole('button', { name: '移动「重听遗珠」', exact: true }),
  ).toBeFocused();
  await view.getByRole('button', { name: '完成', exact: true }).click();
  await expect(view.getByRole('region', { name: '最近添加' })).toBeVisible();
  await expect
    .poll(() => sectionsOf(view))
    .toEqual(['quick', 'added', 'most-played', 'gems', 'overview']);
  expect(errors).toEqual([]);
});

test('编辑模式里拖动占位符调次序，Esc 退出，恢复默认回到缺省次序', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 1100 });
  const { view } = await openHome(page);
  await view.getByRole('button', { name: '编辑首页', exact: true }).click();
  const rows = view.getByRole('list', { name: '首页的行' }).getByRole('listitem');
  const order = () =>
    rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-home-edit-row')));
  const first = await rows.first().boundingBox();
  const last = await rows.last().boundingBox();
  if (!first || !last) throw new Error('占位符没有排出来');
  // 在名字上按下末行，拖到首行上半，松手
  await page.mouse.move(last.x + 120, last.y + last.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + 120, last.y - 40, { steps: 5 });
  await page.mouse.move(first.x + 120, first.y + 6, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await order())[0]).toBe('overview');
  await view.getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect.poll(async () => (await order())[0]).toBe('quick');
  await page.keyboard.press('Escape');
  await expect(view.getByRole('button', { name: '编辑首页', exact: true })).toBeVisible();
  await expect(view.getByRole('list', { name: '首页的行' })).toHaveCount(0);
});
