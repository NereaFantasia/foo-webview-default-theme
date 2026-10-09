import { expect, test, type Page } from '@playwright/test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { sha256 } from '../../scripts/release/artifacts.mjs';
import { candidateOf, nextRootPayload, releaseManifest } from '../../scripts/release/manifests.mjs';
import { publicSpki, signEnvelope } from '../../scripts/release/signing.mjs';
import { zipEntries } from '../../scripts/release/zip.mjs';
import { installPageHost } from '../fixtures/pageHost.ts';
import { TEMPLATE_DIRECTORY, answerTemplateDisk } from '../fixtures/templateDisk.ts';
import { ROOT_URL } from '../../src/update/contract.ts';

const CHANGELOG = textLog();
function textLog() {
  return JSON.stringify({
    format: 1,
    entries: [
      {
        version: '0.2.0',
        date: '2026-10-04',
        notes: {
          en: {
            title: 'Updates, your way',
            summary: 'Choose how updates reach you.',
            items: [
              {
                icon: 'update',
                title: 'Update modes',
                text: 'Off, notify, or install automatically.',
              },
            ],
            fixes: Array.from({ length: 35 }, (_, index) => `Fixed item ${index + 1}`),
          },
        },
      },
      {
        version: '0.1.0',
        notes: {
          'zh-CN': { title: '首个版本', summary: '本机自带的更新内容。' },
          en: { title: 'First version', summary: 'Bundled release notes.' },
        },
      },
    ],
  });
}

// 打包前的更新器在真实 Chromium 里跑一轮：根清单由 Node 用发版脚本签名，前端包由发版脚本打包，
// 验签、解压、哈希与 base64 往返都在浏览器里做；宿主替身只负责网络应答和内存里的模板目录。

test.use({ screenshot: 'off' });

for (const colorScheme of ['light', 'dark'] as const)
  test(`本地服务失败显示诊断与重试，恢复后移除提醒（${colorScheme}）`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    const host = await installPageHost(page);
    host.config.set('defaultTheme.update.mode', 'off');
    host.config.set('defaultTheme.changelog.seen', '0.1.0');
    const disk = answerTemplateDisk(host, {
      'fe/0.1.0/installed.json': JSON.stringify({ files: { 'backend.json': 'a'.repeat(64) } }),
      'fe/0.1.0/backend.json': '{}',
    });
    await page.route('**/backend-ui-probe', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html lang="zh-CN"><title>本地服务</title></html>',
      }),
    );
    await page.goto('/backend-ui-probe');
    await page.evaluate(async (startup) => {
      const { mountChangelogPage }: typeof import('../fixtures/ChangelogPage.tsx') = await import(
        `${location.origin}/tests/fixtures/ChangelogPage.tsx`
      );
      mountChangelogPage([], startup);
    }, STARTUP);
    await page.locator('[data-settings-toggle]').click();
    await expect(page.getByText('本地服务未就绪', { exact: true }).first()).toBeVisible();
    await page.getByText('诊断详情', { exact: true }).click();
    await expect(page.getByText('后端描述校验失败', { exact: true })).toBeVisible();
    disk.write('fe/0.1.0/installed.json', JSON.stringify({ files: {} }));
    await page.getByRole('button', { name: '重试本地服务', exact: true }).click();
    await expect(page.getByText('本地服务未就绪', { exact: true })).toHaveCount(0);
  });

const CURRENT = { v: '0.1.0', dir: '0.1.0' };
const STARTUP = {
  directory: TEMPLATE_DIRECTORY,
  installId: '11111111-1111-4111-8111-111111111111',
  session: {
    schema: 1,
    sessionId: '22222222-2222-4222-8222-222222222222',
    version: CURRENT,
    loader: 1,
    skipped: [],
  },
  plugin: '2.0.0',
} as const;
const text = (value: string) => new TextEncoder().encode(value);

/** 一个近似真实大小的前端：入口、几十万字节的脚本与一份二进制资源。 */
function frontendFiles() {
  const script = Array.from({ length: 6000 }, (_, index) => `export const v${index} = ${index};`);
  const binary = new Uint8Array(70_000).map((_, index) => (index * 7919) % 256);
  return [
    { path: 'index.html', bytes: text('<!doctype html><title>主题 0.2.0</title>') },
    { path: 'loader.html', bytes: text('<!doctype html>') },
    { path: 'assets/App.js', bytes: text(script.join('\n')) },
    { path: 'assets/cover.bin', bytes: binary },
  ];
}

