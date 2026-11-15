import { expect, test, type Locator, type Page } from '@playwright/test';
import { openImmersive } from '../fixtures/immersivePage.ts';
import { PLAYING_TRACK } from '../fixtures/playerPage.ts';

// 图纸的收缩档与竖版：在 1280 × 800 下进页，再改视口，`data-tier` 跟着换，版心里各块按档位去留。尺寸与排布不在这里断言

const field = (view: Locator, id: string): Locator => view.locator(`[data-field="${id}"]`);

interface Sheet {
  readonly view: Locator;
  readonly errors: string[];
  readonly tier: Locator;
  readonly fields: Locator;
  readonly rings: Locator;
  readonly orbit: Locator;
  readonly transport: Locator;
}

/** 进页、等进场过渡播完，再改到 `width` × `height` */
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
    fields: view.locator('[data-paper-fields]'),
    rings: view.locator('[data-dial-ring]'),
    orbit: view.locator('canvas[data-orbit]'),
    transport: view.getByRole('group', { name: '播放控制' }),
  };
}

async function expectMissing(view: Locator, ids: readonly string[]): Promise<void> {
  for (const id of ids) await expect(field(view, id), id).toHaveCount(0);
}

// 每档的去留：视口 → 档位、右栏模式、环与转动层、缺的字段与在的字段
const TIERS = [
  {
    name: 'compact',
    size: [1200, 720],
    tier: 'compact',
    fields: 'compact',
    rings: 3,
    orbit: 1,
    missing: ['correlation', 'sampleRate', 'remaining'],
    present: ['quality', 'duration', 'elapsed', 'genre', 'year', 'label'],
  },
  {
    name: '竖版',
    size: [864, 1536],
    tier: 'portrait',
    fields: 'full',
    missing: [],
    present: ['correlation', 'sampleRate', 'genre', 'elapsed'],
  },
  {
    name: '紧凑竖版',
    size: [720, 1280],
    tier: 'portrait-compact',
    fields: 'compact',
    missing: ['correlation', 'sampleRate'],
    present: [],
  },
  {
    name: '竖窄档',
    size: [700, 1000],
    tier: 'portrait-narrow',
    fields: 'narrow',
    rings: 3,
    orbit: 1,
    missing: ['quality', 'genre', 'duration', 'sampleRate'],
    present: [],
  },
] as const;

for (const spec of TIERS) {
  test(`${spec.name} ${spec.size.join(' × ')}：落 ${spec.tier} 档，右栏 ${spec.fields} 模式，字段按档去留`, async ({
    page,
  }) => {
    const sheet = await openAt(page, spec.size[0], spec.size[1]);
    await expect(sheet.tier).toHaveAttribute('data-tier', spec.tier);
    await expect(sheet.fields).toHaveAttribute('data-paper-fields', spec.fields);
    if ('rings' in spec) {
      await expect(sheet.rings).toHaveCount(spec.rings);
      await expect(sheet.orbit).toHaveCount(spec.orbit);
    }
    await expectMissing(sheet.view, spec.missing);
    for (const id of spec.present) await expect(field(sheet.view, id), id).toBeVisible();
    expect(sheet.errors).toStrictEqual([]);
  });
}

test('1366 × 720 够得上舞台的缩放下限，落 full 档', async ({ page }) => {
  const sheet = await openAt(page, 1366, 720);
  await expect(sheet.tier).toHaveAttribute('data-tier', 'full');
  await expect(sheet.fields).toHaveCount(0);
  await expect(field(sheet.view, 'remaining')).toHaveCount(1);
  expect(sheet.errors).toStrictEqual([]);
});

test('narrow 390 × 700：单栏，没有环与转动层，只留标题与专辑，传输键不越出视口', async ({
  page,
}) => {
  const sheet = await openAt(page, 390, 700);
  await expect(sheet.tier).toHaveAttribute('data-tier', 'narrow');
  await expect(sheet.fields).toHaveAttribute('data-paper-fields', 'narrow');
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
  expect(sheet.errors).toStrictEqual([]);
});
