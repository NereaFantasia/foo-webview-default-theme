import { describe, expect, it } from 'vitest';
import {
  confirmedPointer,
  loadedVersion,
  readPointer,
  type LoaderSession,
} from '../../../src/update/loaderContract.ts';

const CURRENT = { v: '0.1.0', dir: '0.1.0' };
const OLD = { v: '0.0.9', dir: '0.0.9' };
const NEXT = { v: '0.2.0', dir: '0.2.0_abcdef' };
const SESSION: LoaderSession = {
  schema: 1,
  loader: 1,
  sessionId: '11111111-1111-4111-8111-111111111111',
  version: CURRENT,
  skipped: [],
};
function confirm(frontend: Record<string, unknown>, session = SESSION) {
  const pointer = readPointer({ schema: 3, extra: 'keep', frontend });
  if (!pointer) throw new Error('指针无效');
  return confirmedPointer(pointer, session);
}
describe('版本确认后的指针', () => {
  it('待确认版成为当前版，原当前版成为上一版，未知字段保留', () => {
    expect(confirm({ pending: CURRENT, version: OLD, extra: true })).toEqual({
      schema: 3,
      extra: 'keep',
      frontend: { version: CURRENT, previous: OLD, extra: true },
    });
  });
  it('会话仍在当前版时，不移除运行中刚装好的 pending', () => {
    expect(confirm({ version: CURRENT, pending: NEXT, previous: OLD })).toEqual({
      schema: 3,
      extra: 'keep',
      frontend: { version: CURRENT, pending: NEXT, previous: OLD },
    });
  });
  it('回退后移除跳过的引用，旧会话不能覆盖一个没有跳过的新当前版', () => {
    expect(confirm({ version: NEXT, previous: CURRENT }, { ...SESSION, skipped: [NEXT] })).toEqual({
      schema: 3,
      extra: 'keep',
      frontend: { version: CURRENT },
    });
    expect(confirm({ version: NEXT, previous: CURRENT })).toBeNull();
    expect(confirm({ version: OLD })).toBeNull();
  });
  it('只有版本目录的入口才参与启动确认，其他路径不触碰更新状态', () => {
    expect(
      loadedVersion(new URL('https://foo-ui-webview2.local/fe/0.1.0/index.html?windowId=popup')),
    ).toEqual(CURRENT);
    for (const path of ['/', '/index.html', '/dist/fe/0.1.0/index.html', '/fe/%2e%2e/index.html'])
      expect(loadedVersion(new URL(`https://foo-ui-webview2.local${path}`))).toBeNull();
  });
});