async function publish(options: { tamper?: 'size' | 'hash'; der?: boolean } = {}) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const files = frontendFiles();
  const zip = zipEntries(files);
  const release = releaseManifest({
    version: '0.2.0',
    upgradeFrom: '>=0.1.0',
    plugin: '2.0.0',
    loader: 1,
    notes: { 'zh-CN': '浏览器验证' },
    zip: { size: zip.length, sha256: sha256(zip) },
  });
  const releaseBytes = text(JSON.stringify(release));
  const changelog = text(CHANGELOG);
  const changelogUrl = release.components.frontend.url.replace(
    /fe-0\.2\.0\.zip$/,
    'changelog.json',
  );
  const payload = nextRootPayload(null, candidateOf(release, sha256(releaseBytes)), {
    url: changelogUrl,
    size: changelog.length,
    sha256: sha256(changelog),
  });
  const manifest = options.der
    ? JSON.stringify({
        payload,
        signatures: [
          { keyId: 'k1', sig: sign('sha256', Buffer.from(payload), privateKey).toString('base64') },
        ],
      })
    : await signEnvelope(payload, [{ keyId: 'k1', privateKeyPem: pem }]);
  const served = options.tamper === 'size' ? zipEntries(files.slice(0, 3)) : zip.slice();
  if (options.tamper === 'hash') served[0] = (served[0] ?? 0) ^ 1;
  const routes = new Map<string, Uint8Array>([
    [ROOT_URL, text(manifest)],
    [release.components.frontend.url.replace(/fe-0\.2\.0\.zip$/, 'release.json'), releaseBytes],
    [release.components.frontend.url, served],
    [changelogUrl, changelog],
  ]);
  return { files, routes, keys: [{ keyId: 'k1', spki: publicSpki(pem) }] };
}

async function run(
  page: Page,
  published: Awaited<ReturnType<typeof publish>>,
  action: 'check' | 'install' | 'view' = 'install',
  seen = '0.1.0',
  locale?: { host: string; selected: string },
) {
  page.on('pageerror', (error) => console.error(error.message));
  const host = await installPageHost(page);
  host.config.set('defaultTheme.update.mode', action === 'check' ? 'notify' : 'off');
  host.config.set('defaultTheme.changelog.seen', seen);
  if (locale) {
    host.config.set('defaultTheme.locale', locale.selected);
    host.answer('system.getLocale', () => ({
      success: true,
      locale: locale.host,
      language: '',
      country: '',
    }));
  }
  const disk = answerTemplateDisk(host, {
    'current.json': JSON.stringify({ schema: 1, frontend: { version: CURRENT } }),
    'fe/0.1.0/installed.json': JSON.stringify({
      schema: 1,
      version: '0.1.0',
      files: { 'index.html': 'f'.repeat(64) },
    }),
    'fe/0.1.0/changelog.json': CHANGELOG,
  });
  host.answer('http.get', (params) => {
    const body = published.routes.get(String(params['url']));
    return body
      ? {
          success: true,
          status: 200,
          headers: {},
          body: Buffer.from(body).toString('base64'),
          responseType: 'base64',
        }
      : { success: true, status: 404, headers: {}, body: '', responseType: 'base64' };
  });
  await page.route('**/updater-probe', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="zh-CN"><title>更新器验证</title></html>',
    }),
  );
  await page.goto('/updater-probe');
  const status = await page.evaluate(
    async ({ keys, startup, action }) => {
      if (action === 'view') {
        const { mountChangelogPage }: typeof import('../fixtures/ChangelogPage.tsx') = await import(
          `${location.origin}/tests/fixtures/ChangelogPage.tsx`
        );
        mountChangelogPage(keys, startup);
        return null;
      }
      const { runUpdaterProbe }: typeof import('../fixtures/updaterProbe.ts') = await import(
        `${location.origin}/tests/fixtures/updaterProbe.ts`
      );
      return runUpdaterProbe(keys, startup, action);
    },
    { keys: published.keys, startup: STARTUP, action },
  );
  if (action === 'view' && seen === CURRENT.v) await page.locator('[data-settings-toggle]').click();
  return { status, disk, host };
}

