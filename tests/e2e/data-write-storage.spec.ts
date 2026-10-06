import { expect, test, type Page } from '@playwright/test';

test.use({ screenshot: 'off' });

async function gotoProbe(page: Page) {
  await page.route('**/data-write-storage-probe', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="zh-CN"><title>存储验证</title></html>',
    }),
  );
  await page.goto('/data-write-storage-probe');
}

async function openStorage(page: Page, name: string, stale?: string) {
  await gotoProbe(page);
  return page.evaluateHandle(
    async ({ name, stale }) => {
      const { createDataWriter }: typeof import('../../src/kit/dataWrite.ts') = await import(
        `${location.origin}/src/kit/dataWrite.ts`
      );
      const { createBrowserDataStorage }: typeof import('../../src/kit/browserDataStorage.ts') =
        await import(`${location.origin}/src/kit/browserDataStorage.ts`);
      const key = 'default-theme.data-test.value.v1';
      const storage = createBrowserDataStorage({
        database: indexedDB,
        name,
        legacy: {
          getItem: (key) => stale ?? localStorage.getItem(key),
          setItem: (key, value) => localStorage.setItem(key, value),
          removeItem: (key) => localStorage.removeItem(key),
        },
      });
      const writer = createDataWriter({ storage, locks: navigator.locks, now: () => 0 });
      let held = false;
      let release: (() => void) | undefined;
      let result: ReturnType<typeof writer.run<number>> | undefined;
      return {
        storage,
        key,
        write: (value: string | null) => writer.run((scope) => scope.setLocal(key, value)),
        read: () =>
          writer.run(async (scope) => ({
            value: await scope.readLocal(key),
            generation: await scope.generation(key),
          })),
        hold(value: string) {
          result = writer.run(async (scope) => {
            held = true;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            held = false;
            return scope.setLocal(key, value);
          });
        },
        held: () => held,
        release: () => release?.(),
        result: () => result,
      };
    },
    { name, stale },
  );
}

test('两个页面交接写锁后读取已提交的值和代数', async ({ page, context }, info) => {
  const popup = await context.newPage();
  const first = await openStorage(page, info.testId, 'stale');
  const second = await openStorage(popup, info.testId, 'stale');
  await first.evaluate((value) => value.hold('first'));
  await expect.poll(() => first.evaluate((value) => value.held())).toBe(true);
  const queued = second.evaluate((value) => value.write('second'));
  await expect
    .poll(() => popup.evaluate(async () => (await navigator.locks.query()).pending?.length))
    .toBe(1);
  await first.evaluate((value) => value.release());
  expect(await first.evaluate((value) => value.result())).toEqual({ success: true, value: 1 });
  expect(await queued).toEqual({ success: true, value: 2 });
  expect(await first.evaluate((value) => value.read())).toEqual({
    success: true,
    value: { value: 'second', generation: 2 },
  });
  expect(await second.evaluate((value) => value.read())).toEqual({
    success: true,
    value: { value: 'second', generation: 2 },
  });
});

test('初次读旧键，写入后以数据库为准并保留兼容值', async ({ page }, info) => {
  const data = await openStorage(page, info.testId, 'old');
  expect(await data.evaluate((value) => value.read())).toEqual({
    success: true,
    value: { value: 'old', generation: 0 },
  });
  expect(await data.evaluate((value) => value.write('new'))).toEqual({ success: true, value: 1 });
  expect(await data.evaluate((value) => value.read())).toEqual({
    success: true,
    value: { value: 'new', generation: 1 },
  });
  expect(await data.evaluate((value) => localStorage.getItem(value.key))).toBe('new');
});

test('用户清除后保留空值记录，不会从旧缓存恢复数据', async ({ page }, info) => {
  const data = await openStorage(page, info.testId, 'old');
  expect(await data.evaluate((value) => value.write(null))).toEqual({ success: true, value: 1 });
  expect(await data.evaluate((value) => value.read())).toEqual({
    success: true,
    value: { value: null, generation: 1 },
  });
  expect(await data.evaluate((value) => localStorage.getItem(value.key))).toBeNull();
});

test('一次读出数据库里的全部业务键：不含代数，清除过的为 null，兼容值不在其中', async ({
  page,
}, info) => {
  const data = await openStorage(page, info.testId, 'old');
  await data.evaluate((value) => value.write('saved'));
  const entries = await data.evaluate(async (value) => {
    await value.storage.setItem('default-theme.data-test.cleared.v1', 'x');
    await value.storage.removeItem('default-theme.data-test.cleared.v1');
    return [...(await value.storage.entries())];
  });
  expect(entries).toEqual([
    ['default-theme.data-test.cleared.v1', null],
    ['default-theme.data-test.value.v1', 'saved'],
  ]);
});

test('一次读出全部键时，格式不对的值读成 null，不连累其他键', async ({ page }, info) => {
  const data = await openStorage(page, info.testId, 'old');
  await data.evaluate(async (value) => {
    await value.write('saved');
    await value.storage.setItem('default-theme.data-test.other.v1', 'other');
  });
  await page.evaluate(async (name) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('values', 'readwrite');
        transaction.objectStore('values').put({ broken: true }, 'default-theme.data-test.value.v1');
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };
      };
    });
  }, info.testId);
  expect(await data.evaluate(async (value) => [...(await value.storage.entries())])).toEqual([
    ['default-theme.data-test.other.v1', 'other'],
    ['default-theme.data-test.value.v1', null],
  ]);
});

