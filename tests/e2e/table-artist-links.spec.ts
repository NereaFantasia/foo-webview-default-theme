import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, query = '') {
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: "import '/tests/fixtures/artistLinksEntry.ts';",
    }),
  );
  await page.goto(`/?${query}`);
  await page.locator('[data-column-id="artist"]').waitFor();
}

async function events(page: Page): Promise<unknown> {
  return JSON.parse((await page.locator('[data-log]').textContent()) ?? '[]');
}

const artist = (name: string) => ({ kind: 'open', ref: { kind: 'artist', name } });

test('多值各自成链接，点了按完整原名打开那位艺人，不触发行选择', async ({ page }) => {
  await open(page);
  const cell = page.locator('[data-column-id="artist"]');
  await expect(cell).toHaveText('Nujabes,   Shing02  , A & B / C feat. D');
  await expect(cell.getByRole('button')).toHaveCount(3);
  await cell.getByRole('button', { name: 'Shing02', exact: true }).click();
  await expect.poll(() => events(page)).toEqual([artist('  Shing02  ')]);
});

for (const modifier of ['Control', 'Shift', 'Meta'] as const) {
  test(`${modifier} 单击交给行选择，保留修饰键，不打开艺人`, async ({ page }) => {
    await open(page);
    await page
      .getByRole('button', { name: 'Nujabes', exact: true })
      .click({ modifiers: [modifier] });
    expect(await events(page)).toEqual([
      {
        kind: 'select',
        index: 0,
        ctrl: modifier === 'Control',
        shift: modifier === 'Shift',
        meta: modifier === 'Meta',
      },
    ]);
  });
}

test('双击链接不触发行播放，也不把行选中', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Nujabes', exact: true }).dblclick();
  await expect.poll(() => events(page)).toEqual([artist('Nujabes'), artist('Nujabes')]);
});

test('链接不会增加 Tab 停靠点', async ({ page }) => {
  await open(page);
  await page.locator('[data-before]').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-after]')).toBeFocused();
});

test('缺多值标签时整串只显示，不当成一位艺人', async ({ page }) => {
  await open(page, 'fallback=1');
  const cell = page.locator('[data-column-id="artist"]');
  await expect(cell).toHaveText('A & B / C feat. D');
  await expect(cell.getByRole('button')).toHaveCount(0);
});

test('打不开时多值为普通文字，双击仍交给行播放', async ({ page }) => {
  await open(page, 'plain=1');
  const cell = page.locator('[data-column-id="artist"]');
  await expect(cell).toHaveText('Nujabes,   Shing02  , A & B / C feat. D');
  await expect(cell.getByRole('button')).toHaveCount(0);
  await cell.dblclick();
  expect(await events(page)).toEqual([
    expect.objectContaining({ kind: 'select' }),
    expect.objectContaining({ kind: 'select' }),
    { kind: 'play', index: 0 },
  ]);
});

test('超过三位时点哪个名字都弹菜单，焦点落在被点的那位，菜单里的操作不改行', async ({ page }) => {
  await open(page, 'many=1');
  const trigger = page.locator('[data-column-id="artist"]').getByRole('button');
  await expect(trigger).toHaveCount(1);
  await trigger.getByText('Pase Rock', { exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Go to artist' });
  await expect(menu.getByRole('menuitem')).toHaveCount(5);
  await expect(menu.getByRole('menuitem', { name: 'Pase Rock' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Substantial' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => events(page)).toEqual([artist('Substantial')]);
});

test('正在播放的颜色传到每个艺人链接', async ({ page }) => {
  await open(page);
  const colors = await page.locator('[data-column-id="artist"]').evaluate((cell) => ({
    row: getComputedStyle(cell).color,
    links: [...cell.querySelectorAll('[role="button"]')].map(
      (link) => getComputedStyle(link).color,
    ),
  }));
  expect(colors.links).toHaveLength(3);
  expect(colors.links.every((color) => color === colors.row)).toBe(true);
});

/** 格子里文字起点落在署名上：署名被整个省略掉时，那一点是空的 */
const startsOnCredit = (page: Page) =>
  page.evaluate(() => {
    const text = document.querySelector('[data-column-id="artist"]')?.firstElementChild;
    if (!text) return false;
    const box = text.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + 4, box.top + box.height / 2);
    return !!hit?.closest('[role="button"]');
  });

test('单个署名比格子还宽：照样按字截断，不整个变成一个省略号', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 300 });
  await open(page, 'long=1');
  expect(await startsOnCredit(page)).toBe(true);
});

test('超过三位时整串入口同样按字截断', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 300 });
  await open(page, 'long=1&many=1');
  expect(await startsOnCredit(page)).toBe(true);
});
