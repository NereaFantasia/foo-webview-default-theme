import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';
import { createHash } from 'node:crypto';
import {
  builtLoaderFiles,
  minimalFrontend,
  serveLoader,
  LOADER_CURRENT as CURRENT,
  LOADER_NEXT as NEXT,
  LOADER_OLD as OLD,
} from '../fixtures/loaderPage.ts';
import {
  ATTEMPTS_KEY,
  cookieName,
  readAttempts,
  readSession,
  json,
} from '../../src/boot/loader.ts';

test.use({ screenshot: 'off' });
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
test.beforeAll(async () => {
  await build({ configFile: 'vite.boot.config.ts', logLevel: 'error' });
  await build({ configFile: 'vite.config.ts', logLevel: 'error' });
});

async function counts(page: Page) {
  return readAttempts(json(await page.evaluate((key) => localStorage.getItem(key), ATTEMPTS_KEY)));
}
async function session(page: Page, id: string) {
  const cookies = await page.context().cookies();
  const value = cookies.find((entry) => entry.name === cookieName(id))?.value;
  return readSession(json(value === undefined ? null : decodeURIComponent(value)));
}
function pointer(files: Map<string, string>, frontend: Record<string, unknown>) {
  files.set('current.json', JSON.stringify({ schema: 1, frontend }));
}

test('产物是内联引导页与版本目录，安装标记的每个哈希均对应真实文件', async () => {
  const files = builtLoaderFiles();
  const html = files.get('index.html') ?? '';
  expect(html).toContain('<script>');
  expect(html).not.toMatch(/<script[^>]+src=/);
  expect(html).not.toContain('foo-webview-sdk');
  const raw: unknown = JSON.parse(files.get(`fe/${CURRENT.dir}/installed.json`) ?? 'null');
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('files' in raw) ||
    typeof raw.files !== 'object' ||
    raw.files === null
  )
    throw new Error('缺少安装标记');
  for (const [path, hash] of Object.entries(raw.files)) {
    const body = files.get(`fe/${CURRENT.dir}/${path}`);
    expect(body, path).toBeDefined();
    expect(
      createHash('sha256')
        .update(body ?? '')
        .digest('hex'),
      path,
    ).toBe(hash);
  }
  expect(files.get(`fe/${CURRENT.dir}/loader.html`)).toBe(html);
});

test('跳转保留查询与 hash，同会话不重复计数、不采用后来新增的 pending', async ({
  page,
  context,
}) => {
  const files = builtLoaderFiles();
  minimalFrontend(files);
  minimalFrontend(files, NEXT);
  await serveLoader(page, files);
  await page.goto('/index.html?windowId=popup-1&route=queue%2Fnext#part-2');
  await expect(page.getByRole('heading', { name: 'Frontend 0.1.0' })).toBeVisible();
  expect(new URL(page.url()).search).toBe('?windowId=popup-1&route=queue%2Fnext');
  expect(new URL(page.url()).hash).toBe('#part-2');
  expect((await counts(page)).installations['']?.[CURRENT.dir]).toBe(1);
  const first = await session(page, '');
  pointer(files, { version: CURRENT, pending: NEXT });
  const popup = await context.newPage();
  await serveLoader(popup, files);
  await popup.goto('/');
  await expect(popup.getByRole('heading', { name: 'Frontend 0.1.0' })).toBeVisible();
  expect((await session(popup, ''))?.sessionId).toBe(first?.sessionId);
  expect((await counts(popup)).installations['']?.[CURRENT.dir]).toBe(1);
});

test('current 损坏改用 last-good；会话目录缺标记时重新选版', async ({ page }) => {
  const files = builtLoaderFiles();
  minimalFrontend(files);
  minimalFrontend(files, NEXT);
  files.set('last-good.json', files.get('current.json') ?? '');
  files.set('current.json', 'broken');
  await serveLoader(page, files);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Frontend 0.1.0' })).toBeVisible();
  files.delete(`fe/${CURRENT.dir}/installed.json`);
  pointer(files, { version: CURRENT, pending: NEXT });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Frontend 0.2.0' })).toBeVisible();
});

