import { describe, expect, it } from 'vitest';
import {
  MANUAL_BACKEND_PREF,
  readManualBackend,
  readManualBackendQuery,
  readManualBackendStored,
} from '../../../src/server/manualBackend.ts';

const TOKEN = 'a'.repeat(64);

function storage(entries: Record<string, string> = {}) {
  return {
    getItem: (key: string) => entries[key] ?? null,
    setItem: (key: string, value: string) => {
      entries[key] = value;
    },
    entries,
  };
}

describe('手动后端的读取', () => {
  it('URL 参数优先，顺手写进偏好；之后没有参数时读偏好', () => {
    const store = storage();
    const target = readManualBackend(
      new URL(`http://localhost/?manual-backend=5191:${TOKEN}`),
      store,
    );
    expect(target).toEqual({ port: 5191, token: TOKEN });
    expect(store.entries[MANUAL_BACKEND_PREF]).toBe(`5191:${TOKEN}`);
    expect(readManualBackend(new URL('http://localhost/'), store)).toEqual({
      port: 5191,
      token: TOKEN,
    });
  });

  it('参数无效时不覆盖偏好；偏好无效时答 null', () => {
    const store = storage({ [MANUAL_BACKEND_PREF]: `5191:${TOKEN}` });
    expect(readManualBackend(new URL('http://localhost/?manual-backend=nope'), store)).toEqual({
      port: 5191,
      token: TOKEN,
    });
    expect(store.entries[MANUAL_BACKEND_PREF]).toBe(`5191:${TOKEN}`);
    expect(readManualBackend(new URL('http://localhost/'), storage())).toBeNull();
    expect(
      readManualBackend(new URL('http://localhost/'), storage({ [MANUAL_BACKEND_PREF]: TOKEN })),
    ).toBeNull();
    expect(
      readManualBackend(
        new URL('http://localhost/'),
        storage({ [MANUAL_BACKEND_PREF]: `70000:${TOKEN}` }),
      ),
    ).toBeNull();
    expect(
      readManualBackend(
        new URL('http://localhost/'),
        storage({ [MANUAL_BACKEND_PREF]: `5191:${'A'.repeat(64)}` }),
      ),
    ).toBeNull();
  });

  it('没有偏好存储时只用 URL 参数', () => {
    expect(
      readManualBackend(new URL(`http://localhost/?manual-backend=5191:${TOKEN}`), null),
    ).toEqual({ port: 5191, token: TOKEN });
    expect(readManualBackend(new URL('http://localhost/'), null)).toBeNull();
  });

  it('分开读 URL 与偏好：自动拉起失败时只回退到偏好', () => {
    const store = storage({ [MANUAL_BACKEND_PREF]: `5191:${TOKEN}` });
    expect(readManualBackendQuery(new URL('http://localhost/'))).toBeNull();
    expect(readManualBackendStored(store)).toEqual({ port: 5191, token: TOKEN });
    expect(readManualBackendStored(null)).toBeNull();
  });
});