test('签名、解压与哈希在浏览器里通过，新版本装进新目录并写成 pending', async ({ page }) => {
  const published = await publish();
  const { status, disk } = await run(page, published);
  expect(status).toMatchObject({
    phase: 'ready',
    version: '0.2.0',
    notes: { 'zh-CN': '浏览器验证' },
  });
  const pointer = JSON.parse(disk.text('current.json') ?? '{}');
  expect(pointer.frontend.version).toEqual(CURRENT);
  const dir = pointer.frontend.pending.dir;
  expect(dir).toMatch(/^0\.2\.0_[a-z0-9]{6}$/);
  for (const file of published.files)
    expect(
      createHash('sha256')
        .update(disk.files.get(`fe/${dir}/${file.path}`) ?? '')
        .digest('hex'),
    ).toBe(sha256(file.bytes));
  const marker = JSON.parse(disk.text(`fe/${dir}/installed.json`) ?? '{}');
  expect(Object.keys(marker.files)).toHaveLength(published.files.length);
  expect(disk.atomic.get(`fe/${dir}/installed.json`)).toBe(true);
  expect(JSON.parse(disk.text('state/update-state.json') ?? '{}').trust.roots['1'].serial).toBe(1);
});

for (const tamper of ['size', 'hash'] as const)
  test(`前端包${tamper === 'size' ? '大小不符' : '同长度篡改'}时不写安装标记与指针`, async ({
    page,
  }) => {
    const { status, disk } = await run(page, await publish({ tamper }));
    expect(status).toMatchObject({ phase: 'idle', failure: tamper });
    expect(JSON.parse(disk.text('current.json') ?? '{}').frontend.pending).toBeUndefined();
    expect([...disk.files.keys()].filter((path) => path.startsWith('fe/0.2.0'))).toEqual([]);
  });

test('Node 默认的 DER 格式签名在浏览器里验不过', async ({ page }) => {
  const { status, host } = await run(page, await publish({ der: true }));
  expect(status).toMatchObject({ phase: 'idle', failure: 'unverified' });
  expect(host.callsTo('http.get').map((params) => params['url'])).toEqual([ROOT_URL]);
});

test('仅通知检查不安装，主动下载后才提交 pending', async ({ page }) => {
  const published = await publish();
  const { status, disk, host } = await run(page, published, 'check');
  expect(status).toMatchObject({ phase: 'available', version: '0.2.0' });
  expect(JSON.parse(disk.text('current.json') ?? '{}').frontend.pending).toBeUndefined();
  expect(
    host
      .callsTo('http.get')
      .map((params) => params['url'])
      .some((url) => String(url).endsWith('.zip')),
  ).toBe(false);
  const installed = await page.evaluate(
    async ({ keys, startup }) => {
      const { runUpdaterProbe }: typeof import('../fixtures/updaterProbe.ts') = await import(
        `${location.origin}/tests/fixtures/updaterProbe.ts`
      );
      return runUpdaterProbe(keys, startup, 'install');
    },
    { keys: published.keys, startup: STARTUP },
  );
  expect(installed).toMatchObject({ phase: 'ready', version: '0.2.0' });
  expect(JSON.parse(disk.text('current.json') ?? '{}').frontend.pending.v).toBe('0.2.0');
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`${colorScheme} 更新内容可切换、滚动、安装，尺寸固定且关闭档不进信息中心`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const { host, disk } = await run(page, await publish(), 'view');
    await page.getByRole('button', { name: '查看', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Updates, your way' })).toBeVisible();
    await expect(dialog.getByText('以 en 显示')).toBeVisible();
    await expect(page.locator('[data-info-kind="updateAvailable"]')).toHaveCount(0);
    const before = await dialog.boundingBox();
    expect(before?.width).toBe(560);
    expect(before?.height).toBe(600);
    const panel = dialog.getByRole('tabpanel');
    const contentBefore = await panel.boundingBox();
    await panel.evaluate((element) => {
      element.scrollTop = 200;
    });
    await dialog.getByRole('tab', { name: '0.1.0', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: '首个版本' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '下载并安装' })).toHaveCount(0);
    expect(await panel.evaluate((element) => element.scrollTop)).toBe(0);
    const after = await dialog.boundingBox();
    expect(after?.width).toBe(before?.width);
    expect(after?.height).toBe(before?.height);
    expect((await panel.boundingBox())?.height).toBe(contentBefore?.height);
    await dialog.getByRole('tab', { name: /0.2.0/ }).click();
    await dialog.getByRole('button', { name: '下载并安装' }).click();
    await expect(dialog.getByRole('button', { name: '立即重启' })).toBeVisible();
    expect(JSON.parse(disk.text('current.json') ?? '{}').frontend.pending.v).toBe('0.2.0');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    expect(host.config.get('defaultTheme.update.mode')).toBe('off');
  });
}

