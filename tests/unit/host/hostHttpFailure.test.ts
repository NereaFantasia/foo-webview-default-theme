import { describe, expect, it } from 'vitest';
import { classifyHostHttpFailure } from '../../../src/host/hostHttpFailure.ts';

describe('classifyHostHttpFailure', () => {
  it('PERMISSION_DENIED 或其私网地址原文都归 localRelay，没有错误码时原文也算数', () => {
    expect(classifyHostHttpFailure({ text: 'x', code: 'PERMISSION_DENIED' })).toBe('localRelay');
    expect(
      classifyHostHttpFailure({
        text: 'Target host resolves to a private/local network address',
        code: null,
      }),
    ).toBe('localRelay');
    expect(
      classifyHostHttpFailure({
        text: 'Access to local network is disabled. Enable in Advanced Settings if needed.',
        code: null,
      }),
    ).toBe('localRelay');
    expect(
      classifyHostHttpFailure({ text: 'Redirect target is a local network address', code: null }),
    ).toBe('localRelay');
  });

  it('宿主报 DNS 未解析时归 dns，不论错误码是什么', () => {
    expect(
      classifyHostHttpFailure({
        text: 'Send failed: DNS name not resolved',
        code: 'OPERATION_FAILED',
      }),
    ).toBe('dns');
    expect(
      classifyHostHttpFailure({ text: 'Receive failed: DNS name not resolved', code: null }),
    ).toBe('dns');
  });

  it('其余传输失败不认：重置、超时、TLS、SDK 客户端超时', () => {
    expect(
      classifyHostHttpFailure({
        text: 'Receive failed: Connection error (reset or aborted)',
        code: 'OPERATION_FAILED',
      }),
    ).toBeNull();
    expect(
      classifyHostHttpFailure({
        text: 'Send failed: Connection timed out',
        code: 'OPERATION_FAILED',
      }),
    ).toBeNull();
    expect(
      classifyHostHttpFailure({
        text: 'Send failed: TLS/SSL certificate verification failed',
        code: 'OPERATION_FAILED',
      }),
    ).toBeNull();
    expect(
      classifyHostHttpFailure({
        text: 'HTTP request timeout (clientTimeout=17000ms, requestId=http_1)',
        code: null,
      }),
    ).toBeNull();
  });

  it('dns 要整句对上，误伤别的失败不算', () => {
    expect(
      classifyHostHttpFailure({
        text: 'Send failed: Cannot connect to server',
        code: 'OPERATION_FAILED',
      }),
    ).toBeNull();
  });
});
