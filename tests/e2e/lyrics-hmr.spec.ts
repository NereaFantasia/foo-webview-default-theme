import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { openPlayer } from '../fixtures/playerPage.ts';

test.use({ screenshot: 'off' });

test('歌词服务热更新后整页重建，沉浸仍显示当前歌词', async ({ browser }) => {
  const server = await createServer({
    configFile: 'vite.e2e.config.ts',
    cacheDir: 'node_modules/.vite-lyrics-hmr',
    server: { hmr: true, port: 5362, strictPort: true, host: '127.0.0.1' },
  });
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5362', locale: 'zh-CN' });
  try {
    await server.listen();
    const page = await context.newPage();
    const env = await openPlayer(page, { state: { state: 'paused' } });
    env.host.answer('lyrics.get', {
      success: true,
      available: true,
      source: 'embedded',
      path: '',
      lyrics: '[00:01]当前歌词\n[00:50]下一句',
      synced: true,
    });
    await page.locator('[data-right-card-key="lyrics"]').click();
    await page.getByRole('button', { name: '重新读取歌词' }).click();
    const entry = page.locator('[data-player-key="cover"]').first();
    await entry.click();
    await expect(page.locator('[data-field="lyric-main"]')).toHaveText('当前歌词');
    const module = await server.moduleGraph.getModuleByUrl('/src/immersive/lyrics/lyricLog.ts');
    if (!module) throw new Error('歌词模块未加载');
    const reloaded = page.waitForEvent('framenavigated', {
      predicate: (frame) => frame === page.mainFrame(),
    });
    await server.reloadModule(module);
    await reloaded;
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(page.locator('[data-field="lyric-main"]')).toHaveText('当前歌词');
    expect(env.errors).toEqual([]);
  } finally {
    await context.close();
    await server.close();
  }
});
