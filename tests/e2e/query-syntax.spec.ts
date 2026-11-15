import { expect, test, type Locator, type Page } from '@playwright/test';
import { openSongs } from '../fixtures/songsPage.ts';

/** 经搜索框末尾的字段菜单切到高级查询 */
async function advanced(page: Page, view: Locator) {
  await view.locator('[data-query-scope]').click();
  await page.locator('[data-query-mode="advanced"]').click();
}

const completion = (page: Page) => page.locator('[data-syntax-completion]');

test('字段之后补运算符：回车接受并把光标放进引号里，Esc 先收补全再清文字', async ({ page }) => {
  const songs = await openSongs(page);
  await advanced(page, songs.view);
  await songs.box.fill('genre ');
  await expect(completion(page)).toBeVisible();
  await expect(completion(page).locator('[data-syntax-option]').first()).toHaveAttribute(
    'data-syntax-option',
    'has',
  );
  await songs.box.press('Escape');
  await expect(completion(page)).toHaveCount(0);
  await expect(songs.box).toHaveValue('genre ');
  await songs.box.press('Control+Space');
  await expect(completion(page)).toBeVisible();
  await songs.box.press('Enter');
  await expect(songs.box).toHaveValue('genre HAS ""');
  expect(await songs.box.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(11);
  await expect(completion(page)).toHaveCount(0);
  await songs.box.press('Escape');
  await expect(songs.box).toHaveValue('');
  expect(songs.errors).toEqual([]);
});

test('键入 % 补字段，方向键换项、Tab 接受；补出来的字段写全了', async ({ page }) => {
  const songs = await openSongs(page);
  await advanced(page, songs.view);
  await songs.box.fill('%r');
  const options = completion(page).locator('[data-syntax-option]');
  await expect(options.first()).toHaveAttribute('data-syntax-option', 'rating');
  await songs.box.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await songs.box.press('Tab');
  await expect(songs.box).toHaveValue('%replaygain_track_gain%');
  await expect(completion(page)).toHaveCount(0);
  expect(songs.errors).toEqual([]);
});

test('高级查询的文字被着色层复述，错误有提示条', async ({ page }) => {
  const songs = await openSongs(page);
  await advanced(page, songs.view);
  await songs.box.fill('(artist IS "x"');
  await expect(songs.view.locator('[data-syntax-layer]')).toHaveText('(artist IS "x"');
  await expect(page.locator('[data-syntax-hint="error"]')).toBeVisible();
  await songs.box.fill('artist IS "x"');
  await expect(page.locator('[data-syntax-hint="error"]')).toHaveCount(0);
  expect(songs.errors).toEqual([]);
});

test('语法参考：点一行插到光标处，固定之后点外面不收，连着点', async ({ page }) => {
  const songs = await openSongs(page);
  await advanced(page, songs.view);
  await songs.box.fill('genre');
  await songs.view.locator('[data-query-scope]').click();
  await page.locator('[data-query-reference]').click();
  const panel = page.locator('[data-syntax-reference]');
  await expect(panel).toBeVisible();
  await panel.locator('[data-syntax-row="HAS"] > button').first().click();
  await expect(songs.box).toHaveValue('genre HAS ""');
  await expect(songs.box).toBeFocused();
  await expect(panel.locator('[data-syntax-detail]')).toContainText('<field> HAS <string>');
  await panel.locator('[data-syntax-pin]').click();
  await songs.view.getByRole('heading', { level: 1, name: '歌曲' }).click();
  await expect(panel).toBeVisible();
  await panel.locator('[data-syntax-row="AND"] > button').first().click();
  await expect(songs.box).toHaveValue('genre HAS "" AND ');
  await panel.locator('[data-syntax-close]').click();
  await expect(panel).toHaveCount(0);
  expect(songs.errors).toEqual([]);
});

test('语法参考的搜索按名字与说明筛，没有命中时写明', async ({ page }) => {
  const songs = await openSongs(page);
  await advanced(page, songs.view);
  await songs.view.locator('[data-query-scope]').click();
  await page.locator('[data-query-reference]').click();
  const panel = page.locator('[data-syntax-reference]');
  await panel.locator('[data-syntax-search]').fill('回放增益');
  await expect(panel.locator('[data-syntax-row="%replaygain_track_gain%"]')).toBeVisible();
  await expect(panel.locator('[data-syntax-row="HAS"]')).toHaveCount(0);
  await panel.locator('[data-syntax-search]').fill('zzzz');
  await expect(panel).toContainText('没有匹配的项');
  expect(songs.errors).toEqual([]);
});

test('框尾的复制键把整句查询放进剪贴板，框空时置灰', async ({ page }) => {
  const songs = await openSongs(page, {
    configure: (host) => host.answer('clipboard.write', { success: true }),
  });
  await advanced(page, songs.view);
  const copy = songs.view.locator('[data-query-copy]');
  await expect(copy).toBeDisabled();
  await songs.box.fill('artist IS "Radiohead" AND %rating% GREATER 3');
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect
    .poll(() => songs.host.callsTo('clipboard.write').at(-1))
    .toEqual({ text: 'artist IS "Radiohead" AND %rating% GREATER 3' });
  expect(songs.errors).toEqual([]);
});

test('语法参考顶上的分节标签：点一下滚到那一组，往回滚时标签跟着换', async ({ page }) => {
  const songs = await openSongs(page);
  await advanced(page, songs.view);
  await songs.view.locator('[data-query-scope]').click();
  await page.locator('[data-query-reference]').click();
  const panel = page.locator('[data-syntax-reference]');
  const nav = (group: string) => panel.locator(`[data-syntax-nav="${group}"]`);
  await expect(nav('common')).toHaveAttribute('aria-pressed', 'true');
  await nav('function').click();
  await expect(nav('function')).toHaveAttribute('aria-pressed', 'true');
  const scroller = panel.locator('[data-syntax-group="common"]').locator('xpath=..');
  // 滚动落点本身是被测行为：那一组的标题停在滚动区的顶上
  await expect
    .poll(() =>
      panel.locator('[data-syntax-group="function"]').evaluate((group) => {
        const box = group.parentElement?.getBoundingClientRect();
        return box ? Math.abs(group.getBoundingClientRect().top - box.top) : -1;
      }),
    )
    .toBeLessThan(24);
  await expect(panel.locator('[data-syntax-topic="logic"]')).toBeVisible();
  await scroller.evaluate((element) => element.scrollTo({ top: 0 }));
  await expect(nav('common')).toHaveAttribute('aria-pressed', 'true');
  await expect(nav('function')).toHaveAttribute('aria-pressed', 'false');
  expect(songs.errors).toEqual([]);
});

test('语法参考搜索时分节标签只剩有命中的组', async ({ page }) => {
  const songs = await openSongs(page);
  await advanced(page, songs.view);
  await songs.view.locator('[data-query-scope]').click();
  await page.locator('[data-query-reference]').click();
  const panel = page.locator('[data-syntax-reference]');
  await panel.locator('[data-syntax-search]').fill('回放增益');
  await expect(panel.locator('[data-syntax-nav]')).toHaveCount(1);
  await expect(panel.locator('[data-syntax-nav="field"]')).toBeVisible();
  expect(songs.errors).toEqual([]);
});

test('键入 % 一次列出几十个字段：补全列表压在视口里，列表自己滚，方向键走到底选中项仍看得见', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  const songs = await openSongs(page);
  await advanced(page, songs.view);
  await songs.box.fill('%');
  const surface = completion(page);
  await expect(surface).toBeVisible();
  const options = surface.locator('[data-syntax-option]');
  expect(await options.count()).toBeGreaterThan(12);
  // 几何本身就是被测行为：浮层不超出视口，列表比可见区高、靠滚动看后面的行
  const fits = () =>
    surface.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= window.innerHeight;
    });
  await expect.poll(fits).toBe(true);
  const list = surface.locator('[role="listbox"]');
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  for (let step = 0; step < 20; step += 1) await songs.box.press('ArrowDown');
  const selected = surface.locator('[aria-selected="true"]');
  await expect
    .poll(async () => {
      const row = await selected.boundingBox();
      const frame = await list.boundingBox();
      return (
        !!row && !!frame && row.y >= frame.y - 1 && row.y + row.height <= frame.y + frame.height + 1
      );
    })
    .toBe(true);
  await expect.poll(fits).toBe(true);
  expect(songs.errors).toEqual([]);
});

