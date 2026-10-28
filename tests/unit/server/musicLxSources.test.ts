import { describe, expect, it } from 'vitest';
import { readMusicLxHealth, readMusicLxSources } from '../../../src/server/musicLxSources.ts';

const SOURCE = {
  id: 'a.js',
  name: '甲',
  version: 'v1',
  author: null,
  description: null,
  platforms: ['tx', 'kw'],
  enabled: true,
  failed: false,
};
const OK = { status: 'ok', reason: null, message: null, ms: 420, at: 1_000 };
const FAILED = { status: 'failed', reason: 'unreachable', message: 'HTTP 404', ms: 80, at: 2_000 };

describe('lxserver 音源列表的读取', () => {
  it('只收网易云以外的平台，多余的字段丢掉，有一项读不懂就整份作废', () => {
    expect(readMusicLxSources([SOURCE, { ...SOURCE, id: 'b.js', extra: 1 }])).toEqual([
      { ...SOURCE, error: null, health: {} },
      { ...SOURCE, id: 'b.js', error: null, health: {} },
    ]);
    for (const patch of [{ platforms: ['wy'] }, { name: '' }, { failed: 'no' }, { id: 7 }])
      expect(readMusicLxSources([{ ...SOURCE, ...patch }])).toBeNull();
  });

  it('加载失败的原因可有可无，不是文字或超过 200 字就整份作废', () => {
    const failed = { ...SOURCE, failed: true, error: 'SyntaxError' };
    expect(readMusicLxSources([failed])?.[0]?.error).toBe('SyntaxError');
    for (const error of [7, '', ' ', 'x'.repeat(201)])
      expect(readMusicLxSources([{ ...SOURCE, error }])).toBeNull();
  });

  it('各平台的检测结果按平台收，音源不支持的平台丢掉，有一项读不懂就整份作废', () => {
    const [source] =
      readMusicLxSources([{ ...SOURCE, health: { tx: OK, kw: FAILED, wy: OK } }]) ?? [];
    expect(source?.health).toEqual({ tx: OK, kw: FAILED });
    for (const health of [
      'tx',
      { tx: { ...OK, reason: 'script' } },
      { tx: { ...FAILED, reason: null } },
      { tx: { ...FAILED, reason: 'dns' } },
      { tx: { ...OK, status: 'fine' } },
      { tx: { ...OK, ms: -1 } },
      { tx: { ...OK, at: 1.5 } },
      { tx: { ...FAILED, message: '' } },
      { tx: { ...FAILED, message: 'x'.repeat(201) } },
    ])
      expect(readMusicLxSources([{ ...SOURCE, health }])).toBeNull();
  });

  it('没能检测的结果不带原因之外的结论：unknown 必须写原因', () => {
    const unknown = { status: 'unknown', reason: 'no-sample', message: null, ms: 0, at: 3_000 };
    expect(readMusicLxHealth(unknown)).toEqual(unknown);
    expect(readMusicLxHealth({ ...unknown, reason: null })).toBeNull();
  });
});
