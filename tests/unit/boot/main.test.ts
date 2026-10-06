import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it.each([
  ['https://foo-ui-webview2.local', new TypeError('Failed to fetch'), true],
  ['https://foo-ui-webview2.local', new DOMException('Timed out', 'TimeoutError'), false],
  ['https://example.com', new TypeError('Failed to fetch'), false],
])('引导页读取安装标识失败：%s，%s', async (origin, failure, starts) => {
  const current = { v: '0.1.0', dir: '0.1.0' };
  let finish = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const replace = vi.fn();
  const values = new Map<string, string>();
  const title = { textContent: '' };
  vi.stubGlobal('location', {
    href: `${origin}/index.html`,
    protocol: 'https:',
    search: '',
    hash: '',
    replace,
  });
  vi.stubGlobal('document', {
    documentElement: { lang: '' },
    cookie: '',
    getElementById: (id: string) => (id === 'title' ? title : null),
  });
  vi.stubGlobal('navigator', {
    language: 'zh-CN',
    locks: {
      request(_name: string, work: () => Promise<void>) {
        const task = work();
        void task.then(finish, finish);
        return task;
      },
    },
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL) => {
      if (url.pathname === '/install-id') throw failure;
      if (url.pathname === '/current.json')
        return Response.json({ schema: 1, frontend: { version: current } });
      if (url.pathname === '/fe/0.1.0/installed.json')
        return Response.json({
          schema: 1,
          version: current.v,
          files: { 'index.html': 'a'.repeat(64) },
        });
      return new Response(null, { status: 404 });
    }),
  );
  await import('../../../src/boot/main.ts');
  await done;
  if (starts) expect(replace).toHaveBeenCalledWith(new URL(`${origin}/fe/0.1.0/index.html`));
  else {
    expect(replace).not.toHaveBeenCalled();
    expect(title.textContent).toBe('无法读取或保存启动状态');
  }
});