test('高级查询的搜索框默认与普通搜索一样宽，语句超长时才加宽，删短后缩回', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  const songs = await openSongs(page);
  const slot = songs.view.locator('[data-command-search]');
  const width = async () => Math.round((await slot.boundingBox())?.width ?? 0);
  const plain = await width();
  await advanced(page, songs.view);
  // 宽度本身是被测行为；加宽带过渡，所以用自动重试等它落定
  await expect.poll(width).toBe(plain);
  await songs.box.fill('genre IS "Hip-Hop"');
  await expect.poll(width).toBe(plain);
  const long =
    'genre IS "Hip-Hop" AND artist HAS "Dilla" AND %rating% GREATER 3 AND %length_seconds% LESS 600';
  await songs.box.fill(long);
  await expect.poll(width).toBeGreaterThan(plain + 100);
  expect(await width()).toBeLessThanOrEqual(800);
  await songs.box.fill('genre IS "Hip-Hop"');
  await expect.poll(width).toBe(plain);
  expect(songs.errors).toEqual([]);
});

test('依赖 foo_playcount 的字段在补全与参考里带组件标签；没装时换警示，评分只是标签不警示', async ({
  page,
}) => {
  const songs = await openSongs(page, {
    configure: (host) =>
      host.answer('config.getComponents', { success: true, count: 0, components: [] }),
  });
  await advanced(page, songs.view);
  await songs.box.fill('%p');
  const played = completion(page).locator('[data-syntax-option="playCount"]');
  await expect(played.locator('[data-syntax-source="playcount"]')).toHaveText('foo_playcount');
  // 探测结果回来后警示才出，重试到它出现
  await expect(played.locator('[data-syntax-source][data-missing]')).toBeVisible();
  await songs.box.fill('%t');
  await expect(
    completion(page).locator('[data-syntax-option="title"] [data-syntax-source]'),
  ).toHaveCount(0);
  await songs.box.fill('%rat');
  const rating = completion(page).locator('[data-syntax-option="rating"]');
  await expect(rating.locator('[data-syntax-source="playcount"]')).toBeVisible();
  await expect(rating.locator('[data-syntax-source][data-missing]')).toHaveCount(0);
  await songs.view.locator('[data-query-scope]').click();
  await page.locator('[data-query-reference]').click();
  const panel = page.locator('[data-syntax-reference]');
  await panel.locator('[data-syntax-search]').fill('play_count');
  await expect(
    panel.locator('[data-syntax-row="%play_count%"] [data-syntax-source][data-missing]'),
  ).toBeVisible();
  expect(songs.errors).toEqual([]);
});

