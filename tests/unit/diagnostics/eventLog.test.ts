import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  entries,
  log,
  reportText,
  resetEventLog,
  scrub,
} from '../../../src/diagnostics/eventLog.ts';

beforeEach(() => {
  resetEventLog();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 28, 15, 2, 11, 120));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('事件日志', () => {
  it('写入 warn 与 error，数字与布尔字段原样保留', () => {
    log.warn('update', 'failed', { reason: 'tls', gaveUp: false, attempts: 3 });
    log.error('error', 'uncaught');
    expect(entries()).toEqual([
      {
        t: Date.now(),
        level: 'warn',
        tag: 'update',
        event: 'failed',
        fields: { reason: 'tls', gaveUp: false, attempts: 3 },
      },
      { t: Date.now(), level: 'error', tag: 'error', event: 'uncaught' },
    ]);
  });

  it('超过 200 条时丢最旧的', () => {
    for (let index = 0; index < 250; index += 1) log.warn('host', 'call.fail', { index });
    const kept = entries();
    expect(kept).toHaveLength(200);
    expect(kept[0]?.fields).toEqual({ index: 50 });
    expect(kept.at(-1)?.fields).toEqual({ index: 249 });
  });

  it('连续相同的事件折叠成一条，带次数与首次时间', () => {
    const first = Date.now();
    log.warn('host', 'call.fail', { method: 'file.read', code: 'NOT_FOUND' });
    vi.advanceTimersByTime(600);
    log.warn('host', 'call.fail', { method: 'file.read', code: 'NOT_FOUND' });
    vi.advanceTimersByTime(400);
    log.warn('host', 'call.fail', { method: 'file.read', code: 'NOT_FOUND' });
    expect(entries()).toEqual([expect.objectContaining({ t: first + 1000, n: 3, first })]);
  });

  it('字段不同，或被别的事件隔开时不折叠', () => {
    log.warn('host', 'call.fail', { method: 'file.read' });
    log.warn('host', 'call.fail', { method: 'file.write' });
    log.warn('update', 'failed');
    log.warn('host', 'call.fail', { method: 'file.write' });
    expect(entries().map((entry) => entry.n)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('不同级别的同名事件不折叠', () => {
    log.warn('update', 'plugin.cancelled');
    log.error('update', 'plugin.cancelled');
    expect(entries()).toHaveLength(2);
  });
});

describe('脱敏', () => {
  it.each([
    ['目录含空格与中文', 'cannot write C:\\Users\\张三\\My Songs\\a.flac', 'cannot write <path>'],
    ['斜杠写法', 'open D:/music/a.flac failed', 'open <path>'],
    ['UNC 路径', 'open \\\\nas\\音乐\\a.flac', 'open <path>'],
    ['一句里的两段路径', 'rename C:\\a\\b, D:\\Users\\张三\\c', 'rename <path>'],
    [
      'URL 只留来源与路径',
      'GET https://example.com/a/b?id=1&k=2#top',
      'GET https://example.com/a/b',
    ],
    ['Cookie 请求头整行', 'Cookie: MUSIC_U=abc123; __csrf=zzz', 'Cookie=<secret>'],
    ['键值形式的令牌', 'failed token=abc123 retry', 'failed token=<secret> retry'],
    ['JSON 里的令牌', '{"token":"abc123","ok":1}', '{"token=<secret>","ok":1}'],
    ['普通文字不动', 'operation not permitted', 'operation not permitted'],
  ])('%s', (_, input, expected) => {
    expect(scrub(input)).toBe(expected);
  });

  it('URL 里的 https: 不会被当成盘符', () => {
    expect(scrub('see https://example.com/x')).toBe('see https://example.com/x');
  });

  it('截断到 160 个字符并补省略号', () => {
    const text = scrub('x'.repeat(500));
    expect(text).toHaveLength(161);
    expect(text.endsWith('…')).toBe(true);
  });

  it('写入时统一脱敏字符串字段，数字与布尔不受影响', () => {
    log.error('update', 'plugin.cancelled', { error: 'EPERM rename C:\\a\\b.dll', code: 5 });
    expect(entries()[0]?.fields).toEqual({ error: 'EPERM rename <path>', code: 5 });
  });

  it('日志里搜不到曲名、路径、令牌与查询串', () => {
    log.error('update', 'plugin.cancelled', {
      error: 'EPERM: operation not permitted, rename C:\\Users\\张三\\音乐\\晴天 周杰伦.flac',
    });
    log.warn('host', 'call.fail', {
      detail: 'GET https://music.example.com/song/url?id=1850000&token=poison-token#poison-frag',
    });
    log.warn('backend', 'down', { detail: 'Cookie: MUSIC_U=poison-cookie; __csrf=poison-csrf' });
    const report = reportText('foo-webview-default-theme 0.3.1');
    for (const word of [
      '晴天',
      '周杰伦',
      '张三',
      '音乐',
      'poison-token',
      'poison-frag',
      'poison-cookie',
      'poison-csrf',
      'id=1850000',
    ])
      expect(report).not.toContain(word);
    expect(report).toContain('EPERM: operation not permitted, rename <path>');
  });
});

describe('报告文本', () => {
  it('头在最前，日志按时间排，时间是本地时间', () => {
    log.warn('update', 'failed', { reason: 'tls' });
    vi.advanceTimersByTime(1500);
    log.error('error', 'uncaught', { name: 'TypeError', message: 'x is not a function' });
    const lines = reportText('header line', new Date(2026, 9, 28, 15, 2, 13)).split('\n');
    expect(lines[0]).toBe('header line');
    expect(lines[2]).toMatch(/^\[log\] 2 entries, 2026-10-28 15:02:13 [+-]\d\d:\d\d$/);
    expect(lines[3]).toBe('15:02:11.120 WARN  update  failed reason=tls');
    expect(lines[4]).toBe(
      '15:02:12.620 ERROR error   uncaught name=TypeError message="x is not a function"',
    );
  });

  it('折叠的条目带次数与起止时间', () => {
    log.warn('host', 'call.fail', { method: 'file.read' });
    vi.advanceTimersByTime(500);
    log.warn('host', 'call.fail', { method: 'file.read' });
    expect(reportText('h')).toContain(
      '15:02:11.620 WARN  host    call.fail method=file.read x2 (15:02:11.120-15:02:11.620)',
    );
  });

  it('没有日志时只有头与空的日志块', () => {
    expect(reportText('h', new Date(2026, 9, 28, 15, 2, 11))).toMatch(
      /^h\n\n\[log\] 0 entries, 2026-10-28 15:02:11 [+-]\d\d:\d\d$/,
    );
  });

  it('超过上限时从最旧一端截，头与最新的条目必保', () => {
    for (let index = 0; index < 200; index += 1)
      log.warn('host', 'call.fail', {
        index,
        a: 'a'.repeat(150),
        b: 'b'.repeat(150),
        c: 'c'.repeat(150),
      });
    const report = reportText('the header');
    expect(report.length).toBeLessThanOrEqual(40_000);
    expect(report.startsWith('the header\n')).toBe(true);
    expect(report).toContain('index=199 ');
    expect(report).not.toContain('index=0 ');
    expect(report).toMatch(/\[log\] \d+ entries, .*, \d+ older omitted/);
  });
});
