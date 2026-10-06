import { describe, expect, it } from 'vitest';
import { createBiographyBackoff } from '../../../../src/library/biography/biographyBackoff.ts';

describe('简介请求退避', () => {
  it('解析失败只挡同一个请求，其余失败挡住所有请求，到期后放行', () => {
    const backoff = createBiographyBackoff();
    const later = Date.now() + 60_000;
    backoff.record({ ok: false, problem: 'invalid', retryAt: later }, 'a');
    expect(backoff.blocking('a')).toMatchObject({ problem: 'invalid' });
    expect(backoff.blocking('b')).toBeNull();
    backoff.record({ ok: false, problem: 'rateLimited', retryAt: later }, 'a');
    expect(backoff.blocking('b')).toMatchObject({ problem: 'rateLimited' });
    backoff.record({ ok: false, problem: 'blocked', retryAt: Date.now() - 1 }, 'a');
    expect(backoff.blocking('a')).toBeNull();
  });

  it('主动刷新只放行断网与 key 出错，限流和拒绝访问照样等', () => {
    const backoff = createBiographyBackoff();
    const later = Date.now() + 60_000;
    for (const problem of ['network', 'keyInvalid', 'keySuspended'] as const) {
      backoff.record({ ok: false, problem, retryAt: later }, 'a');
      backoff.release();
      expect(backoff.blocking('a')).toBeNull();
    }
    for (const problem of ['rateLimited', 'blocked', 'invalid'] as const) {
      backoff.record({ ok: false, problem, retryAt: later }, 'a');
      backoff.release();
      expect(backoff.blocking('a')).toMatchObject({ problem });
    }
    backoff.clear();
    expect(backoff.blocking('a')).toBeNull();
  });
});
