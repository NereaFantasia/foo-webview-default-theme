import { expect, test, type Page } from '@playwright/test';
import { libraryAnswers, SAMPLE_ALBUMS } from '../fixtures/albumLibrary.ts';
import { listParam } from '../fixtures/hostAnswers.ts';
import { collectPageErrors, installPageHost } from '../fixtures/pageHost.ts';

// 拖动封面：页面里的落点收到专辑键；宿主支持拖出时，按下那一刻换好的凭证写进 text/plain。
// 侧边栏的播放列表落点还没有，这里在页面上临时放一个落点，记下它收到了什么。

const tile = (page: Page, name: string) =>
  page.locator('[data-album-tile]').filter({ hasText: name });

async function addDropZone(page: Page): Promise<void> {
  await page.evaluate(() => {
    const zone = document.createElement('div');
    zone.id = 'drop-zone';
    Object.assign(zone.style, {
      position: 'fixed',
      left: '0',
      bottom: '0',
      width: '200px',
      height: '120px',
      zIndex: '10000',
    });
    zone.addEventListener('dragover', (event) => event.preventDefault());
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      const data = event.dataTransfer;
      zone.dataset['albums'] = data?.getData('application/x-album-keys') ?? '';
      zone.dataset['text'] = data?.getData('text/plain') ?? '';
    });
    document.body.append(zone);
  });
}

test('拖多选里的一张：页面里的落点收到整个选择的专辑键；换好的凭证交给宿主', async ({ page }) => {
  const errors = collectPageErrors(page);
  const host = await installPageHost(page, {
    answers: {
      ...libraryAnswers(SAMPLE_ALBUMS),
      dnd: {
        getCapabilities: {
          success: true,
          html5: true,
          paths: true,
          hosting: 'visual',
          dragOut: true,
        },
        prepareDrag: (params) => ({
          success: true,
          token: `token${listParam(params, 'paths').length}`,
        }),
      },
    },
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(tile(page, 'Abbey Road')).toBeVisible();
  await tile(page, 'Abbey Road').click();
  await tile(page, 'Revolver').click({ modifiers: ['Control'] });
  await addDropZone(page);

  // 单击 Abbey Road 那一下为它换的一串随即被这次单击作废，请求发没发到宿主看时机；带 Ctrl 的那一下
  // 不换。所以只认两张一起的那一次（四首，凭证叫 token4）。按下之后等它到手再拖：真的鼠标手势里，
  // 这段时间是指针移过拖动阈值之前的那一下。
  const batch = () =>
    host.callsTo('dnd.prepareDrag').filter((call) => listParam(call, 'paths').length === 4);
  await tile(page, 'Revolver').hover();
  await page.mouse.down();
  await expect.poll(() => batch().length).toBe(1);
  // 替身记下请求时应答也已发出；再跟页面来回一趟，那份应答与其后的微任务就都在页面里跑完了，
  // 凭证在拖起之前到手。
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  await page.locator('#drop-zone').hover();
  await page.mouse.up();

  const zone = page.locator('#drop-zone');
  await expect(zone).toHaveAttribute('data-albums', /Abbey Road/);
  const keys: unknown = JSON.parse((await zone.getAttribute('data-albums')) ?? 'null');
  expect(keys).toEqual(['Abbey Road\0The Beatles', 'Revolver\0The Beatles']);
  expect(await zone.getAttribute('data-text')).toContain('token4');
  expect(errors).toEqual([]);
});
