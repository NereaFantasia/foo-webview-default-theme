import { describe, expect, it } from 'vitest';
import { MAX_SCRIPT_BYTES, startLxSources } from '../../music/lxSources.ts';

const signal = new AbortController().signal;
const host = {
  installed: () => true,
  connect: async () => ({ url: 'http://127.0.0.1:1001/', adminPassword: 'admin' }),
  stop: async () => {},
};

interface Entry {
  id: string;
  name: string;
  supportedSources: string[];
  enabled: boolean;
  status?: string;
  error?: string;
  script: string;
}

/**
 * 假的 lxserver 音源接口与一个放脚本的网站。脚本里的记号决定 lxserver 怎么答：REJECT 上传失败，UNSAFE 要放开 VM，
 * WY_ONLY 只支持网易云，NEEDVM 启用时要放开 VM，BROKEN 启用后加载失败。
 */
function lxserver(initial: Entry[] = []) {
  const entries = [...initial];
  const calls: { path: string; body: unknown; admin: string | null }[] = [];
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.host === 'scripts.example.test') {
      if (url.pathname === '/huge.js') return new Response('x'.repeat(MAX_SCRIPT_BYTES + 1));
      if (url.pathname === '/%E6%98%9F%E6%B5%B7.js') return new Response('/*! script */');
      return new Response('', { status: 404 });
    }
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : null;
    const path = url.pathname.slice('/api/custom-source/'.length);
    calls.push({ path, body, admin: new Headers(init?.headers).get('x-frontend-auth') });
    const fields = body as Record<string, unknown>;
    const found = entries.find((entry) => entry.id === fields?.id);
    switch (path) {
      case 'list':
        return json(entries.map((entry) => ({ ...entry, script: undefined })));
      case 'upload': {
        const script = String(fields.content);
        if (script.includes('REJECT')) return new Response('源已存在', { status: 500 });
        if (script.includes('UNSAFE')) return json({ success: false, requireUnsafe: true });
        const id = `${String(fields.filename).replace(/\.js$/, '')}.js`;
        const supportedSources = script.includes('WY_ONLY') ? ['wy'] : ['wy', 'kw', 'kg'];
        entries.push({ id, name: id, supportedSources, enabled: false, script });
        return json({ success: true, id, supportedSources });
      }
      case 'toggle':
        if (!found) return new Response('源不存在', { status: 500 });
        if (found.script.includes('NEEDVM')) return json({ success: false, requireUnsafe: true });
        found.enabled = fields.enabled === true;
        if (found.script.includes('BROKEN')) found.status = 'failed';
        return json({ success: true, enabled: found.enabled });
      case 'delete':
        entries.splice(entries.indexOf(found!), 1);
        return json({ success: true });
      case 'reorder':
        return json({ success: true });
    }
    return new Response('', { status: 404 });
  };
  return { entries, calls, sources: startLxSources(host, { fetch }) };
}

describe('托管 lxserver 的音源', () => {
  it('列出时只写网易云以外的平台，启用了但加载失败的标出来；修改都带管理密码', async () => {
    const { sources, calls } = lxserver([
      { id: 'a.js', name: '甲', supportedSources: ['wy', 'tx'], enabled: true, script: '' },
      {
        id: 'b.js',
        name: '',
        supportedSources: ['kw'],
        enabled: true,
        status: 'failed',
        error: 'SyntaxError:\n  Unexpected token',
        script: '',
      },
    ]);
    expect(await sources.list(signal)).toEqual([
      expect.objectContaining({
        id: 'a.js',
        name: '甲',
        platforms: ['tx'],
        failed: false,
        error: null,
      }),
      expect.objectContaining({
        id: 'b.js',
        name: 'b.js',
        platforms: ['kw'],
        failed: true,
        error: 'SyntaxError: Unexpected token',
      }),
    ]);
    await sources.toggle('a.js', false, signal);
    await sources.reorder(['b.js', 'a.js'], signal);
    await sources.remove('b.js', signal);
    expect(calls.slice(1)).toEqual([
      { path: 'toggle', body: { id: 'a.js', enabled: false }, admin: 'admin' },
      { path: 'reorder', body: { sourceIds: ['b.js', 'a.js'] }, admin: 'admin' },
      { path: 'delete', body: { id: 'b.js' }, admin: 'admin' },
    ]);
  });

  it('导入时上传再启用；平台不合用、要放开 VM、lxserver 不收时不留下半成品', async () => {
    const { sources, entries } = lxserver();
    await sources.add('星海.js', '/*! ok */', signal);
    expect(entries).toEqual([expect.objectContaining({ id: '星海.js', enabled: true })]);

    for (const script of ['WY_ONLY', 'UNSAFE', 'REJECT', 'NEEDVM'])
      await expect(sources.add(`${script}.js`, script, signal)).rejects.toMatchObject({
        code: 'source-rejected',
      });
    expect(entries.map((entry) => entry.id)).toEqual(['星海.js']);

    // 能启用但加载失败的照常留下，由列表标出。
    await sources.add('broken.js', 'BROKEN', signal);
    expect((await sources.list(signal)).find((item) => item.id === 'broken.js')).toMatchObject({
      failed: true,
    });
    await expect(
      sources.add('big.js', 'x'.repeat(MAX_SCRIPT_BYTES + 1), signal),
    ).rejects.toMatchObject({ code: 'invalid-request' });
  });

  it('按网址导入：文件名取路径最后一段；超过上限、取不到或网址不对时不导入', async () => {
    const { sources, calls } = lxserver();
    await sources.addFromUrl('https://scripts.example.test/%E6%98%9F%E6%B5%B7.js', signal);
    expect(calls.find((call) => call.path === 'upload')?.body).toEqual({
      filename: '%E6%98%9F%E6%B5%B7.js',
      content: '/*! script */',
    });
    const failures = [
      ['https://scripts.example.test/huge.js', 'source-rejected'],
      ['https://scripts.example.test/missing.js', 'upstream-unavailable'],
      ['file:///C:/source.js', 'invalid-request'],
      ['https://user:pass@scripts.example.test/a.js', 'invalid-request'],
      ['不是网址', 'invalid-request'],
    ];
    for (const [url, code] of failures)
      await expect(sources.addFromUrl(url!, signal)).rejects.toMatchObject({ code });
  });
});
