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

test('多值链接回传完整原名与同一曲目对象，不触发行选择', async ({ page }) => {
  await open(page);
  const cell = page.locator('[data-column-id="artist"]');
  await expect(cell).toHaveText('Nujabes,   Shing02  , A & B / C feat. D');
  await expect(cell.getByRole('button')).toHaveCount(3);
  await cell.getByRole('button', { name: 'Shing02', exact: true }).click();
  expect(await events(page)).toEqual([
    expect.objectContaining({
      kind: 'artist',
      name: '  Shing02  ',
      sameTrack: true,
      track: expect.objectContaining({ title: 'Feather', artist: 'A & B / C feat. D' }),
    }),
  ]);
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
  expect(await events(page)).toEqual([
    expect.objectContaining({ kind: 'artist', name: 'Nujabes' }),
    expect.objectContaining({ kind: 'artist', name: 'Nujabes' }),
  ]);
});

test('单值回退不拆分署名，链接不会增加 Tab 停靠点', async ({ page }) => {
  await open(page, 'fallback=1');
  const link = page.locator('[data-column-id="artist"]').getByRole('button');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText('A & B / C feat. D');
  await link.click();
  expect(await events(page)).toEqual([
    expect.objectContaining({ kind: 'artist', name: 'A & B / C feat. D', sameTrack: true }),
  ]);
  await page.locator('[data-before]').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-after]')).toBeFocused();
});

test('无回调时多值为普通文字，双击仍交给行播放', async ({ page }) => {
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

test('正在播放的颜色传到每个艺人链接', async ({ page }) => {
  await open(page);
  const colors = await page.locator('[data-column-id="artist"]').evaluate((cell) => ({
    row: getComputedStyle(cell).color,
    links: [...cell.querySelectorAll('button')].map((link) => getComputedStyle(link).color),
  }));
  expect(colors.links).toHaveLength(3);
  expect(colors.links.every((color) => color === colors.row)).toBe(true);
});
