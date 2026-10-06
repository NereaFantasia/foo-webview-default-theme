import { describe, expect, it } from 'vitest';
import {
  createDataWriter,
  type DataFormat,
  type DataWriteOptions,
  type DataWriteScope,
} from '../../../src/kit/dataWrite.ts';

const KEY = 'default-theme.sample.v2';
const OLD_KEY = 'default-theme.sample.v1';
const COUNTER = 'default-theme.data-gen.v1';
const PREFIX = `${COUNTER}.`;

function memory(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  const storage: NonNullable<DataWriteOptions['storage']> = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
  return { values, storage };
}

function gate() {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function writer(storage: DataWriteOptions['storage'], now: () => number = () => 1000) {
  return createDataWriter({ storage, now, locks: navigator.locks });
}

describe('写入与代数', () => {
  it('写值后记录代数，时钟回拨时仍继续增加', async () => {
    const { storage, values } = memory();
    let clock = 1000;
    const data = writer(storage, () => clock);
    expect(await data.run((scope) => scope.setLocal(KEY, 'first'))).toEqual({
      success: true,
      value: 1000,
    });
    clock = 10;
    expect(await data.run((scope) => scope.setLocal(KEY, 'second'))).toEqual({
      success: true,
      value: 1001,
    });
    expect(values.get(KEY)).toBe('second');
    expect(values.get(COUNTER)).toBe('1001');
    expect(values.get(`${PREFIX}${KEY}`)).toBe('1001');
  });

  it('用户清除键也记代数，旧格式保留且不能重新成为迁移源', async () => {
    const { storage, values } = memory({
      [KEY]: 'new',
      [OLD_KEY]: 'old',
      [`${PREFIX}${OLD_KEY}`]: '20',
    });
    const data = writer(storage);
    const current: DataFormat = { id: 'v2', keys: [KEY], hasValue: false };
    const previous: DataFormat = { id: 'v1', keys: [OLD_KEY], hasValue: true };
    expect(
      await data.run(async (scope) => {
        await scope.setLocal(KEY, null);
        return scope.latestFormat(current, [previous]);
      }),
    ).toEqual({ success: true, value: current });
    expect(values.has(KEY)).toBe(false);
    expect(values.get(OLD_KEY)).toBe('old');
    expect(values.get(`${PREFIX}${KEY}`)).toBe('1000');
  });

  it('按一组键的最大代数选格式，平代数时保留当前格式', async () => {
    const { storage } = memory({ [`${PREFIX}${KEY}`]: '7', [`${PREFIX}${OLD_KEY}`]: '8' });
    const current: DataFormat = {
      id: 'v2',
      keys: [KEY, 'default-theme.other.v2'],
      hasValue: false,
    };
    const previous: DataFormat = { id: 'v1', keys: [OLD_KEY], hasValue: false };
    const data = writer(storage);
    expect(await data.run((scope) => scope.latestFormat(current, [previous]))).toEqual({
      success: true,
      value: previous,
    });
    await storage.setItem(`${PREFIX}${KEY}`, '8');
    expect(await data.run((scope) => scope.latestFormat(current, [previous]))).toEqual({
      success: true,
      value: current,
    });
  });

  it('外部写入返回失败时不推进代数，下一次仍能写', async () => {
    const { storage, values } = memory({ [COUNTER]: '20' });
    const data = writer(storage);
    expect(
      await data.run((scope) => scope.write('config:defaultTheme.locale', () => false)),
    ).toEqual({ success: false, reason: 'write-failed' });
    expect(values.get(COUNTER)).toBe('20');
    expect(values.has(`${PREFIX}config:defaultTheme.locale`)).toBe(false);
    expect(await data.run((scope) => scope.setLocal(KEY, 'saved'))).toEqual({
      success: true,
      value: 1000,
    });
  });

  it.each([false, true])(
    '旧数据尚未记代数时，按当前值是否存在选择迁移源：%s',
    async (hasCurrent) => {
      const { storage } = memory({ [OLD_KEY]: 'old', ...(hasCurrent ? { [KEY]: 'current' } : {}) });
      const data = writer(storage);
      const selected = await data.run(async (scope) => {
        const current: DataFormat = {
          id: 'v2',
          keys: [KEY],
          hasValue: (await scope.readLocal(KEY)) !== null,
        };
        const previous: DataFormat = {
          id: 'v1',
          keys: [OLD_KEY],
          hasValue: (await scope.readLocal(OLD_KEY)) !== null,
        };
        return (await scope.latestFormat(current, [previous])).id;
      });
      expect(selected).toEqual({ success: true, value: hasCurrent ? 'v2' : 'v1' });
    },
  );

  it('代数写入失败不能把已经写值的操作报告为成功', async () => {
    const { storage, values } = memory();
    const broken = {
      ...storage,
      async setItem(key: string, value: string) {
        if (key.startsWith(PREFIX)) throw new Error('storage full');
        await storage.setItem(key, value);
      },
    };
    expect(await writer(broken).run((scope) => scope.setLocal(KEY, 'saved'))).toEqual({
      success: false,
      reason: 'write-failed',
    });
    expect(values.get(KEY)).toBe('saved');
    expect(values.has(`${PREFIX}${KEY}`)).toBe(false);
  });

  it.each(['-1', '1.5', '01', 'NaN', '9007199254740992', '9007199254740991'])(
    '拒绝坏计数或溢出 %s，不先写值',
    async (raw) => {
      const { storage, values } = memory({ [COUNTER]: raw, [KEY]: 'old' });
      expect(await writer(storage).run((scope) => scope.setLocal(KEY, 'new'))).toEqual({
        success: false,
        reason: 'invalid-generation',
      });
      expect(values.get(KEY)).toBe('old');
    },
  );

  it('不会把坏的分键代数当作零来选择旧格式', async () => {
    const { storage } = memory({ [`${PREFIX}${KEY}`]: 'broken' });
    expect(await writer(storage).run((scope) => scope.generation(KEY))).toEqual({
      success: false,
      reason: 'invalid-generation',
    });
  });

  it.each([NaN, Infinity, -1, 1.5])('拒绝无法记为安全整数的时钟 %s', async (clock) => {
    const { storage, values } = memory();
    expect(await writer(storage, () => clock).run((scope) => scope.setLocal(KEY, 'new'))).toEqual({
      success: false,
      reason: 'invalid-generation',
    });
    expect(values.has(KEY)).toBe(false);
  });

  it.each(['', COUNTER, `${PREFIX}reserved`])('不允许业务键覆盖代数存储：%s', async (key) => {
    const { storage, values } = memory();
    expect(await writer(storage).run((scope) => scope.setLocal(key, 'new'))).toEqual({
      success: false,
      reason: 'invalid-key',
    });
    expect(values.size).toBe(0);
  });

  it('锁或存储不可用时不会执行写入回调', async () => {
    const { storage, values } = memory();
    const withoutLocks = createDataWriter({ storage, locks: null });
    const withoutStorage = createDataWriter({ storage: null, locks: navigator.locks });
    for (const data of [withoutLocks, withoutStorage]) {
      expect(await data.run((scope) => scope.setLocal(KEY, 'new'))).toEqual({
        success: false,
        reason: 'unavailable',
      });
    }
    expect(values.size).toBe(0);
  });
});

describe('共享锁与生命周期', () => {
  it('分键代数尚未提交时不释放锁，后续写入会读取新的全局代数', async () => {
    const { storage, values } = memory();
    const entered = gate();
    const finish = gate();
    const delayed = {
      ...storage,
      async setItem(key: string, value: string) {
        if (key === `${PREFIX}${KEY}`) {
          entered.release();
          await finish.promise;
        }
        await storage.setItem(key, value);
      },
    };
    const first = writer(delayed, () => 0).run((scope) => scope.setLocal(KEY, 'first'));
    await entered.promise;
    const second = writer(storage, () => 0).run((scope) => scope.setLocal(KEY, 'second'));
    expect(values.get(KEY)).toBe('first');
    expect(values.has(`${PREFIX}${KEY}`)).toBe(false);
    finish.release();
    expect(await first).toEqual({ success: true, value: 1 });
    expect(await second).toEqual({ success: true, value: 2 });
    expect(values.get(KEY)).toBe('second');
    expect(values.get(`${PREFIX}${KEY}`)).toBe('2');
  });

  it('两个独立调用方等待同一把原生锁，不会在外部写入应答前改代数', async () => {
    const { storage, values } = memory();
    const first = writer(storage, () => 0);
    const second = writer(storage, () => 0);
    const entered = gate();
    const response = gate();
    let externalValue = 'old';
    const slow = first.run((scope) =>
      scope.write('config:defaultTheme.locale', async () => {
        entered.release();
        await response.promise;
        externalValue = 'zh-CN';
        return true;
      }),
    );
    await entered.promise;
    const later = second.run((scope) => scope.setLocal(KEY, 'next'));
    expect(values.has(COUNTER)).toBe(false);
    response.release();
    expect(await slow).toEqual({ success: true, value: 1 });
    expect(await later).toEqual({ success: true, value: 2 });
    expect(externalValue).toBe('zh-CN');
    expect(values.get(`${PREFIX}config:defaultTheme.locale`)).toBe('1');
    expect(values.get(`${PREFIX}${KEY}`)).toBe('2');
  });

  it('迁移持锁读取源和写目标，另一个窗口的用户修改在迁移之后写入', async () => {
    const { storage, values } = memory({ [OLD_KEY]: 'old' });
    const entered = gate();
    const resume = gate();
    const migrating = writer(storage).run(async (scope) => {
      const old = await scope.readLocal(OLD_KEY);
      entered.release();
      await resume.promise;
      await scope.setLocal(KEY, old);
    });
    await entered.promise;
    const editing = writer(storage).run((scope) => scope.setLocal(KEY, 'user edit'));
    resume.release();
    expect((await migrating).success).toBe(true);
    expect((await editing).success).toBe(true);
    expect(values.get(KEY)).toBe('user edit');
    expect(values.get(`${PREFIX}${KEY}`)).toBe('1001');
  });

  it('同一作用域的并发写入也按发起顺序记代数', async () => {
    const { storage, values } = memory();
    const data = writer(storage, () => 0);
    expect(
      await data.run((scope) =>
        Promise.all([
          scope.setLocal(KEY, 'first'),
          scope.setLocal(KEY, 'second'),
          scope.setLocal(KEY, 'third'),
        ]),
      ),
    ).toEqual({ success: true, value: [1, 2, 3] });
    expect(values.get(KEY)).toBe('third');
    expect(values.get(COUNTER)).toBe('3');
  });

  it('回调漏等写入时也不会提前释放锁或丢掉失败', async () => {
    const { storage, values } = memory();
    const data = writer(storage);
    expect(
      await data.run((scope) => {
        void scope.setLocal(KEY, 'saved');
      }),
    ).toEqual({ success: true, value: undefined });
    expect(values.get(KEY)).toBe('saved');
    expect(
      await data.run((scope) => {
        void scope.write('config:defaultTheme.locale', () => false);
      }),
    ).toEqual({ success: false, reason: 'write-failed' });
  });

  it('回调抛错时已经发出的写入仍要收完，之后的调用能获锁', async () => {
    const { storage, values } = memory();
    const data = writer(storage, () => 0);
    expect(
      await data.run((scope) => {
        void scope.setLocal(KEY, 'before failure');
        throw new Error('migration failed');
      }),
    ).toEqual({ success: false, reason: 'write-failed' });
    expect(values.get(KEY)).toBe('before failure');
    expect(await data.run((scope) => scope.setLocal(KEY, 'after failure'))).toEqual({
      success: true,
      value: 2,
    });
  });

  it('取消等待中的请求不写入，也不会抢走正在执行的锁', async () => {
    const { storage, values } = memory();
    const entered = gate();
    const resume = gate();
    const data = writer(storage);
    const active = data.run(async (scope) => {
      entered.release();
      await resume.promise;
      await scope.setLocal(KEY, 'active');
    });
    await entered.promise;
    const controller = new AbortController();
    const waiting = data.run((scope) => scope.setLocal(KEY, 'cancelled'), controller.signal);
    controller.abort('page disposed');
    expect(await waiting).toEqual({ success: false, reason: 'aborted' });
    resume.release();
    expect((await active).success).toBe(true);
    expect(values.get(KEY)).toBe('active');
  });

  it('已经退出作用域后不能用保存下来的写接口再落盘', async () => {
    const { storage, values } = memory();
    let saved: DataWriteScope | undefined;
    await writer(storage).run((scope) => {
      saved = scope;
    });
    expect(() => saved?.setLocal(KEY, 'late')).toThrow('scope-closed');
    expect(values.size).toBe(0);
  });

  it('申请前已经取消时，不执行任何写入', async () => {
    const { storage, values } = memory();
    const controller = new AbortController();
    controller.abort(new Error('disposed'));
    expect(
      await writer(storage).run((scope) => scope.setLocal(KEY, 'new'), controller.signal),
    ).toEqual({
      success: false,
      reason: 'aborted',
    });
    expect(values.size).toBe(0);
  });

  it('获锁后收到取消仍完成已经开始的写值和代数', async () => {
    const { storage, values } = memory();
    const controller = new AbortController();
    const result = await writer(storage).run(
      (scope) =>
        scope.write(KEY, async () => {
          await storage.setItem(KEY, 'saved');
          controller.abort();
          await Promise.resolve();
          return true;
        }),
      controller.signal,
    );
    expect(result).toEqual({ success: true, value: 1000 });
    expect(values.get(KEY)).toBe('saved');
    expect(values.get(`${PREFIX}${KEY}`)).toBe('1000');
  });
});
