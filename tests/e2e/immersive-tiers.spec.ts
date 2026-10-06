import { expect, test, type Locator, type Page } from '@playwright/test';
import { openImmersive } from '../fixtures/immersivePage.ts';
import { PLAYING_TRACK } from '../fixtures/playerPage.ts';

// 图纸的收缩档与竖版：在 1280 × 800 下进页，再改视口，`data-tier` 跟着换，版心里各块按档位去留与排布。

const field = (view: Locator, id: string): Locator => view.locator(`[data-field="${id}"]`);
const widthOf = async (target: Locator): Promise<number> =>
  (await target.boundingBox())?.width ?? 0;

interface Sheet {
  readonly view: Locator;
  readonly errors: string[];
  readonly tier: Locator;
  readonly sheet: Locator;
  readonly fields: Locator;
  readonly cover: Locator;
  readonly rings: Locator;
  readonly orbit: Locator;
  readonly transport: Locator;
  readonly terrain: Locator;
}

/** 进页、等进场过渡播完，再改到 `width` × `height`。 */
async function openAt(page: Page, width: number, height: number): Promise<Sheet> {
  const { view, errors } = await openImmersive(page);
  await expect
    .poll(() => view.boundingBox())
    .toStrictEqual({ x: 0, y: 0, width: 1280, height: 800 });
  await page.setViewportSize({ width, height });
  await expect.poll(() => view.boundingBox()).toStrictEqual({ x: 0, y: 0, width, height });
  return {
    view,
    errors,
    tier: view.locator('[data-tier]'),
    sheet: view.locator('[data-paper-content]'),
    fields: view.locator('[data-paper-fields]'),
    cover: view.locator('[data-dial-cover]'),
    rings: view.locator('[data-dial-ring]'),
    orbit: view.locator('canvas[data-orbit]'),
    transport: view.getByRole('group', { name: '播放控制' }),
    terrain: view.locator('[data-terrain]'),
  };
}

async function expectMissing(view: Locator, ids: readonly string[]): Promise<void> {
  for (const id of ids) await expect(field(view, id), id).toHaveCount(0);
}

/** 右栏整块落在封面下面：竖版三档上环下表。 */
async function expectFieldsBelowCover(sheet: Sheet): Promise<void> {
  const cover = await sheet.cover.boundingBox();
  const fields = await sheet.fields.boundingBox();
  expect(cover && fields && fields.y > cover.y + cover.height).toBe(true);
}

/** 山脊图按 1280 × 800 一块沉到底部。 */
async function expectSunkTerrain(sheet: Sheet, height: number): Promise<void> {
  const terrain = await sheet.terrain.boundingBox();
  expect(terrain?.width).toBeCloseTo(1280, 0);
  expect(terrain && terrain.y + terrain.height).toBeCloseTo(height, 0);
}

test('1366 × 720 够得上舞台的缩放下限，落 full 档', async ({ page }) => {
  const sheet = await openAt(page, 1366, 720);
  await expect(sheet.tier).toHaveAttribute('data-tier', 'full');
  await expect(sheet.fields).toHaveCount(0);
  await expect(field(sheet.view, 'remaining')).toHaveCount(1);
  expect(sheet.errors).toStrictEqual([]);
});

test('compact 1200 × 720：左环右表，罗盘缩到 0.8，右栏 600 宽，去声场与 3 × 2，Quality 与时长还在', async ({
  page,
}) => {
  const sheet = await openAt(page, 1200, 720);
  await expect(sheet.tier).toHaveAttribute('data-tier', 'compact');
  await expect(sheet.fields).toHaveAttribute('data-paper-fields', 'compact');
  expect(await widthOf(sheet.cover)).toBeCloseTo(240, 0);
  expect(await widthOf(sheet.transport)).toBeCloseTo(192, 0);
  expect(await widthOf(sheet.fields)).toBeCloseTo(600, 0);
  await expect(sheet.rings).toHaveCount(3);
  await expect(sheet.orbit).toHaveCount(1);
  await expectMissing(sheet.view, ['correlation', 'sampleRate', 'remaining']);
  for (const id of ['quality', 'duration', 'elapsed', 'genre', 'year', 'label']) {
    await expect(field(sheet.view, id), id).toBeVisible();
  }
  await expect(field(sheet.view, 'title')).toHaveText(PLAYING_TRACK.title);
  expect(sheet.errors).toStrictEqual([]);
});

test('compact 900 × 700：版心 900 宽，右栏收到 364、右边留 24', async ({ page }) => {
  const sheet = await openAt(page, 900, 700);
  await expect(sheet.tier).toHaveAttribute('data-tier', 'compact');
  expect(await widthOf(sheet.sheet)).toBeCloseTo(900, 0);
  expect(await widthOf(sheet.fields)).toBeCloseTo(364, 0);
});

