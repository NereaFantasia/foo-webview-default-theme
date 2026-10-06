import { describe, expect, it } from 'vitest';
import { createConfigWriter } from '../../../src/host/configWrite.ts';
import { DATA_GENERATION_KEY, DATA_GENERATION_PREFIX } from '../../../src/kit/dataWrite.ts';
import { createMemoryDataWriter } from '../../fixtures/dataWriter.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const KEY = 'defaultTheme.locale';
const GENERATION = `${DATA_GENERATION_PREFIX}config:${KEY}`;

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('宿主配置写入', () => {
  it('成功写入和清除都记代数，已不存在的键再次清除也记录用户意图', async () => {
    const host = installFakeHost();
    const { writer, values } = createMemoryDataWriter();
    const config = createConfigWriter(host.fb, writer);
    expect(await config.set(KEY, 'zh-CN')).toEqual({ success: true, value: 1 });
    expect(host.config.get(KEY)).toBe('zh-CN');
    expect(values.get(GENERATION)).toBe('1');
    expect(await config.remove(KEY)).toEqual({ success: true, value: 2 });
    expect(host.config.has(KEY)).toBe(false);
    expect(await config.remove(KEY)).toEqual({ success: true, value: 3 });
    expect(values.get(GENERATION)).toBe('3');
  });

  it.each(['failure', 'reject'] as const)(
    '宿主返回 %s 时不推进代数，之后仍能重试',
    async (mode) => {
      const host = installFakeHost({ config: { [KEY]: 'en' } });
      const { writer, values } = createMemoryDataWriter();
      const config = createConfigWriter(host.fb, writer);
      host.answer('config.set', () => {
        if (mode === 'reject') throw new Error('disconnected');
        return hostFailure('OPERATION_FAILED');
      });
      expect(await config.set(KEY, 'zh-CN')).toEqual({ success: false, reason: 'write-failed' });
      expect(host.config.get(KEY)).toBe('en');
      expect(values.size).toBe(0);
      expect(await config.remove(KEY)).toEqual({ success: true, value: 1 });
      expect(host.config.has(KEY)).toBe(false);
      expect(values.get(GENERATION)).toBe('1');
    },
  );

  it('写入成功但代数保存失败时报告失败，不把它当成完整成功', async () => {
    const host = installFakeHost();
    const { writer, storage, values } = createMemoryDataWriter();
    const write = storage.setItem;
    storage.setItem = async (key, value) => {
      if (key === GENERATION) throw new Error('storage full');
      await write(key, value);
    };
    expect(await createConfigWriter(host.fb, writer).set(KEY, 'zh-CN')).toEqual({
      success: false,
      reason: 'write-failed',
    });
    expect(host.config.get(KEY)).toBe('zh-CN');
    expect(values.get(DATA_GENERATION_KEY)).toBe('1');
    expect(values.has(GENERATION)).toBe(false);
  });

  it('存储代数损坏时不下发宿主写入', async () => {
    const host = installFakeHost({ config: { [KEY]: 'en' } });
    const { writer } = createMemoryDataWriter({ [DATA_GENERATION_KEY]: 'broken' });
    expect(await createConfigWriter(host.fb, writer).set(KEY, 'zh-CN')).toEqual({
      success: false,
      reason: 'invalid-generation',
    });
    expect(host.config.get(KEY)).toBe('en');
  });

  it('没有写入助手或键为空时明确失败，不直接写宿主', async () => {
    const host = installFakeHost({ config: { [KEY]: 'en' } });
    const config = createConfigWriter(host.fb, undefined);
    expect(await config.set(KEY, 'zh-CN')).toEqual({ success: false, reason: 'unavailable' });
    expect(await config.remove(KEY)).toEqual({ success: false, reason: 'unavailable' });
    expect(await config.set('', 'zh-CN')).toEqual({ success: false, reason: 'invalid-key' });
    expect(host.config.get(KEY)).toBe('en');
    expect(host.calls).toEqual([]);
  });

  it('宿主应答未到时后续清除保持等待，不会先记代数', async () => {
    const host = installFakeHost({ config: { [KEY]: 'en' } });
    const { writer, values } = createMemoryDataWriter();
    const entered = gate();
    const response = gate();
    host.answer('config.set', async () => {
      entered.release();
      await response.promise;
      host.config.set(KEY, 'zh-CN');
      return { success: true, key: KEY };
    });
    const config = createConfigWriter(host.fb, writer);
    const first = config.set(KEY, 'zh-CN');
    await entered.promise;
    const second = config.remove(KEY);
    expect(values.size).toBe(0);
    expect(host.config.get(KEY)).toBe('en');
    response.release();
    expect(await first).toEqual({ success: true, value: 1 });
    expect(await second).toEqual({ success: true, value: 2 });
    expect(host.config.has(KEY)).toBe(false);
    expect(values.get(GENERATION)).toBe('2');
  });

  it('等锁期间对象被修改时仍写发起操作时的快照', async () => {
    const host = installFakeHost();
    const { writer } = createMemoryDataWriter();
    const entered = gate();
    const release = gate();
    const blocker = writer.run(async () => {
      entered.release();
      await release.promise;
    });
    await entered.promise;
    const value = { language: 'en' };
    const pending = createConfigWriter(host.fb, writer).set(KEY, value);
    value.language = 'zh-CN';
    release.release();
    await blocker;
    expect(await pending).toEqual({ success: true, value: 1 });
    expect(host.config.get(KEY)).toEqual({ language: 'en' });
  });
});
