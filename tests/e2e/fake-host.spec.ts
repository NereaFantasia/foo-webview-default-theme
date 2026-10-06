import { expect, test, type Page } from '@playwright/test';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { collectPageErrors, installPageHost } from '../fixtures/pageHost.ts';

// 替身在页面这一侧的线协议：直接调页面上的原生桥，不经主题代码。主题经 SDK 走通的那条路径由
// host-status 覆盖。

/** 媒体库设成未启用：启动落在专辑页，页面自己就不读专辑清单，调用记录里只有测试发的那几次。 */
const LIBRARY_OFF = { library: { isEnabled: { success: true, enabled: false } } } as const;

/** 在页面里调原生桥的 invoke；reject 时答 `{ rejected: 错误文字 }`，好在 Node 这边断言。 */
function invokeInPage(page: Page, method: string, params?: object): Promise<unknown> {
  return page.evaluate(
    async ({ method, params }) => {
      const native: unknown = Reflect.get(window, 'fb2k');
      const invoke: unknown =
        typeof native === 'object' && native !== null ? Reflect.get(native, 'invoke') : undefined;
      if (typeof invoke !== 'function') throw new Error('页面上没有原生桥');
      try {
        return await invoke(method, params);
      } catch (error) {
        return { rejected: error instanceof Error ? error.message : String(error) };
      }
    },
    { method, params },
  );
}

test('调用经绑定回到 Node 应答，参数过 JSON，未声明的键答失败信封', async ({ page }) => {
  const errors = collectPageErrors(page);
  const host = await installPageHost(page, { answers: LIBRARY_OFF });
  await page.goto('/');

  expect(
    await invokeInPage(page, 'library.getAlbums', { limit: 3, query: undefined }),
  ).toMatchObject({ success: true, limit: 3 });
  expect(host.callsTo('library.getAlbums')).toEqual([{ limit: 3 }]);
  expect(await invokeInPage(page, 'library.getAlbums', { limit: 3, bogus: true })).toEqual({
    success: false,
    error: "unknown parameter 'bogus'",
    code: 'INVALID_PARAMS',
  });
  expect(errors).toEqual([]);
});

test('失败信封 resolve，应答抛错时页面收到 reject', async ({ page }) => {
  const host = await installPageHost(page, {
    answers: { playlist: { setActive: hostFailure('LOCKED') } },
  });
  host.answer('window.minimize', () => {
    throw new Error('Request timeout');
  });
  await page.goto('/');

  expect(await invokeInPage(page, 'playlist.setActive', { playlist: 0 })).toEqual({
    success: false,
    error: 'LOCKED',
    code: 'LOCKED',
  });
  expect(await invokeInPage(page, 'window.minimize')).toEqual({
    rejected: expect.stringContaining('Request timeout'),
  });
});

test('扣下的调用由测试决定放行先后', async ({ page }) => {
  const host = await installPageHost(page, { answers: LIBRARY_OFF });
  await page.goto('/');
  const held = host.hold('library.getAlbums');

  const first = invokeInPage(page, 'library.getAlbums', { limit: 1 });
  const second = invokeInPage(page, 'library.getAlbums', { limit: 2 });
  await expect.poll(() => held.pending.length).toBe(2);
  const secondIndex = held.pending.findIndex((params) => params['limit'] === 2);
  expect(secondIndex).toBeGreaterThanOrEqual(0);
  held.respond(secondIndex);
  expect(await second).toMatchObject({ success: true, limit: 2 });
  const stillWaiting = await Promise.race([
    first.then(() => 'settled'),
    new Promise((resolve) => setTimeout(() => resolve('waiting'), 100)),
  ]);
  expect(stillWaiting).toBe('waiting');
  held.release();
  expect(await first).toMatchObject({ success: true, limit: 1 });
});

test('事件推进页面的监听器，并在 window 上派发 fb2k: 前缀的 CustomEvent', async ({ page }) => {
  const errors = collectPageErrors(page);
  const host = await installPageHost(page);
  await page.goto('/');
  // 页面自己也听这个事件（专辑清单随库变更重读），监听数早就不是 0：等页面起完记下基数，测试的监听
  // 挂上之后应当比它多。挂没挂上不靠这个数判断：两个监听在一次 evaluate 里同步挂上，这次 evaluate
  // 返回之后再推；收到的留在 window 上，推完再取。
  await expect(page.getByText('媒体库为空')).toBeVisible();
  const base = host.listenerCount('library:itemsAdded');
  await page.evaluate(() => {
    const native: unknown = Reflect.get(window, 'fb2k');
    const on: unknown =
      typeof native === 'object' && native !== null ? Reflect.get(native, 'on') : undefined;
    if (typeof on !== 'function') throw new Error('页面上没有原生桥');
    const viaWindow = new Promise((resolve) => {
      window.addEventListener(
        'fb2k:library:itemsAdded',
        (event) => resolve(event instanceof CustomEvent ? event.detail : null),
        { once: true },
      );
    });
    const viaListener = new Promise((resolve) => on('library:itemsAdded', resolve));
    Reflect.set(window, '__received', Promise.all([viaListener, viaWindow]));
  });
  await expect.poll(() => host.listenerCount('library:itemsAdded')).toBeGreaterThan(base);
  await host.emit('library:itemsAdded', { count: 2, timestamp: 1 });

  const payload = { count: 2, timestamp: 1 };
  const received = await page.evaluate((): unknown => Reflect.get(window, '__received'));
  expect(received).toEqual([payload, payload]);
  expect(errors).toEqual([]);
});
