import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BIOGRAPHY_DEBOUNCE_MS } from '../../../../src/library/biography/biographyService.ts';
import { fetchLastfmDetails } from '../../../../src/library/biography/details/fetchLastfmDetails.ts';
import { lastfmArtistUrl } from '../../../../src/library/biography/biographyModel.ts';
import { BIOGRAPHY_FILE, setupBiography } from '../../../fixtures/biographyHost.ts';
import { biographyDocument } from '../../../fixtures/biographySamples.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());
const tick = () => vi.advanceTimersByTimeAsync(BIOGRAPHY_DEBOUNCE_MS + 1);

describe('简介服务', () => {
  it('同一艺人隐藏后返回，已发出的正文写入缓存而不再重发', async () => {
    const env = setupBiography();
    await env.service.ready;
    const held = env.host.hold('http.get');
    env.store.set(env.enabled, true);
    await tick();
    env.store.set(env.active, false);
    env.store.set(env.active, true);
    await tick();
    held.respond(0, { success: true, status: 200, headers: {}, body: '完成的正文' });
    await tick();
    expect(env.state().document?.paragraphs).toEqual(['完成的正文']);
    expect(env.host.callsTo('http.get')).toHaveLength(1);
    expect(env.files.get(BIOGRAPHY_FILE)).toContain('完成的正文');
  });
  it('重新显示时同步恢复有效缓存，不先进入加载态或等待防抖', async () => {
    const env = setupBiography();
    await env.service.ready;
    env.store.set(env.enabled, true);
    await tick();
    const document = env.state().document;
    env.store.set(env.active, false);
    env.store.set(env.active, true);
    expect(env.state()).toMatchObject({ status: 'ready', document, refreshing: false });
    expect(env.host.callsTo('http.get')).toHaveLength(1);
  });
  it('换了取数来源就用它取正文，缺正文仍回退英文；key 出错显示出来，主动刷新马上重试', async () => {
    const calls: string[] = [];
    let failing = false;
    const env = setupBiography(undefined, true, undefined, async (artist, language) => {
      calls.push(language);
      if (failing) return { ok: false, problem: 'keyInvalid', retryAt: Date.now() + 900_000 };
      const now = Date.now();
      const document = language === 'en' ? biographyDocument(artist, language, 'API 正文') : null;
      return {
        ok: true,
        store: true,
        entry: { artist, language, fetchedAt: now, expiresAt: now + 60_000, document },
      };
    });
    await env.service.ready;
    env.store.set(env.enabled, true);
    await tick();
    expect(calls).toEqual(['zh', 'en']);
    expect(env.state().document?.paragraphs).toEqual(['API 正文']);
    failing = true;
    env.service.refresh();
    await tick();
    expect(env.state()).toMatchObject({
      problem: 'keyInvalid',
      document: { paragraphs: ['API 正文'] },
    });
    failing = false;
    env.service.refresh();
    await tick();
    expect(env.state().problem).toBeNull();
    expect(calls).toEqual(['zh', 'en', 'zh', 'zh', 'en']);
    expect(env.host.callsTo('http.get')).toHaveLength(0);
  });
  it('清理后立刻主动刷新会排在旧请求之后，旧正文不回填', async () => {
    const env = setupBiography();
    await env.service.ready;
    const held = env.host.hold('http.get');
    env.store.set(env.enabled, true);
    await tick();
    expect(await env.service.clearCache()).toBe(true);
    env.service.refresh();
    await tick();
    held.respond(0, { success: true, status: 200, headers: {}, body: '旧正文' });
    await tick();
    expect(env.state().document).toBeNull();
    expect(held.pending).toHaveLength(1);
    held.respond(0, { success: true, status: 200, headers: {}, body: '新正文' });
    await tick();
    expect(env.state().document?.paragraphs).toEqual(['新正文']);
    expect(env.files.get(BIOGRAPHY_FILE)).not.toContain('旧正文');
  });
  it('清理后晚到正文不写回，收起重开不自动填缓存，主动刷新恢复', async () => {
    const env = setupBiography();
    await env.service.ready;
    env.store.set(env.enabled, true);
    await tick();
    expect(env.store.get(env.service.cacheState).count).toBe(1);
    const held = env.host.hold('http.get');
    env.service.refresh();
    await tick();
    expect(await env.service.clearCache()).toBe(true);
    held.respond(0);
    held.release();
    await tick();
    expect(env.state()).toMatchObject({ status: 'cleared', document: null });
    expect(JSON.parse(env.files.get(BIOGRAPHY_FILE) ?? '').entries).toEqual([]);
    env.store.set(env.active, false);
    env.store.set(env.active, true);
    await tick();
    expect(env.state().status).toBe('cleared');
    expect(env.host.callsTo('http.get')).toHaveLength(2);
    env.service.refresh();
    await tick();
    expect(env.state().document?.paragraphs).toEqual(['正文']);
    expect(env.store.get(env.service.cacheState).count).toBe(1);
  });

  it('在线关闭时仍可清理，初读迟到不触发请求', async () => {
    const env = setupBiography();
    const held = env.host.hold('file.read');
    await tick();
    const clear = env.service.clearCache();
    held.respond(0);
    await env.service.ready;
    expect(await clear).toBe(true);
    await tick();
    expect(env.state().status).toBe('disabled');
    expect(env.host.callsTo('http.get')).toEqual([]);
    expect(JSON.parse(env.files.get(BIOGRAPHY_FILE) ?? '').entries).toEqual([]);
  });

  it('清理过程中改选另一位艺人，完成后读取新目标', async () => {
    const env = setupBiography();
    await env.service.ready;
    env.store.set(env.enabled, true);
    await tick();
    const held = env.host.hold('file.write');
    const clear = env.service.clearCache();
    await tick();
    env.store.set(env.input, { artist: 'B', sourceArtist: 'B', language: 'en' });
    held.respond(0);
    held.release();
    expect(await clear).toBe(true);
    await tick();
    expect(env.state().document?.artist).toBe('B');
    expect(JSON.parse(env.files.get(BIOGRAPHY_FILE) ?? '').entries).toMatchObject([
      { artist: 'B' },
    ]);
  });
  it('默认关闭；不可见、未确认或合辑身份都不联网', async () => {
    const env = setupBiography();
    await env.service.ready;
    await tick();
    expect(env.state().status).toBe('disabled');
    env.store.set(env.active, false);
    env.store.set(env.enabled, true);
    await tick();
    expect(env.state().status).toBe('idle');
    env.store.set(env.input, { artist: 'Queen', sourceArtist: null, language: 'zh' });
    env.store.set(env.active, true);
    await tick();
    expect(env.state().status).toBe('unconfirmed');
    env.store.set(env.input, { artist: '群星', sourceArtist: 'Queen', language: 'zh' });
    await tick();
    expect(env.state().status).toBe('idle');
    expect(env.host.callsTo('http.get')).toEqual([]);
  });

  it('开启后经 SDK 获取正文、缓存并复用，不发送曲目或专辑信息', async () => {
    const env = setupBiography();
    await env.service.ready;
    env.store.set(env.enabled, true);
    await tick();
    expect(env.state()).toMatchObject({
      status: 'ready',
      document: { artist: 'Queen', paragraphs: ['正文'] },
      cacheFailed: false,
    });
    expect(env.host.callsTo('http.get')).toEqual([
      {
        url: 'https://www.last.fm/zh/music/Queen/+wiki',
        timeout: 12_000,
        redirect: 'error',
        headers: {
          'User-Agent': 'foo-webview-default-theme/0.1 (+https://github.com/NereaFantasia)',
          Accept: 'text/html',
        },
      },
    ]);
    expect(JSON.parse(env.files.get(BIOGRAPHY_FILE) ?? '').entries[0].document.artist).toBe(
      'Queen',
    );
    env.store.set(env.active, false);
    env.store.set(env.active, true);
    await tick();
    expect(env.state().document?.paragraphs).toEqual(['正文']);
    expect(env.host.callsTo('http.get')).toHaveLength(1);
  });

  it('新目标立即撤掉旧正文，慢应答不能覆盖新目标，期间只请求最后一位', async () => {
    const env = setupBiography();
    await env.service.ready;
    const held = env.host.hold('http.get');
    env.store.set(env.enabled, true);
    await tick();
    env.store.set(env.input, { artist: 'B', sourceArtist: 'B', language: 'zh' });
    await tick();
    env.store.set(env.input, { artist: 'C', sourceArtist: 'C', language: 'zh' });
    expect(env.state().document).toBeNull();
    await tick();
    expect(held.pending).toHaveLength(1);
    held.respond(0);
    await tick();
    expect(held.pending[0]?.['url']).toContain('/music/C/');
    held.respond(0);
    await tick();
    expect(env.state().document?.artist).toBe('C');
    expect(env.host.callsTo('http.get')).toHaveLength(2);
  });

  it('缓存已过期时先显示旧正文，网络失败不覆盖它或写入空结果', async () => {
    const now = Date.now();
    const text = JSON.stringify({
      version: 1,
      entries: [
        {
          artist: 'Queen',
          language: 'zh',
          fetchedAt: now - 2000,
          expiresAt: now - 1000,
          document: biographyDocument(),
        },
      ],
    });
    const env = setupBiography(text);
    await env.service.ready;
    const held = env.host.hold('http.get');
    env.store.set(env.enabled, true);
    await tick();
    expect(env.state()).toMatchObject({ status: 'ready', stale: true, refreshing: true });
    held.respond(0, hostFailure('OPERATION_FAILED'));
    await tick();
    expect(env.state()).toMatchObject({
      status: 'ready',
      stale: true,
      problem: 'network',
      refreshing: false,
    });
    expect(env.state().document?.paragraphs[0]).toBe('第一段简介。');
    expect(env.host.callsTo('file.write')).toEqual([]);
  });

  it('同名不同语言不共用正文，简繁来源名也不自动合并', async () => {
    const env = setupBiography();
    await env.service.ready;
    env.store.set(env.enabled, true);
    await tick();
    env.store.set(env.input, { artist: 'Queen', sourceArtist: 'Queen', language: 'en' });
    await tick();
    expect(env.state().document?.language).toBe('en');
    env.store.set(env.input, { artist: '赵咏华', sourceArtist: '趙詠華', language: 'zh' });
    await tick();
    expect(env.state().document?.artist).toBe('趙詠華');
    expect(env.host.callsTo('http.get')).toHaveLength(3);
  });

  it('429 遵守 Retry-After，主动刷新或切艺人不能提前重试', async () => {
    const env = setupBiography();
    env.host.answer('http.get', {
      success: true,
      status: 429,
      headers: { 'Retry-After': '600' },
      body: '',
    });
    await env.service.ready;
    env.store.set(env.enabled, true);
    await tick();
    expect(env.state()).toMatchObject({ status: 'error', problem: 'rateLimited' });
    env.service.refresh();
    await tick();
    env.store.set(env.input, { artist: 'B', sourceArtist: 'B', language: 'zh' });
    await tick();
    expect(env.host.callsTo('http.get')).toHaveLength(1);
    expect(env.host.callsTo('file.write')).toEqual([]);
    await vi.advanceTimersByTimeAsync(600_000);
    env.host.answer('http.get', { success: true, status: 200, headers: {}, body: '恢复' });
    env.service.refresh();
    await tick();
    expect(env.state().document?.paragraphs).toEqual(['恢复']);
  });

  it('no-store 不落正文缓存，离开再返回必须重新取', async () => {
    const env = setupBiography();
    env.host.answer('http.get', {
      success: true,
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
      body: '不缓存',
    });
    await env.service.ready;
    env.store.set(env.enabled, true);
    await tick();
    expect(env.state().document?.paragraphs).toEqual(['不缓存']);
    expect(env.files.get(BIOGRAPHY_FILE)).not.toContain('不缓存');
    env.store.set(env.active, false);
    env.store.set(env.active, true);
    await tick();
    expect(env.host.callsTo('http.get')).toHaveLength(2);
  });

  it('明确没有正文可缓存，解析失败不能当作没有', async () => {
    const env = setupBiography();
    env.host.answer('http.get', { success: true, status: 200, headers: {}, body: 'missing' });
    await env.service.ready;
    env.store.set(env.enabled, true);
    await tick();
    expect(env.state().status).toBe('missing');
    env.store.set(env.active, false);
    env.store.set(env.active, true);
    await tick();
    expect(env.host.callsTo('http.get')).toHaveLength(2);
    expect(env.state().status).toBe('missing');
    env.host.answer('http.get', { success: true, status: 200, headers: {}, body: 'invalid' });
    env.service.refresh();
    await tick();
    expect(env.state()).toMatchObject({ status: 'error', problem: 'invalid' });
    expect(env.host.callsTo('file.write')).toHaveLength(2);
  });

  it.each(['关闭', '释放'])('%s 时丢弃在途结果，不写缓存或再发请求', async (action) => {
    const env = setupBiography();
    await env.service.ready;
    const held = env.host.hold('http.get');
    env.store.set(env.enabled, true);
    await tick();
    if (action === '关闭') env.store.set(env.enabled, false);
    else env.service.dispose();
    held.respond(0);
    await tick();
    expect(env.state().document).toBeNull();
    expect(env.host.callsTo('file.write')).toEqual([]);
    expect(env.host.callsTo('http.get')).toHaveLength(1);
  });

  it('宿主等待已超时后再开启会明确失败，连接恢复后能主动重试', async () => {
    const env = setupBiography(undefined, false);
    await vi.advanceTimersByTimeAsync(5001);
    await env.service.ready;
    env.store.set(env.enabled, true);
    await tick();
    expect(env.state()).toMatchObject({ status: 'error', problem: 'network' });
    expect(env.host.callsTo('misc.getProfilePath')).toEqual([]);
    env.host.connect();
    env.service.refresh();
    await tick();
    expect(env.state()).toMatchObject({ status: 'ready', problem: null });
    expect(env.state().document?.paragraphs).toEqual(['正文']);
  });

  it('正在读取时连续刷新不增加请求，缓存写失败仍保留正文并报告', async () => {
    const env = setupBiography();
    await env.service.ready;
    const held = env.host.hold('http.get');
    env.store.set(env.enabled, true);
    await tick();
    env.service.refresh();
    env.service.refresh();
    expect(held.pending).toHaveLength(1);
    env.host.answer('file.write', hostFailure('PERMISSION_DENIED'));
    held.respond(0);
    await tick();
    expect(env.state()).toMatchObject({ status: 'ready', cacheFailed: true });
    expect(env.state().document?.paragraphs).toEqual(['正文']);
  });

  it('单个身份的页面无法解析不阻止其他已确认艺人', async () => {
    const env = setupBiography();
    await env.service.ready;
    env.host.answer('http.get', { success: true, status: 200, headers: {}, body: 'invalid' });
    env.store.set(env.enabled, true);
    await tick();
    expect(env.state().problem).toBe('invalid');
    env.host.answer('http.get', { success: true, status: 200, headers: {}, body: 'B 的正文' });
    env.store.set(env.input, { artist: 'B', sourceArtist: 'B', language: 'zh' });
    await tick();
    expect(env.state().document?.paragraphs).toEqual(['B 的正文']);
  });

  it('释放发生在缓存初读中途时，不再启动网络请求', async () => {
    const env = setupBiography();
    const held = env.host.hold('file.read');
    env.store.set(env.enabled, true);
    await tick();
    expect(held.pending).toHaveLength(1);
    env.service.dispose();
    held.respond(0);
    await env.service.ready;
    await tick();
    expect(env.host.callsTo('http.get')).toEqual([]);
  });

  it('所选语言没有正文时回退英文，按实际语言缓存，英文刷新失败留旧正文', async () => {
    const env = setupBiography();
    env.host.answer('http.get', (params) => ({
      success: true,
      status: 200,
      headers: {},
      body: String(params['url']).includes('/zh/') ? 'missing' : 'English biography',
    }));
    await env.service.ready;
    env.store.set(env.enabled, true);
    await tick();
    expect(env.state()).toMatchObject({
      status: 'ready',
      document: {
        language: 'en',
        paragraphs: ['English biography'],
        url: 'https://www.last.fm/music/Queen/+wiki',
      },
    });
    expect(JSON.parse(env.files.get(BIOGRAPHY_FILE) ?? '').entries).toMatchObject([
      { language: 'zh', document: null },
      { language: 'en', document: { language: 'en' } },
    ]);
    env.store.set(env.active, false);
    env.store.set(env.active, true);
    await tick();
    expect(env.state().document?.paragraphs).toEqual(['English biography']);
    expect(env.host.callsTo('http.get')).toHaveLength(2);
    env.host.answer('http.get', (params) => ({
      success: true,
      status: String(params['url']).includes('/zh/') ? 404 : 503,
      headers: {},
      body: '',
    }));
    env.service.refresh();
    await tick();
    expect(env.state()).toMatchObject({
      status: 'ready',
      stale: true,
      problem: 'network',
      document: { language: 'en', paragraphs: ['English biography'] },
    });
  });

  it('旧版尚未到期的中文空缓存不会阻断英文请求，回退的 no-store 正文不落盘', async () => {
    const env = setupBiography(
      JSON.stringify({
        version: 1,
        entries: [
          {
            artist: 'Queen',
            language: 'zh',
            fetchedAt: Date.now() - 100,
            expiresAt: Date.now() + 1000,
            document: null,
          },
        ],
      }),
    );
    env.host.answer('http.get', {
      success: true,
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
      body: 'English biography',
    });
    await env.service.ready;
    env.store.set(env.enabled, true);
    await tick();
    expect(env.state().document).toMatchObject({
      language: 'en',
      paragraphs: ['English biography'],
    });
    expect(env.host.callsTo('http.get')[0]?.['url']).toBe('https://www.last.fm/music/Queen/+wiki');
    expect(env.files.get(BIOGRAPHY_FILE)).not.toContain('English biography');
    env.store.set(env.active, false);
    env.store.set(env.active, true);
    await tick();
    expect(env.host.callsTo('http.get')).toHaveLength(2);
  });

  it('日语独立取数，法语缺失后回退英文遇到限流仍按全局退避处理', async () => {
    const env = setupBiography();
    await env.service.ready;
    env.store.set(env.input, { artist: 'Queen', sourceArtist: 'Queen', language: 'ja' });
    env.store.set(env.enabled, true);
    await tick();
    expect(env.state().document?.language).toBe('ja');
    env.store.set(env.input, { artist: 'Queen', sourceArtist: 'Queen', language: 'fr' });
    env.host.answer('http.get', (params) => ({
      success: true,
      status: String(params['url']).includes('/fr/') ? 404 : 429,
      headers: { 'Retry-After': '600' },
      body: '',
    }));
    await tick();
    expect(env.state()).toMatchObject({ status: 'error', problem: 'rateLimited' });
    env.service.refresh();
    await tick();
    expect(env.host.callsTo('http.get')).toHaveLength(3);
  });

  it.each(['关闭', '释放', '换艺人'])(
    '首种语言空结果迟到时%s，不再给旧目标发回退请求',
    async (action) => {
      const env = setupBiography();
      await env.service.ready;
      const held = env.host.hold('http.get');
      env.store.set(env.enabled, true);
      await tick();
      if (action === '关闭') env.store.set(env.enabled, false);
      else if (action === '释放') env.service.dispose();
      else env.store.set(env.input, { artist: 'Other', sourceArtist: null, language: 'zh' });
      held.respond(0, { success: true, status: 404, headers: {}, body: '' });
      await tick();
      expect(env.host.callsTo('http.get')).toHaveLength(1);
      expect(env.state().document).toBeNull();
      expect(env.host.callsTo('file.write')).toEqual([]);
    },
  );

  it('首选语言仍为空时，刷新不能清掉英文解析失败的退避', async () => {
    const env = setupBiography();
    env.host.answer('http.get', (params) => ({
      success: true,
      status: 200,
      headers: {},
      body: String(params['url']).includes('/zh/') ? 'missing' : 'invalid',
    }));
    await env.service.ready;
    env.store.set(env.enabled, true);
    await tick();
    expect(env.state()).toMatchObject({ status: 'error', problem: 'invalid' });
    env.service.refresh();
    await tick();
    expect(env.state()).toMatchObject({ status: 'error', problem: 'invalid' });
    expect(
      env.host.callsTo('http.get').filter((call) => !String(call['url']).includes('/zh/')),
    ).toHaveLength(1);
  });
});