test('窄窗口下离线仍能看本机日志，不显示安装按钮或版本徽标', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const published = await publish();
  published.routes.delete(ROOT_URL);
  await run(page, published, 'view');
  await page.getByRole('button', { name: '查看', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '首个版本' })).toBeVisible();
  await expect(dialog.getByText('未能刷新更新内容')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '下载并安装' })).toHaveCount(0);
  await expect(dialog.getByText('当前版本', { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await dialog.boundingBox())?.width).toBeLessThanOrEqual(328);
  await expect.poll(async () => (await dialog.boundingBox())?.height).toBeLessThanOrEqual(592);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(dialog).not.toBeVisible();
});

test('升级首次展示只用本机日志，关闭后重开页面不再自动弹出', async ({ page }) => {
  const { host } = await run(page, await publish(), 'view', '0.0.9');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '首个版本' })).toBeVisible();
  await expect.poll(() => host.config.get('defaultTheme.changelog.seen')).toBe('0.1.0');
  expect(host.callsTo('http.get')).toEqual([]);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await page.reload();
  await page.evaluate(
    async ({ keys, startup }) => {
      const { mountChangelogPage }: typeof import('../fixtures/ChangelogPage.tsx') = await import(
        `${location.origin}/tests/fixtures/ChangelogPage.tsx`
      );
      mountChangelogPage(keys, startup);
    },
    { keys: [], startup: STARTUP },
  );
  await page.locator('[data-settings-toggle]').click();
  await expect(page.getByRole('button', { name: '查看', exact: true })).toBeVisible();
  await expect(dialog).not.toBeVisible();
  expect(host.callsTo('http.get')).toEqual([]);
});

test('提醒档的信息中心展示日志标题，查看后关闭信息中心并打开日志', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { host } = await run(page, await publish(), 'view');
  await page.getByRole('combobox', { name: '更新方式' }).click();
  await page.getByRole('option', { name: /仅提醒/ }).click();
  await expect.poll(() => host.config.get('defaultTheme.update.mode')).toBe('notify');
  await page.getByRole('button', { name: '检查更新 主题更新', exact: true }).click();
  await page.locator('[data-info-center-trigger]').click();
  const notice = page.locator('[data-info-kind="updateAvailable"]');
  await expect(notice).toContainText('Updates, your way');
  await expect(notice.getByRole('button', { name: '下载并安装' })).toBeVisible();
  await notice.getByRole('button', { name: '查看更新内容' }).click();
  await expect(page.locator('[data-info-center]')).not.toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Updates, your way' }),
  ).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '关闭' }).click();
  await page.getByRole('combobox', { name: '更新方式' }).click();
  await page.getByRole('option', { name: /^手动检查/ }).click();
  await expect.poll(() => host.config.get('defaultTheme.update.mode')).toBe('off');
  await expect(page.locator('[data-info-center-trigger]')).not.toBeVisible();
});

for (const locale of [
  { host: 'en-US', selected: 'zh-CN', view: '查看', title: '首个版本' },
  { host: 'zh-CN', selected: 'en', view: 'View', title: 'First version' },
]) {
  test(`宿主为 ${locale.host} 时日志跟随手动选择的 ${locale.selected}`, async ({ page }) => {
    await run(page, await publish(), 'view', '0.1.0', locale);
    await page.getByRole('button', { name: locale.view, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: '0.1.0', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: locale.title, exact: true })).toBeVisible();
    await expect(dialog.getByRole('tabpanel')).toHaveAttribute('lang', locale.selected);
  });
}
