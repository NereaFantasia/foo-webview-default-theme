import { test } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

// 开发服务器按首次请求编译模块。并行起跑时每个 worker 的首条用例同时要整套模块，编译排队，会撞上 5 秒的
// 断言超时；这个用例在别的用例之前把 src 下的脚本模块各请求一遍，编译结果缓存到服务退出，懒加载的页面也在内。
// 单个请求失败不算：这一步只是预热，用例自己会再取。

const CONCURRENCY = 12;

function scripts(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return scripts(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test('预热开发服务器：先编译 src 下的全部脚本模块', async ({ request, baseURL }) => {
  test.setTimeout(180_000);
  const queue = scripts('src').map((path) => `${baseURL}/${path.split(sep).join('/')}`);
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let url = queue.pop(); url !== undefined; url = queue.pop()) {
        await request.get(url).catch(() => undefined);
      }
    }),
  );
});