test('点分节标签滚到那一组：途中标签不逐个闪过中间的组，停下后仍亮着点的那一组', async ({
  page,
}) => {
  const songs = await openSongs(page);
  await advanced(page, songs.view);
  await songs.view.locator('[data-query-scope]').click();
  await page.locator('[data-query-reference]').click();
  const panel = page.locator('[data-syntax-reference]');
  await expect(panel.locator('[data-syntax-nav="common"]')).toHaveAttribute('aria-pressed', 'true');
  // 记下之后每个变成按下态的标签，顺序即闪过的顺序
  await panel.evaluate((root) => {
    const lit: string[] = [];
    Reflect.set(window, '__lit', lit);
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target;
        if (target instanceof HTMLElement && target.getAttribute('aria-pressed') === 'true')
          lit.push(target.dataset['syntaxNav'] ?? '');
      }
    }).observe(root, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
  });
  await panel.locator('[data-syntax-nav="sort"]').click();
  const scroller = panel.locator('[data-syntax-group="common"]').locator('xpath=..');
  // 等滚动停下：`scrollend` 或一秒的上限，两者先到的算
  await scroller.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        element.addEventListener('scrollend', () => resolve(), { once: true });
        setTimeout(resolve, 1000);
      }),
  );
  expect(await page.evaluate(() => Reflect.get(window, '__lit'))).toEqual(['sort']);
  await expect(panel.locator('[data-syntax-nav="sort"]')).toHaveAttribute('aria-pressed', 'true');
  expect(songs.errors).toEqual([]);
});
