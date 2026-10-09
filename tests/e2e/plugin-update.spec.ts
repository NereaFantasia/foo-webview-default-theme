import { expect, test, type Page } from '@playwright/test';
import { generateKeyPairSync } from 'node:crypto';
import { sha256 } from '../../scripts/release/artifacts.mjs';
import { publicSpki, signEnvelope } from '../../scripts/release/signing.mjs';
import { ROOT_URL } from '../../src/update/contract.ts';
import type { PluginTransactionStatus } from '../../src/server/pluginProtocol.ts';
import { installPageHost } from '../fixtures/pageHost.ts';
import { answerTemplateDisk, TEMPLATE_DIRECTORY } from '../fixtures/templateDisk.ts';

test.use({ screenshot: 'off' });
const CURRENT = { v: '0.2.0', dir: '0.2.0' };
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
const TEXT = new TextEncoder();

async function mount(page: Page, scenario: 'install' | 'stale' | 'rollback' = 'install') {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const signer = { keyId: 'plugin', privateKeyPem };
  const base = 'https://example.com/plugin/';
  const files = ['foo_ui_webview2.dll', 'WebView2Loader.dll'].map((path, index) => ({
    path,
    bytes: new Uint8Array(128).fill(index + 1),
  }));
  const release = TEXT.encode(
    await signEnvelope(
      JSON.stringify({
        format: 1,
        component: 'foo_ui_webview2',
        version: '2.1.0',
        arch: 'x64',
        updater: 1,
        profileCompatible: true,
        hosts: ['2.25.8.0'],
        previous: ['2.0.0'],
        themes: ['0.2.0'],
        files: files.map((file) => ({
          path: file.path,
          size: file.bytes.length,
          sha256: sha256(file.bytes),
        })),
      }),
      [signer],
    ),
  );
  const manifest = await signEnvelope(
    JSON.stringify({
      format: 1,
      serial: 1,
      minUpdater: 1,
      channels: { stable: [] },
      plugins: [
        {
          version: '2.1.0',
          arch: 'x64',
          url: base + 'plugin.json',
          size: release.length,
          sha256: sha256(release),
        },
      ],
    }),
    [signer],
  );
  const routes = new Map<string, Uint8Array>([
    [ROOT_URL, TEXT.encode(manifest)],
    [base + 'plugin.json', release],
  ]);
  for (const file of files) routes.set(base + file.path, file.bytes);
  const host = await installPageHost(page);
  host.config.set('defaultTheme.update.mode', 'auto');
  host.config.set('defaultTheme.locale', 'zh-CN');
  const disk = answerTemplateDisk(host, {
    'current.json': JSON.stringify({ schema: 1, frontend: { version: CURRENT } }),
    'fe/0.2.0/installed.json': JSON.stringify({
      schema: 1,
      version: '0.2.0',
      files: { 'index.html': 'f'.repeat(64) },
      releaseSha256: 'd'.repeat(64),
    }),
  });
  host.answer('http.get', (params) => {
    const bytes = routes.get(String(params['url']));
    return {
      success: true,
      status: bytes ? 200 : 404,
      headers: {},
      responseType: 'base64',
      body: bytes ? Buffer.from(bytes).toString('base64') : '',
    };
  });
  host.answer('config.getVersionInfo', () => ({
    success: true,
    version: 'foobar2000 v2.25.8',
    foobar2000: 'foobar2000 v2.25.8',
    versionFull: 'foobar2000 v2.25.8 x64',
    is64bit: true,
    isPortable: true,
    profilePath: 'E:\\player\\profile',
    plugin: { name: 'foo_ui_webview2', version: '2.0.0' },
  }));
  host.answer('misc.getFoobarPath', () => ({
    success: true,
    path: 'E:\\player',
    value: 'E:\\player',
  }));
  host.answer('misc.getProfilePath', () => ({
    success: true,
    path: 'E:\\player\\profile',
    value: 'E:\\player\\profile',
  }));
  host.answer('misc.getComponentPath', () => ({
    success: true,
    path: 'E:\\player\\components\\plugin',
    value: 'E:\\player\\components\\plugin',
  }));
  host.answer('misc.exit', () => ({ success: true }));
  host.answer('shell.showInExplorer', () => ({ success: true }));
  const prepared: PluginTransactionStatus = {
    id: '33333333-3333-4333-8333-333333333333',
    nonce: 'a'.repeat(64),
    sha256: 'b'.repeat(64),
    directory: 'E:\\player\\components\\.wvupd\\33333333-3333-4333-8333-333333333333',
    version: '2.1.0',
    phase: 'prepared',
    releaseSha256: sha256(release),
    error: null,
    running: false,
    attempt: null,
  };
  await page.route('**/plugin-update-probe', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="zh-CN"><title>插件更新</title></html>',
    }),
  );
  await page.goto('/plugin-update-probe');
  await page.evaluate(
    async ({ keys, prepared, scenario, startup }) => {
      const { mountPluginUpdatePage }: typeof import('../fixtures/PluginUpdatePage.tsx') =
        await import(`${location.origin}/tests/fixtures/PluginUpdatePage.tsx`);
      mountPluginUpdatePage(keys, startup, prepared, scenario);
    },
    {
      keys: [{ keyId: signer.keyId, spki: publicSpki(privateKeyPem) }],
      prepared,
      scenario,
      startup: STARTUP,
    },
  );
  return { host, disk, prepared };
}