/** 页面用的那一份偏好存储，与主题启动时打开的相同。 */
async function openPagePrefs(page: Page) {
  await gotoProbe(page);
  return page.evaluateHandle(async () => {
    const { startBrowserDataWriter }: typeof import('../../src/kit/browserDataStorage.ts') =
      await import(`${location.origin}/src/kit/browserDataStorage.ts`);
    const { openBrowserPrefStorage }: typeof import('../../src/kit/prefStorage.ts') = await import(
      `${location.origin}/src/kit/prefStorage.ts`
    );
    const writer = startBrowserDataWriter();
    const prefs = await openBrowserPrefStorage(writer);
    return { prefs, written: () => writer.run(() => undefined) };
  });
}

test('偏好存储写入经写锁落盘；清掉 localStorage 后重开仍读回可信副本', async ({
  page,
  context,
}) => {
  const key = 'default-theme.data-test.pref.v1';
  const first = await openPagePrefs(page);
  expect(await first.evaluate((value) => value.prefs.available)).toBe(true);
  await first.evaluate(async (value, key) => {
    value.prefs.setItem(key, 'kept');
    await value.written();
  }, key);
  await expect
    .poll(() => first.evaluate((value, key) => value.prefs.saveState(key)?.status, key))
    .toBe('saved');
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe('kept');
  await page.evaluate(() => localStorage.clear());
  await page.close();
  const reopened = await context.newPage();
  const second = await openPagePrefs(reopened);
  expect(await second.evaluate((value, key) => value.prefs.getItem(key), key)).toBe('kept');
});

test('页面重开后能读回值和代数', async ({ page, context }, info) => {
  const first = await openStorage(page, info.testId);
  expect((await first.evaluate((value) => value.write('saved'))).success).toBe(true);
  await page.close();
  const reopened = await context.newPage();
  const second = await openStorage(reopened, info.testId);
  expect(await second.evaluate((value) => value.read())).toEqual({
    success: true,
    value: { value: 'saved', generation: 1 },
  });
});

test('关闭连接后拒绝写入，兼容值保持原样', async ({ page }, info) => {
  const data = await openStorage(page, info.testId);
  await data.evaluate((value) => value.write('saved'));
  await data.evaluate((value) => value.storage.dispose());
  expect(await data.evaluate((value) => value.write('late'))).toEqual({
    success: false,
    reason: 'write-failed',
  });
  expect(await data.evaluate((value) => localStorage.getItem(value.key))).toBe('saved');
});

test('数据库中的非法值明确失败，不退回旧值掩盖损坏', async ({ page }, info) => {
  const data = await openStorage(page, info.testId, 'old');
  await data.evaluate((value) => value.write('saved'));
  for (const invalid of [{ broken: true }, undefined, 42]) {
    await page.evaluate(
      async ({ name, invalid }) => {
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open(name, 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction('values', 'readwrite');
            transaction.objectStore('values').put(invalid, 'default-theme.data-test.value.v1');
            transaction.oncomplete = () => {
              db.close();
              resolve();
            };
            transaction.onabort = () => {
              db.close();
              reject(transaction.error);
            };
          };
        });
      },
      { name: info.testId, invalid },
    );
    expect(await data.evaluate((value) => value.read())).toEqual({
      success: false,
      reason: 'write-failed',
    });
  }
});

test('释放页面写入助手时取消排队请求，已持锁的写入完成后才关闭连接', async ({ page }, info) => {
  await openStorage(page, info.testId);
  const data = await page.evaluateHandle(async () => {
    const {
      startBrowserDataWriter,
      createBrowserDataStorage,
    }: typeof import('../../src/kit/browserDataStorage.ts') = await import(
      `${location.origin}/src/kit/browserDataStorage.ts`
    );
    const writer = startBrowserDataWriter();
    let held = false;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = writer.run(async (scope) => {
      await scope.setLocal('default-theme.data-test.first.v1', 'first');
      held = true;
      await gate;
      return scope.setLocal('default-theme.data-test.last.v1', 'last');
    });
    const queued = writer.run((scope) =>
      scope.setLocal('default-theme.data-test.queued.v1', 'queued'),
    );
    return {
      held: () => held,
      dispose: () => writer.dispose(),
      queued: () => queued,
      release,
      active: () => active,
      late: () => writer.run((scope) => scope.setLocal('default-theme.data-test.late.v1', 'late')),
      async read() {
        const storage = createBrowserDataStorage({ database: indexedDB, legacy: null });
        try {
          return await Promise.all(
            ['first', 'last', 'queued', 'late'].map((key) =>
              storage.getItem(`default-theme.data-test.${key}.v1`),
            ),
          );
        } finally {
          storage.dispose();
        }
      },
    };
  });
  await expect.poll(() => data.evaluate((value) => value.held())).toBe(true);
  await data.evaluate((value) => value.dispose());
  expect(await data.evaluate((value) => value.queued())).toEqual({
    success: false,
    reason: 'aborted',
  });
  await data.evaluate((value) => value.release());
  expect(await data.evaluate((value) => value.active())).toEqual({
    success: true,
    value: expect.any(Number),
  });
  expect(await data.evaluate((value) => value.late())).toEqual({
    success: false,
    reason: 'aborted',
  });
  expect(await data.evaluate((value) => value.read())).toEqual(['first', 'last', null, null]);
});