test('narrow 390 × 700：单栏，左上 160 封面、右侧传输键，只留 From / 标题 / By / 频谱 / 波形 / 歌词', async ({
  page,
}) => {
  const sheet = await openAt(page, 390, 700);
  await expect(sheet.tier).toHaveAttribute('data-tier', 'narrow');
  await expect(sheet.fields).toHaveAttribute('data-paper-fields', 'narrow');
  expect(await widthOf(sheet.cover)).toBeCloseTo(160, 0);
  expect(await widthOf(sheet.fields)).toBeCloseTo(358, 0);
  await expect(sheet.rings).toHaveCount(0);
  await expect(sheet.orbit).toHaveCount(0);
  await expectMissing(sheet.view, ['quality', 'genre', 'duration', 'sampleRate', 'correlation']);
  await expect(sheet.view.getByText(/^DR: TT DR Meter/)).toHaveCount(0);
  await expect(field(sheet.view, 'title')).toBeVisible();
  await expect(field(sheet.view, 'album')).toBeVisible();
  const transport = await sheet.transport.boundingBox();
  expect(transport && transport.x + transport.width).toBeLessThanOrEqual(390);
  expect(sheet.errors).toStrictEqual([]);
});

test('narrow 900 × 600：宽够而太矮也落单栏，栏宽 600，版心顶对齐', async ({ page }) => {
  const sheet = await openAt(page, 900, 600);
  await expect(sheet.tier).toHaveAttribute('data-tier', 'narrow');
  expect(await widthOf(sheet.fields)).toBeCloseTo(600, 0);
  expect((await sheet.sheet.boundingBox())?.y).toBe(0);
});

test('竖版 864 × 1536：上环下表、件件原尺寸，山脊图 1280 宽沉到底部', async ({ page }) => {
  const sheet = await openAt(page, 864, 1536);
  await expect(sheet.tier).toHaveAttribute('data-tier', 'portrait');
  await expect(sheet.fields).toHaveAttribute('data-paper-fields', 'full');
  expect(await widthOf(sheet.cover)).toBeCloseTo(300, 0);
  await expectFieldsBelowCover(sheet);
  for (const id of ['correlation', 'sampleRate', 'genre', 'elapsed']) {
    await expect(field(sheet.view, id), id).toHaveCount(1);
  }
  await expectSunkTerrain(sheet, 1536);
  expect(sheet.errors).toStrictEqual([]);
});

test('紧凑竖版 720 × 1280：罗盘缩到 0.8，右栏去声场与 3 × 2', async ({ page }) => {
  const sheet = await openAt(page, 720, 1280);
  await expect(sheet.tier).toHaveAttribute('data-tier', 'portrait-compact');
  await expect(sheet.fields).toHaveAttribute('data-paper-fields', 'compact');
  expect(await widthOf(sheet.cover)).toBeCloseTo(240, 0);
  await expectMissing(sheet.view, ['correlation', 'sampleRate']);
  await expectSunkTerrain(sheet, 1280);
});

test('竖窄档 700 × 1000：环与转动层照紧凑竖版留着，下段只剩六块；版心比容器高，顶对齐', async ({
  page,
}) => {
  const sheet = await openAt(page, 700, 1000);
  await expect(sheet.tier).toHaveAttribute('data-tier', 'portrait-narrow');
  await expect(sheet.fields).toHaveAttribute('data-paper-fields', 'narrow');
  expect(await widthOf(sheet.cover)).toBeCloseTo(240, 0);
  await expect(sheet.rings).toHaveCount(3);
  await expect(sheet.orbit).toHaveCount(1);
  expect(await widthOf(sheet.fields)).toBeCloseTo(600, 0);
  await expectMissing(sheet.view, ['quality', 'genre', 'duration', 'sampleRate']);
  await expectFieldsBelowCover(sheet);
  expect((await sheet.sheet.boundingBox())?.y).toBe(0);
  await expectSunkTerrain(sheet, 1000);
  expect(sheet.errors).toStrictEqual([]);
});

test('竖窄档 800 × 1200：版心 1047 高在容器里垂直居中', async ({ page }) => {
  const sheet = await openAt(page, 800, 1200);
  await expect(sheet.tier).toHaveAttribute('data-tier', 'portrait-narrow');
  const box = await sheet.sheet.boundingBox();
  expect(box?.height).toBeCloseTo(1047, 0);
  expect(box?.y).toBeCloseTo((1200 - 1047) / 2, 0);
});

test('窗口来回跨档：舞台换成版心再换回来，字段跟着换，不报错', async ({ page }) => {
  const sheet = await openAt(page, 1100, 760);
  await expect(sheet.tier).toHaveAttribute('data-tier', 'compact');
  await expect(field(sheet.view, 'remaining')).toHaveCount(0);
  await expect(field(sheet.view, 'elapsed')).toHaveCount(1);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(sheet.tier).toHaveAttribute('data-tier', 'full');
  await expect(field(sheet.view, 'remaining')).toHaveCount(1);
  await expect(field(sheet.view, 'elapsed')).toHaveCount(0);
  await expect(field(sheet.view, 'title')).toHaveText(PLAYING_TRACK.title);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  expect(sheet.errors).toStrictEqual([]);
});
