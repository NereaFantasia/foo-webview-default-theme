import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { hostCommand, onMissingMethod, settle } from '../../../src/host/hostCall.ts';
import { hostFailure, methodNotFound } from '../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('settle', () => {
  it('成功应答与失败信封原样交回', async () => {
    const host = installFakeHost();
    await expect(settle(() => host.fb.library.isEnabled())).resolves.toEqual({
      success: true,
      enabled: true,
    });
    host.answer('library.isEnabled', hostFailure('LIBRARY_DISABLED'));
    await expect(settle(() => host.fb.library.isEnabled())).resolves.toEqual(
      hostFailure('LIBRARY_DISABLED'),
    );
  });

  it('调用 reject 时答 null', async () => {
    const host = installFakeHost();
    host.answer('library.isEnabled', () => {
      throw new Error('timeout');
    });
    await expect(settle(() => host.fb.library.isEnabled())).resolves.toBeNull();
  });

  it('宿主不在时 SDK 答的 NOT_SUPPORTED 信封原样交回', async () => {
    vi.useFakeTimers();
    const host = installFakeHost({ available: false });
    const pending = settle(() => host.fb.library.isEnabled());
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toMatchObject({ success: false, code: 'NOT_SUPPORTED' });
    expect(host.calls).toEqual([]);
  });

  it('任何应答都原样交回', async () => {
    await expect(settle(async () => ({ mock: true, value: 1 }))).resolves.toEqual({
      mock: true,
      value: 1,
    });
    await expect(settle(async () => null)).resolves.toBeNull();
    await expect(settle(async () => [1, 2])).resolves.toEqual([1, 2]);
  });
});

describe('onMissingMethod', () => {
  function listen() {
    const heard: (string | null)[] = [];
    onTestFinished(onMissingMethod((method) => heard.push(method)));
    return heard;
  }

  it('宿主不认的方法 reject 时：settle 照旧答 null，收听者拿到方法名', async () => {
    const host = installFakeHost();
    host.answer('config.getOutputDevices', () => {
      throw methodNotFound('config.getOutputDevices');
    });
    const heard = listen();
    await expect(settle(() => host.fb.config.getOutputDevices())).resolves.toBeNull();
    expect(heard).toEqual(['config.getOutputDevices']);
  });

  it('失败信封带这个码也报；hostCommand 同样报', async () => {
    const heard = listen();
    const envelope = hostFailure('METHOD_NOT_FOUND', 'Method not found: output.getEntries');
    await expect(settle(async () => envelope)).resolves.toEqual(envelope);
    expect(
      await hostCommand(async () => {
        throw methodNotFound('ui.setMaximizeButtonRegion');
      }),
    ).toBe(false);
    expect(heard).toEqual(['output.getEntries', 'ui.setMaximizeButtonRegion']);
  });

  it('认不出方法名时报 null，原文不往外带', async () => {
    const heard = listen();
    const odd = Object.assign(new Error('Method not found: E:\\Music\\a.flac'), {
      code: 'METHOD_NOT_FOUND',
    });
    await settle(async () => {
      throw odd;
    });
    expect(heard).toEqual([null]);
  });

  it('别的失败不报：失败信封、超时、宿主不在时的 NOT_SUPPORTED', async () => {
    vi.useFakeTimers();
    const heard = listen();
    await settle(async () => hostFailure('INVALID_PARAMS'));
    await settle(async () => {
      throw new Error('Request timeout');
    });
    const host = installFakeHost({ available: false });
    const pending = settle(() => host.fb.config.getOutputDevices());
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(heard).toEqual([]);
  });

  it('摘掉之后不再收', async () => {
    const heard: (string | null)[] = [];
    const off = onMissingMethod((method) => heard.push(method));
    off();
    await settle(async () => {
      throw methodNotFound('config.getOutputDevices');
    });
    expect(heard).toEqual([]);
  });

  it('收听者抛错时 settle 照样作答，错误改到下一个微任务里抛', async () => {
    onTestFinished(
      onMissingMethod(() => {
        throw new Error('listener broke');
      }),
    );
    // 只在这一次调用期间截下排进微任务的函数，免得真抛出来算成测试之外的错误。
    const deferred: (() => void)[] = [];
    const spy = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => {
      deferred.push(task);
    });
    const answer = await settle(async () => {
      throw methodNotFound('config.getOutputDevices');
    });
    spy.mockRestore();
    expect(answer).toBeNull();
    expect(deferred).toHaveLength(1);
    expect(() => deferred[0]?.()).toThrow('listener broke');
  });
});

describe('hostCommand', () => {
  it('拿到 success: true 才为真', async () => {
    expect(await hostCommand(async () => ({ success: true }))).toBe(true);
    expect(await hostCommand(async () => hostFailure('LOCKED'))).toBe(false);
    expect(
      await hostCommand(async () => {
        throw new Error('bridge gone');
      }),
    ).toBe(false);
  });
});
