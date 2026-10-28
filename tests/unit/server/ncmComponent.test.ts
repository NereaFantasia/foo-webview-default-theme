import { describe, expect, it } from 'vitest';
import { readNcmComponentState } from '../../../src/server/ncmComponent.ts';

const PACKAGE = {
  version: '4.41.1',
  size: 17465672,
  unpackedSize: 36985384,
  licenses: ['LGPL-3.0-only', 'MIT'],
};
const STATE = { package: PACKAGE, phase: 'downloading', received: 4096, failure: null };

describe('网易云组件状态读取', () => {
  it('重建公开字段，额外字段不带出来', () => {
    const extra = { ...STATE, url: 'https://private', package: { ...PACKAGE, sha256: 'x' } };
    expect(readNcmComponentState(extra)).toEqual(STATE);
    const unregistered = { package: null, phase: 'installed', received: 0, failure: null };
    expect(readNcmComponentState(unregistered)).toEqual(unregistered);
    const failed = { ...STATE, phase: 'missing', failure: 'verify' };
    expect(readNcmComponentState(failed)).toEqual(failed);
  });

  it.each([
    { phase: 'loaded' },
    { failure: 'network' },
    { received: -1 },
    { received: PACKAGE.size + 1 },
    { package: null },
    { package: { ...PACKAGE, version: 'latest' } },
    { package: { ...PACKAGE, size: 1.5 } },
    { package: { ...PACKAGE, licenses: [''] } },
    { package: { ...PACKAGE, licenses: 'MIT' } },
  ])('拒绝不合法的状态 %#', (patch) => {
    expect(readNcmComponentState({ ...STATE, ...patch })).toBeNull();
  });
});
