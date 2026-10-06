import { describe, expect, it } from 'vitest';
import {
  attempts,
  candidates,
  installed,
  readAttempts,
  readSession,
  selectVersion,
  setAttempts,
  versionRef,
  type LoaderSession,
} from '../../../src/boot/loader.ts';
import * as app from '../../../src/update/loaderContract.ts';

const CURRENT = { v: '0.1.0', dir: '0.1.0' };
const PENDING = { v: '0.2.0', dir: '0.2.0_abc123' };
const PREVIOUS = { v: '0.0.9', dir: '0.0.9_zyx123' };
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION: LoaderSession = {
  schema: 1,
  sessionId: OTHER,
  version: CURRENT,
  loader: 1,
  skipped: [],
};

describe('引导页选版', () => {
  it('按 pending、version、previous 取完整目录；连续失败三次才跳过', () => {
    const refs = candidates({
      schema: 99,
      frontend: { version: CURRENT, pending: PENDING, previous: PREVIOUS },
    });
    expect(refs).toEqual([PENDING, CURRENT, PREVIOUS]);
    if (!refs) throw new Error('指针应有效');
    const complete = new Set(refs.map((ref) => ref.dir));
    let ledger = readAttempts(null);
    expect(selectVersion(refs, null, ledger, ID, complete)?.version).toEqual(PENDING);
    ledger = setAttempts(ledger, ID, PENDING.dir, 2);
    expect(selectVersion(refs, null, ledger, ID, complete)?.version).toEqual(PENDING);
    ledger = setAttempts(ledger, ID, PENDING.dir, 3);
    expect(selectVersion(refs, null, ledger, ID, complete)).toEqual({
      version: CURRENT,
      reused: false,
      skipped: [PENDING],
    });
    complete.delete(CURRENT.dir);
    expect(selectVersion(refs, null, ledger, ID, complete)).toEqual({
      version: PREVIOUS,
      reused: false,
      skipped: [PENDING, CURRENT],
    });
    complete.clear();
    expect(selectVersion(refs, null, ledger, ID, complete)).toBeNull();
  });

  it('同一会话沿用原版本，即使指针已经有新的 pending；丢失目录则重选', () => {
    const refs = [PENDING, CURRENT];
    const ledger = setAttempts(readAttempts(null), ID, CURRENT.dir, 3);
    expect(selectVersion(refs, SESSION, ledger, ID, new Set(refs.map((ref) => ref.dir)))).toEqual({
      version: CURRENT,
      reused: true,
      skipped: [],
    });
    expect(selectVersion(refs, SESSION, ledger, ID, new Set([PENDING.dir]))?.version).toEqual(
      PENDING,
    );
  });

  it('启动计数按安装和目录隔离，更新时保留其他记录及扩展字段', () => {
    const initial = readAttempts({
      schema: 1,
      extra: 'keep',
      installations: { [OTHER]: { [CURRENT.dir]: 2 } },
    });
    const next = setAttempts(initial, ID, CURRENT.dir, 3);
    expect(attempts(initial, ID, CURRENT.dir)).toBe(0);
    expect(attempts(next, OTHER, CURRENT.dir)).toBe(2);
    expect(next.extra).toBe('keep');
    expect(selectVersion([CURRENT], null, next, OTHER, new Set([CURRENT.dir]))?.version).toEqual(
      CURRENT,
    );
    expect(selectVersion([CURRENT], null, next, ID, new Set([CURRENT.dir]))).toBeNull();
  });

  it('不把目录名、入口哈希或版本不符的标记当成完整安装', () => {
    const value = { schema: 1, version: CURRENT.v, files: { 'index.html': 'a'.repeat(64) } };
    expect(installed(value, CURRENT)).toBe(true);
    expect(installed(value, PENDING)).toBe(false);
    expect(installed({ ...value, files: { 'index.html': 'invalid' } }, CURRENT)).toBe(false);
    expect(installed(null, CURRENT)).toBe(false);
  });
});

describe('两端的永久交接格式', () => {
  it('保留将来增加的字段，不接受缺少 schema 的指针', () => {
    const raw = { ...SESSION, future: { keep: true }, version: { ...CURRENT, futureVersion: 1 } };
    expect(readSession(raw)).toEqual(raw);
    expect(app.readSession(raw)).toEqual(raw);
    expect(readSession({ ...SESSION, skipped: [CURRENT] })).toBeNull();
    expect(app.readSession({ ...SESSION, skipped: [PENDING, PENDING] })).toBeNull();
    expect(candidates({ frontend: { version: CURRENT } })).toBeNull();
    expect(app.readPointer({ schema: '1', frontend: { version: CURRENT } })).toBeNull();
  });
  it.each([
    '../0.1.0',
    '/0.1.0',
    '0.1.0/../x',
    '0.1.0_%2e%2e',
    '0.1.0_ABC123',
    '0.1.0_abc12',
    'C:\\x',
    '0.1.0_中文',
  ])('拒绝不可信目录 %s', (dir) => {
    expect(versionRef({ v: CURRENT.v, dir })).toBeNull();
    expect(app.versionRef({ v: CURRENT.v, dir })).toBeNull();
  });
  it('引导页与应用对有效会话和非法会话给出同样的解释', () => {
    for (const value of [
      SESSION,
      { ...SESSION, skipped: [PENDING] },
      { ...SESSION, loader: 0 },
      { ...SESSION, sessionId: 'bad' },
      { ...SESSION, skipped: 'bad' },
      { ...SESSION, skipped: [{}] },
      null,
    ])
      expect(readSession(value)).toEqual(app.readSession(value));
    expect(readSession(SESSION)).toEqual(SESSION);
    expect(readSession({ ...SESSION, skipped: 'bad' })).toBeNull();
  });
  it('两端保留同一份有效计数，忽略非法计数', () => {
    const raw = {
      schema: 1,
      extra: true,
      installations: { [ID]: { one: 2, negative: -1, text: '3', float: 1.5 } },
    };
    expect(readAttempts(raw)).toEqual(app.readAttempts(raw));
    expect(readAttempts(raw).installations[ID]).toEqual({ one: 2 });
    const ledger = readAttempts(raw);
    expect(setAttempts(ledger, ID, CURRENT.dir, 0)).toEqual(
      app.setAttempts(ledger, ID, CURRENT.dir, 0),
    );
  });
});