test('全部候选失败时说明尝试次数，重置只清本安装并重新选择', async ({ page }) => {
  const files = builtLoaderFiles();
  minimalFrontend(files);
  minimalFrontend(files, NEXT);
  minimalFrontend(files, OLD);
  files.set('install-id', ID);
  pointer(files, { pending: NEXT, version: CURRENT, previous: OLD });
  await serveLoader(page, files);
  await page.addInitScript(
    ({ key, id, other }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            schema: 1,
            installations: {
              [id]: { '0.1.0': 3, '0.2.0_abc123': 3, '0.0.9_xyz789': 3 },
              [other]: { '0.1.0': 2 },
            },
          }),
        );
    },
    { key: ATTEMPTS_KEY, id: ID, other: OTHER },
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '无法启动主题' })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: '重置启动计数并重试' }).click();
  await expect(page.getByRole('heading', { name: 'Frontend 0.2.0' })).toBeVisible();
  const saved = await counts(page);
  expect(saved.installations[ID]).toEqual({ [NEXT.dir]: 1 });
  expect(saved.installations[OTHER]).toEqual({ [CURRENT.dir]: 2 });
});

test('打包后的真实应用提交根组件后确认，首次标识发布后弹窗仍沿用同一会话', async ({
  page,
  context,
}) => {
  const files = builtLoaderFiles();
  const main = await serveLoader(page, files);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '专辑' })).toBeVisible();
  await expect.poll(() => files.has('last-good.json')).toBe(true);
  const id = files.get('install-id') ?? '';
  expect(id).not.toBe('');
  const first = await session(page, id);
  expect(first?.version).toEqual(CURRENT);
  expect((await counts(page)).installations[id]?.[CURRENT.dir]).toBe(0);
  minimalFrontend(files, NEXT);
  pointer(files, { version: CURRENT, pending: NEXT });
  const popup = await context.newPage();
  const other = await serveLoader(popup, files, { windowId: 'popup-1' });
  await popup.goto('/?windowId=popup-1&route=queue');
  await expect(popup.getByRole('heading', { level: 1, name: '专辑' })).toBeVisible();
  expect((await session(popup, id))?.sessionId).toBe(first?.sessionId);
  expect(other.writes).toEqual([]);
  expect(main.writes).toContain('last-good.json');
});

test('回退确认先记录坏版本，再改指针；写入失败能从信息中心重试', async ({ page }) => {
  const files = builtLoaderFiles();
  minimalFrontend(files, NEXT);
  pointer(files, { version: NEXT, previous: CURRENT });
  await page.addInitScript(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({ schema: 1, installations: { '': { '0.2.0_abc123': 3 } } }),
      ),
    ATTEMPTS_KEY,
  );
  const app = await serveLoader(page, files);
  app.failWrite.path = 'state/failed-releases.json';
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '专辑' })).toBeVisible();
  await page.locator('[data-info-center-trigger]').click();
  await expect(page.locator('[data-info-kind="startupUnconfirmed"]')).toBeVisible();
  expect(JSON.parse(files.get('current.json') ?? '{}').frontend.version).toEqual(NEXT);
  app.failWrite.path = null;
  await page.getByRole('button', { name: '重新确认' }).click();
  await expect.poll(() => files.has('last-good.json')).toBe(true);
  expect(JSON.parse(files.get('current.json') ?? '{}').frontend).toEqual({ version: CURRENT });
  expect(app.writes.indexOf('state/failed-releases.json')).toBeLessThan(
    app.writes.indexOf('current.json'),
  );
  await expect(page.locator('[data-info-kind="startupUnconfirmed"]')).toHaveCount(0);
});

test('面板说明提交后清零计数，绝不写标识或指针', async ({ page }) => {
  const files = builtLoaderFiles();
  const app = await serveLoader(page, files, { mode: 'dui', windowId: 'panel-1' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '本主题只支持独立窗口模式' })).toBeVisible();
  await expect.poll(async () => (await counts(page)).installations['']?.[CURRENT.dir]).toBe(0);
  expect(files.has('install-id')).toBe(false);
  expect(files.has('last-good.json')).toBe(false);
  expect(app.writes).toEqual([]);
});

