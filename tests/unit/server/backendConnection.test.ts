import { randomUUID } from 'node:crypto';
import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { startBackendConnection } from '../../../src/server/backendConnection.ts';
import type { BackendDescriptor } from '../../../src/server/backendProtocol.ts';
import { installTemplateHost, TEMPLATE_DIRECTORY } from '../../fixtures/templateHost.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function setup() {
  const env = installTemplateHost();
  const store = createStore();
  const target = {
    directory: TEMPLATE_DIRECTORY,
    executable: `${TEMPLATE_DIRECTORY}\\rt\\node.exe`,
    entry: `${TEMPLATE_DIRECTORY}\\be\\server.cjs`,
    version: '0.1.5',
    installId: randomUUID(),
    sessionId: randomUUID(),
    runtimeVersion: '24.16.0',
    runtimeArch: 'x64',
  };
  let descriptor: BackendDescriptor & typeof target = {
    protocol: 1,
    ...target,
    launchId: randomUUID(),
    pid: 123,
    port: 12345,
    token: 'a'.repeat(64),
  };
  const path = `state/backend-${target.sessionId}.json`;
  const write = () => env.write(path, JSON.stringify(descriptor));
  env.host.answer('shell.spawn', (params) => {
    const args = params['args'];
    if (!Array.isArray(args)) throw new Error('缺少启动参数');
    descriptor = { ...descriptor, launchId: String(args[args.indexOf('--launch-id') + 1]) };
    write();
    env.write(`state/backend-run-${descriptor.launchId}.json`, JSON.stringify(descriptor));
    return { success: true, processId: 123 };
  });
  const fetcher = vi.fn(async () =>
    Response.json({
      ...descriptor,
      runtime: target.runtimeVersion,
      arch: target.runtimeArch,
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const service = startBackendConnection(store, env.host.fb);
  onTestFinished(() => service.dispose());
  return { ...env, store, target, service, write, fetcher, descriptor: () => descriptor };
}

describe('本地后端连接', () => {
  it('有限请求使用当前连接令牌，失败应答不会冒充成功', async () => {
    const env = setup();
    await expect(env.service.request('/plugin/status')).rejects.toThrow('尚未连接');
    await env.service.connect(env.target);
    env.fetcher.mockResolvedValueOnce(Response.json({ success: true }));
    expect(await env.service.request('/plugin/cancel', { id: 'transaction' })).toEqual({
      success: true,
    });
    expect(env.fetcher).toHaveBeenLastCalledWith(
      `http://127.0.0.1:${env.descriptor().port}/plugin/cancel`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.descriptor().token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: 'transaction' }),
      }),
    );
    env.fetcher.mockResolvedValueOnce(Response.json({ error: '执行器已结束' }, { status: 400 }));
    await expect(env.service.request('/plugin/authorize')).rejects.toThrow('执行器已结束');
    await expect(env.service.request('//untrusted')).rejects.toThrow('请求路径');
    env.service.dispose();
    await expect(env.service.request('/plugin/status')).rejects.toThrow('已释放');
  });

  it.each(['释放', '重连'])('读取应答期间%s后不交回旧连接结果', async (action) => {
    const env = setup();
    await env.service.connect(env.target);
    let release: (value: unknown) => void = () => {};
    const body = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const response = Response.json({});
    const reading = vi.spyOn(response, 'json').mockReturnValue(body);
    env.fetcher.mockResolvedValueOnce(response);
    const pending = env.service.request('/plugin/status');
    const rejected = expect(pending).rejects.toThrow(action === '释放' ? '已释放' : '已改变');
    await vi.waitFor(() => expect(reading).toHaveBeenCalled());
    if (action === '释放') env.service.dispose();
    else await env.service.connect(env.target);
    release({ success: true });
    await rejected;
  });

  it('同一目标并发连接共用启动，身份一致才就绪，释放写本进程停止标记', async () => {
    const env = setup();
    const [first, second] = await Promise.all([
      env.service.connect(env.target),
      env.service.connect(env.target),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ version: '0.1.5', pid: 123 });
    expect(first).not.toHaveProperty('token');
    expect(env.host.callsTo('shell.spawn')).toHaveLength(1);
    env.service.dispose();
    await vi.waitFor(() =>
      expect(env.text(`state/backend-stop-${first.launchId}.json`)).toBe('{}'),
    );
  });

  it('复用健康的同一运行目录，不重复启动', async () => {
    const env = setup();
    env.write();
    const answer = await env.service.connect(env.target);
    expect(answer.launchId).toBe(env.descriptor().launchId);
    expect(env.host.callsTo('shell.spawn')).toHaveLength(0);
  });

  it('迟到的旧定位记录不会盖掉已经握手的启动身份', async () => {
    const env = setup();
    const first = await env.service.connect(env.target);
    env.files.set(
      `state/backend-${env.target.sessionId}.json`,
      new TextEncoder().encode(
        JSON.stringify({
          ...env.descriptor(),
          launchId: randomUUID(),
        }),
      ),
    );
    const again = await env.service.connect(env.target);
    expect(again.launchId).toBe(first.launchId);
    expect(env.host.callsTo('shell.spawn')).toHaveLength(1);
  });

  it('释放时启动尚未应答，迟到进程仍有自己的停止标记', async () => {
    const env = setup();
    const held = env.host.hold('shell.spawn');
    const pending = env.service.connect(env.target);
    const rejected = expect(pending).rejects.toThrow('释放');
    await vi.waitFor(() => expect(held.pending.length).toBe(1));
    env.service.dispose();
    held.release();
    await rejected;
    expect(env.text(`state/backend-stop-${env.descriptor().launchId}.json`)).toBe('{}');
    expect(env.store.get(env.service.failed)).toBe(false);
  });

  it('健康检查失败可重试，成功后清除失败状态', async () => {
    vi.useFakeTimers();
    const env = setup();
    await env.service.connect(env.target);
    env.fetcher.mockRejectedValueOnce(new Error('连接中断'));
    await vi.advanceTimersByTimeAsync(10000);
    expect(env.store.get(env.service.failed)).toBe(true);
    await env.service.connect(env.target);
    expect(env.store.get(env.service.failed)).toBe(false);
  });
});