for (const colorScheme of ['light', 'dark'] as const)
  for (const width of [1280, 390])
    test(`${colorScheme} ${width}：确认范围与退出风险，取消不下载，批准后才退出`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      const env = await mount(page);
      const install = page.getByRole('button', { name: /重启安装/ });
      await expect(install).toBeVisible();
      expect(env.host.callsTo('misc.exit')).toEqual([]);
      expect([...env.disk.files.keys()].filter((path) => path.endsWith('.dll'))).toEqual([]);
      await install.click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toContainText('不替换 foobar2000 本体');
      await expect(dialog).toContainText('丢失尚未保存的设置');
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      expect(env.host.callsTo('misc.exit')).toEqual([]);
      await install.click();
      await dialog.getByRole('button', { name: '重启安装', exact: true }).click();
      await expect.poll(() => env.host.callsTo('misc.exit').length).toBe(1);
      expect([...env.disk.files.keys()].filter((path) => path.endsWith('.dll'))).toHaveLength(2);
      expect(JSON.parse(env.disk.text('current.json') ?? '{}').frontend).toEqual({
        version: CURRENT,
      });
    });

test('过期 ready 拒绝退出并发出取消请求', async ({ page }) => {
  const env = await mount(page, 'stale');
  await page.getByRole('button', { name: /重启安装/ }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '重启安装', exact: true })
    .click();
  await expect(
    page
      .locator('[data-settings-row] [aria-hidden="true"]')
      .filter({ hasText: '未能完成插件更新' }),
  ).toBeVisible();
  expect(env.host.callsTo('misc.exit')).toEqual([]);
  const requests = await page.evaluate(async () => {
    const { pluginRequests }: typeof import('../fixtures/PluginUpdatePage.tsx') = await import(
      `${location.origin}/tests/fixtures/PluginUpdatePage.tsx`
    );
    return pluginRequests();
  });
  expect(requests).toContain('/plugin/cancel');
  expect(requests).not.toContain('/plugin/authorize');
});

test('回滚结果显示恢复入口，只定位文件，不再推荐失败发行', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  const env = await mount(page, 'rollback');
  await expect(
    page
      .locator('[data-settings-row] [aria-hidden="true"]')
      .filter({ hasText: '插件更新失败，已恢复旧插件文件' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /打开恢复文件位置/ }).click();
  await expect.poll(() => env.host.callsTo('shell.showInExplorer').length).toBe(1);
  expect(env.host.callsTo('misc.exit')).toEqual([]);
  expect(JSON.parse(env.disk.text('state/failed-plugin-releases.json') ?? '{}').releases).toEqual([
    env.prepared.releaseSha256,
  ]);
  await expect(page.getByRole('button', { name: /重启安装/ })).toHaveCount(0);
});