test('两个窗口同时首次进入只选择一次，复用同一启动标识', async ({ page, context }) => {
  const files = builtLoaderFiles();
  minimalFrontend(files);
  const other = await context.newPage();
  await serveLoader(page, files);
  await serveLoader(other, files);
  await Promise.all([page.goto('/'), other.goto('/?windowId=popup-1')]);
  await expect(page.getByRole('heading', { name: 'Frontend 0.1.0' })).toBeVisible();
  await expect(other.getByRole('heading', { name: 'Frontend 0.1.0' })).toBeVisible();
  expect((await session(page, ''))?.sessionId).toBe((await session(other, ''))?.sessionId);
  expect((await counts(page)).installations['']?.[CURRENT.dir]).toBe(1);
});

test('已有 cookie 的扩展字段经过引导页与首次身份发布仍保留', async ({ page }) => {
  const files = builtLoaderFiles();
  await page.addInitScript(
    ({ name, value }) => {
      document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Strict`;
    },
    {
      name: cookieName(''),
      value: JSON.stringify({
        schema: 1,
        sessionId: OTHER,
        version: { ...CURRENT, futureVersion: { keep: true } },
        loader: 2,
        skipped: [],
        futureSession: 'keep',
      }),
    },
  );
  await serveLoader(page, files);
  await page.goto('/');
  await expect.poll(() => files.has('last-good.json')).toBe(true);
  const saved = await session(page, files.get('install-id') ?? '');
  expect(saved?.futureSession).toBe('keep');
  expect(saved?.version.futureVersion).toEqual({ keep: true });
  expect(saved?.loader).toBe(2);
});

test('根提交后不等 requestAnimationFrame 即可确认', async ({ page }) => {
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => 0;
  });
  const files = builtLoaderFiles();
  await serveLoader(page, files);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '专辑', level: 1 })).toBeAttached();
  await expect.poll(() => files.has('last-good.json')).toBe(true);
});

test('根组件渲染失败不会被记成健康版本', async ({ page }) => {
  const files = builtLoaderFiles();
  const chunk = [...files.keys()].find((path) => /\/assets\/App-[\w-]+\.js$/.test(path));
  if (!chunk) throw new Error('缺少应用入口');
  const original = files.get(chunk) ?? '';
  const changed = original.replace(
    /[$A-Za-z_][$A-Za-z_0-9]* as App(?=[,}])/,
    '__brokenRoot as App',
  );
  expect(changed).not.toBe(original);
  files.set(
    chunk,
    `${changed}\nfunction __brokenRoot(){throw new Error('app-root-render-failure');}`,
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const app = await serveLoader(page, files);
  await page.goto('/');
  await expect.poll(() => errors).toContain('app-root-render-failure');
  await expect(page.locator('#root')).toBeEmpty();
  // 留出宿主替身应答的事件轮次，确认没有随后到达的错误确认写入。
  await page.waitForTimeout(100);
  expect((await counts(page)).installations['']?.[CURRENT.dir]).toBe(1);
  expect(app.writes).toEqual([]);
  expect(files.has('install-id')).toBe(false);
});

for (const unavailable of ['cookie', 'storage'] as const) {
  test(`无法保存 ${unavailable} 时停在说明页，不跳进应用`, async ({ page }) => {
    await page.addInitScript((kind) => {
      if (kind === 'cookie')
        Object.defineProperty(document, 'cookie', { get: () => '', set: () => {} });
      else
        Object.defineProperty(window, 'localStorage', {
          get: () => {
            throw new Error('storage denied');
          },
        });
    }, unavailable);
    const files = builtLoaderFiles();
    const app = await serveLoader(page, files);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '无法读取或保存启动状态' })).toBeVisible();
    await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeVisible();
    expect(app.host.calls).toEqual([]);
    expect(new URL(page.url()).pathname).toBe('/');
  });
}