describe('简介附加资料生命周期', () => {
  const detailsFetch: typeof fetchLastfmDetails = (artist, language, host) =>
    fetchLastfmDetails(artist, language, host, (body) =>
      body === 'invalid'
        ? { kind: 'invalid' }
        : {
            kind: 'found',
            details: { tags: [body], counters: [], similar: [] },
          },
    );

  function setup(cached?: string) {
    const env = setupBiography(cached, true, detailsFetch);
    env.host.answer('http.get', (params) => ({
      success: true,
      status: 200,
      headers: {
        'Cache-Control': String(params['url']).endsWith('/+wiki') ? 'max-age=3600' : 'max-age=1',
      },
      body: String(params['url']).endsWith('/+wiki') ? '正文' : 'rock',
    }));
    return env;
  }

  it('正文先显示，主页请求只发艺人名，资料按独立有效期续取并落盘', async () => {
    const env = setup();
    await env.service.ready;
    const held = env.host.hold('http.get');
    env.store.set(env.enabled, true);
    await tick();
    held.respond(0);
    await tick();
    expect(env.state()).toMatchObject({ document: { paragraphs: ['正文'] }, detailsLoading: true });
    expect(held.pending).toEqual([
      expect.objectContaining({ url: lastfmArtistUrl('Queen', 'zh') }),
    ]);
    held.respond(0);
    held.release();
    await tick();
    expect(env.state().details?.tags).toEqual(['rock']);
    expect(JSON.parse(env.files.get(BIOGRAPHY_FILE) ?? '').entries[0].details.tags).toEqual([
      'rock',
    ]);
    await vi.advanceTimersByTimeAsync(1500);
    env.store.set(env.active, false);
    env.store.set(env.active, true);
    await tick();
    expect(
      env.host.callsTo('http.get').filter((call) => String(call['url']).endsWith('/+wiki')),
    ).toHaveLength(1);
    expect(env.state().details?.tags).toEqual(['rock']);
  });

  it.each(['关闭', '换艺人', '清理', '释放'])(
    '补充请求在途时%s，晚到标签不显示或写回',
    async (action) => {
      const env = setup();
      await env.service.ready;
      const held = env.host.hold('http.get');
      env.store.set(env.enabled, true);
      await tick();
      held.respond(0);
      await tick();
      if (action === '关闭') env.store.set(env.enabled, false);
      if (action === '换艺人')
        env.store.set(env.input, { artist: 'Other', sourceArtist: null, language: 'zh' });
      if (action === '清理') await env.service.clearCache();
      if (action === '释放') env.service.dispose();
      held.respond(0, { success: true, status: 200, headers: {}, body: '不应写入' });
      await tick();
      expect(env.state().details ?? null).toBeNull();
      expect(env.files.get(BIOGRAPHY_FILE)).not.toContain('不应写入');
    },
  );

  it('资料失败保留旧标签与正文，429 的退避同时约束下一位艺人', async () => {
    const env = setup();
    await env.service.ready;
    env.store.set(env.enabled, true);
    await tick();
    env.host.answer('http.get', (params) => ({
      success: true,
      status: String(params['url']).endsWith('/+wiki') ? 200 : 429,
      headers: { 'Retry-After': '600' },
      body: '新正文',
    }));
    env.service.refresh();
    await tick();
    expect(env.state()).toMatchObject({
      document: { paragraphs: ['新正文'] },
      details: { tags: ['rock'] },
      detailsProblem: 'rateLimited',
    });
    const count = env.host.callsTo('http.get').length;
    env.store.set(env.input, { artist: 'Other', sourceArtist: 'Other', language: 'zh' });
    await tick();
    expect(env.state()).toMatchObject({ problem: 'rateLimited', document: null });
    expect(env.host.callsTo('http.get')).toHaveLength(count);
  });

  it.each(['主页', '正文'])('%s 的 no-store 不会在补充写入时被绕开', async (which) => {
    const env = setup();
    await env.service.ready;
    env.store.set(env.enabled, true);
    await tick();
    expect(env.state().details?.tags).toEqual(['rock']);
    env.host.answer('http.get', (params) => {
      const wiki = String(params['url']).endsWith('/+wiki');
      return {
        success: true,
        status: 200,
        headers: { 'Cache-Control': wiki === (which === '正文') ? 'no-store' : 'max-age=3600' },
        body: wiki ? '保密正文' : '保密标签',
      };
    });
    env.service.refresh();
    await tick();
    expect(env.state().details?.tags).toEqual(['保密标签']);
    expect(env.files.get(BIOGRAPHY_FILE)).not.toContain('保密标签');
    expect(env.files.get(BIOGRAPHY_FILE)).not.toContain('"rock"');
    if (which === '正文') expect(env.files.get(BIOGRAPHY_FILE)).not.toContain('保密正文');
  });

  it('旧缓存只缺补充字段时不重取正文，主页验证页不当作空资料缓存', async () => {
    const now = Date.now();
    const env = setup(
      JSON.stringify({
        version: 1,
        entries: [
          {
            artist: 'Queen',
            language: 'zh',
            fetchedAt: now,
            expiresAt: now + 60_000,
            document: biographyDocument(),
          },
        ],
      }),
    );
    await env.service.ready;
    env.host.answer('http.get', { success: true, status: 200, headers: {}, body: 'invalid' });
    env.store.set(env.enabled, true);
    await tick();
    expect(env.state()).toMatchObject({ detailsProblem: 'invalid', document: { artist: 'Queen' } });
    expect(env.host.callsTo('http.get').map((call) => call['url'])).toEqual([
      lastfmArtistUrl('Queen', 'zh'),
    ]);
    expect(JSON.parse(env.files.get(BIOGRAPHY_FILE) ?? '').entries[0].details).toBeUndefined();
  });

  it('详情有效时重新显示不联网，主动刷新仍更新正文和详情', async () => {
    const env = setup();
    await env.service.ready;
    env.store.set(env.enabled, true);
    await tick();
    expect(env.host.callsTo('http.get')).toHaveLength(2);
    env.store.set(env.active, false);
    env.store.set(env.active, true);
    await tick();
    expect(env.state()).toMatchObject({ details: { tags: ['rock'] }, detailsLoading: false });
    expect(env.host.callsTo('http.get')).toHaveLength(2);
    env.service.refresh();
    await tick();
    expect(env.host.callsTo('http.get')).toHaveLength(4);
  });

  it('旧艺人的详情限流晚到时不改新目标显示，但阻止新目标继续联网', async () => {
    const env = setup();
    await env.service.ready;
    const held = env.host.hold('http.get');
    env.store.set(env.enabled, true);
    await tick();
    held.respond(0);
    await tick();
    env.store.set(env.input, { artist: 'Other', sourceArtist: 'Other', language: 'zh' });
    await tick();
    held.respond(0, {
      success: true,
      status: 429,
      headers: { 'Retry-After': '600' },
      body: '',
    });
    await tick();
    expect(env.state()).toMatchObject({ document: null, problem: 'rateLimited' });
    expect(env.state().details ?? null).toBeNull();
    expect(env.host.callsTo('http.get')).toHaveLength(2);
  });
});
