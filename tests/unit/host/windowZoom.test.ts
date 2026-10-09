import { createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import { startWindowZoom, windowZoomAtom, ZOOM_STORAGE_KEY } from '../../../src/host/windowZoom.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

function setup(saved = '0') {
  const host = installFakeHost();
  const state = new Map<string, number>();
  const storageValues = new Map([[ZOOM_STORAGE_KEY, saved]]);
  const storage = {
    getItem: (key: string) => storageValues.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageValues.set(key, value);
    },
  };
  let zoom = 1.1;
  host.answer('window.getZoom', () => ({ success: true, zoom }));
  host.answer('window.setZoom', (params) => {
    if (typeof params['zoom'] !== 'number') throw new Error('缩放倍数应为数字');
    zoom = params['zoom'];
    return { success: true, zoom };
  });
  host.answer('state.get', (params) => {
    const key = String(params['key']);
    return { success: true, exists: state.has(key), value: state.get(key) ?? null };
  });
  host.answer('state.set', (params) => {
    if (typeof params['value'] !== 'number') throw new Error('初始缩放应为数字');
    state.set(String(params['key']), params['value']);
    return { success: true };
  });
  const store = createStore();
  const service = startWindowZoom(store, host.fb, storage);
  return { host, store, service, storage, storageValues, zoom: () => zoom };
}

describe('窗口缩放', () => {
  it('初始值无法留存在进程状态时不覆盖宿主缩放', async () => {
    const env = setup('150');
    env.host.answer('state.set', hostFailure('OPERATION_FAILED'));
    await env.service.ready;
    expect(env.store.get(windowZoomAtom).status).toBe('failed');
    expect(env.zoom()).toBe(1.1);
    expect(env.host.callsTo('window.setZoom')).toEqual([]);
    env.service.dispose();
  });

  it('初读期间释放，迟到结果不会触发缩放或缓存写入', async () => {
    const env = setup('150');
    const held = env.host.hold('window.getZoom');
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    env.service.dispose();
    held.respond(0);
    await env.service.ready;
    expect(env.host.callsTo('window.setZoom')).toEqual([]);
    expect(env.host.callsTo('state.set')).toEqual([]);
  });

  it('缺省不覆盖宿主缩放；显式选择保存，页面重载后仍恢复原始默认值', async () => {
    const env = setup();
    await env.service.ready;
    expect(env.zoom()).toBe(1.1);
    expect(env.host.callsTo('window.setZoom')).toEqual([]);
    env.service.choose(150);
    await vi.waitFor(() => expect(env.store.get(windowZoomAtom).choice).toBe(150));
    expect(env.storageValues.get(ZOOM_STORAGE_KEY)).toBe('150');
    env.service.dispose();
    const nextStore = createStore();
    const next = startWindowZoom(nextStore, env.host.fb, env.storage);
    await next.ready;
    next.choose(0);
    await vi.waitFor(() => expect(nextStore.get(windowZoomAtom).choice).toBe(0));
    expect(env.zoom()).toBe(1.1);
    expect(env.storageValues.get(ZOOM_STORAGE_KEY)).toBe('0');
    next.dispose();
  });

  it('设置失败回读实际档位，不保存失败的选择', async () => {
    const env = setup('125');
    await env.service.ready;
    env.host.answer('window.setZoom', hostFailure('OPERATION_FAILED'));
    env.service.choose(200);
    await vi.waitFor(() => expect(env.store.get(windowZoomAtom).failed).toBe(true));
    expect(env.store.get(windowZoomAtom)).toMatchObject({ choice: 125, pending: false });
    expect(env.storageValues.get(ZOOM_STORAGE_KEY)).toBe('125');
    env.service.dispose();
  });

  it('初始设置失败且回读失败时保留已知的宿主缩放', async () => {
    const env = setup('150');
    env.host.answer('window.setZoom', () => {
      env.host.answer('window.getZoom', hostFailure('OPERATION_FAILED'));
      return hostFailure('OPERATION_FAILED');
    });
    await env.service.ready;
    expect(env.store.get(windowZoomAtom)).toMatchObject({ choice: 0, failed: true });
    expect(env.storageValues.get(ZOOM_STORAGE_KEY)).toBe('150');
    env.service.dispose();
  });

  it('请求串行，下发期间的新选择最后生效，旧值不保存', async () => {
    const env = setup();
    await env.service.ready;
    const held = env.host.hold('window.setZoom');
    env.service.choose(125);
    env.service.choose(175);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    held.respond(0);
    await vi.waitFor(() => expect(held.pending[0]?.['zoom']).toBe(1.75));
    expect(env.storageValues.get(ZOOM_STORAGE_KEY)).toBe('0');
    held.respond(0);
    await vi.waitFor(() => expect(env.store.get(windowZoomAtom).choice).toBe(175));
    expect(env.zoom()).toBe(1.75);
    env.service.dispose();
  });

  it('释放后到达的设置结果不写存档，也不继续发送排队项', async () => {
    const env = setup();
    await env.service.ready;
    const held = env.host.hold('window.setZoom');
    env.service.choose(125);
    env.service.choose(175);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    env.service.dispose();
    held.respond(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(env.storageValues.get(ZOOM_STORAGE_KEY)).toBe('0');
    expect(env.host.callsTo('window.setZoom')).toEqual([{ zoom: 1.25 }]);
  });
});
