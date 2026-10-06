import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { createBiographyCache } from '../../../../src/library/biography/biographyCache.ts';
import { EMPTY_JSON_FILE_CACHE } from '../../../../src/kit/jsonFileCache.ts';
import { BIOGRAPHY_CACHE_BYTES } from '../../../../src/library/biography/biographyCacheFormat.ts';
import { biographyDocument } from '../../../fixtures/biographySamples.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

function entry(artist: string, text = '正文') {
  const now = Date.now();
  return {
    artist,
    language: 'zh' as const,
    fetchedAt: now,
    expiresAt: now + 1000,
    document: biographyDocument(artist, 'zh', text),
  };
}

function setup() {
  const host = installFakeHost();
  const writes: string[] = [];
  host.answer('file.write', (params) => {
    const content = String(params['content']);
    writes.push(content);
    return { success: true, bytesWritten: content.length };
  });
  let stats = EMPTY_JSON_FILE_CACHE;
  const cache = createBiographyCache(host.fb, Date.now, (next) => {
    stats = next;
  });
  onTestFinished(() => cache.dispose());
  return { host, writes, cache, stats: () => stats };
}

describe('简介缓存', () => {
  it.each(['{bad', '{"version":2,"entries":[]}'])(
    '损坏或错误版本的文件不成为可信缓存：%s',
    async (content) => {
      const env = setup();
      env.host.answer('file.read', { success: true, content, size: content.length });
      await env.cache.ready;
      expect(env.cache.get('Queen', 'zh')).toBeUndefined();
      expect(env.stats()).toMatchObject({ count: 0, loaded: true, failed: false });
    },
  );

  it('读回原格式，按艺人与语言区分条目，过滤损坏正文并保留过期正文供刷新', async () => {
    const env = setup();
    const old = { ...entry('Queen'), fetchedAt: 1, expiresAt: 2 };
    const english = {
      ...entry('Queen'),
      language: 'en',
      document: biographyDocument('Queen', 'en'),
    };
    const content = JSON.stringify({
      version: 1,
      entries: [old, english, { ...entry('Bad'), document: { artist: 'Other' } }],
    });
    env.host.answer('file.read', { success: true, content, size: content.length });
    await env.cache.ready;
    expect(env.cache.get('Queen', 'zh')).toEqual(old);
    expect(env.cache.get('Queen', 'en')).toEqual(english);
    expect(env.cache.get('Bad', 'zh')).toBeUndefined();
    expect(env.stats()).toMatchObject({ count: 2, loaded: true, failed: false });
  });

  it('清理排队后释放缓存，仍在旧写入之后清空文件且不再发布状态', async () => {
    const env = setup();
    await env.cache.ready;
    const held = env.host.hold('file.write');
    const saved = env.cache.save('A', 'zh', entry('A'));
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    const cleared = env.cache.clear();
    const state = env.stats();
    env.cache.dispose();
    held.release();
    expect(await saved).toBe(true);
    expect(await cleared).toBe(true);
    expect(env.writes).toHaveLength(2);
    expect(JSON.parse(env.writes.at(-1) ?? '')).toEqual({ version: 1, entries: [] });
    expect(env.stats()).toBe(state);
  });

  it('统计已落盘条数与 UTF-8 字节数，清理成功后只保留空文件', async () => {
    const env = setup();
    await env.cache.ready;
    await env.cache.save('Queen', 'zh', entry('Queen'));
    expect(env.stats()).toMatchObject({ loaded: true, count: 1, failed: false });
    expect(env.stats().bytes).toBe(new TextEncoder().encode(env.writes[0]).length);
    expect(await env.cache.clear()).toBe(true);
    expect(env.cache.get('Queen', 'zh')).toBeUndefined();
    expect(env.stats()).toMatchObject({ count: 0, clearing: false, failed: false });
    expect(JSON.parse(env.writes.at(-1) ?? '').entries).toEqual([]);
  });

  it('清理使排队写入作废，已经在途的旧写入完成后以空文件收尾', async () => {
    const env = setup();
    await env.cache.ready;
    const held = env.host.hold('file.write');
    const first = env.cache.save('A', 'zh', entry('A'));
    const second = env.cache.save('B', 'zh', entry('B'));
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    const clear = env.cache.clear();
    expect(env.cache.clear()).toBe(clear);
    held.respond(0);
    await first;
    expect(await second).toBe(false);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    held.respond(0);
    expect(await clear).toBe(true);
    expect(JSON.parse(env.writes.at(-1) ?? '').entries).toEqual([]);
    expect(env.cache.get('A', 'zh')).toBeUndefined();
    expect(env.stats().count).toBe(0);
  });

  it('清理发生在初读中途时，晚到文件和等待初读的 save 都不能补回旧内容', async () => {
    const env = setup();
    const held = env.host.hold('file.read');
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    const save = env.cache.save('B', 'zh', entry('B'));
    const clear = env.cache.clear();
    const content = JSON.stringify({ version: 1, entries: [entry('A')] });
    held.respond(0, { success: true, content, size: content.length });
    expect(await save).toBe(false);
    expect(await clear).toBe(true);
    expect(env.cache.get('A', 'zh')).toBeUndefined();
    expect(env.cache.get('B', 'zh')).toBeUndefined();
    expect(JSON.parse(env.writes.at(-1) ?? '').entries).toEqual([]);
  });

  it('清理写入失败保留磁盘统计并报告失败，重试后复位', async () => {
    const env = setup();
    await env.cache.ready;
    await env.cache.save('A', 'zh', entry('A'));
    env.host.answer('file.write', hostFailure('PERMISSION_DENIED'));
    expect(await env.cache.clear()).toBe(false);
    expect(env.stats()).toMatchObject({ count: 1, failed: true, clearing: false });
    env.host.answer('file.write', { success: true, bytesWritten: 26 });
    expect(await env.cache.clear()).toBe(true);
    expect(env.stats()).toMatchObject({ count: 0, failed: false });
  });
  it('写入串行，后到的新正文最终留在磁盘', async () => {
    const env = setup();
    await env.cache.ready;
    const held = env.host.hold('file.write');
    const first = env.cache.save('Queen', 'zh', entry('Queen', '旧'));
    const second = env.cache.save('Queen', 'zh', entry('Queen', '新'));
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    held.respond(0);
    expect(await first).toBe(true);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    held.respond(0);
    expect(await second).toBe(true);
    expect(JSON.parse(env.writes.at(-1) ?? '').entries[0].document.paragraphs).toEqual(['新']);
  });

  it('数量与 UTF-8 字节数都有上限，淘汰最久未用的条目', async () => {
    const env = setup();
    await env.cache.ready;
    for (let i = 0; i < 65; i += 1) await env.cache.save(String(i), 'zh', entry(String(i)));
    expect(env.cache.get('0', 'zh')).toBeUndefined();
    expect(env.cache.get('64', 'zh')?.document?.artist).toBe('64');
    for (let i = 0; i < 30; i += 1)
      await env.cache.save(`长${i}`, 'zh', entry(`长${i}`, '字'.repeat(64_000)));
    const serialized = env.writes.at(-1) ?? '';
    expect(new TextEncoder().encode(serialized).length).toBeLessThanOrEqual(BIOGRAPHY_CACHE_BYTES);
    expect(env.cache.get('长29', 'zh')?.document?.paragraphs[0]?.length).toBe(64_000);
  });

  it('存储失败不丢失内存正文，释放后不补发排队写入', async () => {
    const env = setup();
    await env.cache.ready;
    env.host.answer('file.write', hostFailure('PERMISSION_DENIED'));
    expect(await env.cache.save('A', 'zh', entry('A'))).toBe(false);
    expect(env.cache.get('A', 'zh')?.document?.artist).toBe('A');
    const held = env.host.hold('file.write');
    const first = env.cache.save('B', 'zh', entry('B'));
    const second = env.cache.save('C', 'zh', entry('C'));
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    env.cache.dispose();
    held.respond(0, { success: true, bytesWritten: 1 });
    await first;
    expect(await second).toBe(false);
    expect(held.pending).toHaveLength(0);
  });
});
