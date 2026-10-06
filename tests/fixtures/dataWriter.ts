import {
  createDataWriter,
  type DataWriter,
  type DataWriteStorage,
} from '../../src/kit/dataWrite.ts';
import {
  createConfigWriter,
  type ConfigWriteFace,
  type ConfigWriter,
} from '../../src/host/configWrite.ts';

/** 共享内存存储与原生 Web Locks，验证宿主应答和代数写入的先后。 */
export function createMemoryDataWriter(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  const storage: DataWriteStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
  const writer = createDataWriter({ storage, locks: navigator.locks, now: () => 0 });
  return { writer, storage, values };
}

const MEMORY_WRITERS = new WeakMap<ConfigWriteFace, ConfigWriter>();

export function createMemoryConfigWriter(host: ConfigWriteFace): ConfigWriter {
  let writer = MEMORY_WRITERS.get(host);
  if (!writer) {
    writer = createConfigWriter(host, createMemoryDataWriter().writer);
    MEMORY_WRITERS.set(host, writer);
  }
  return writer;
}

/** 占住公共写锁，直到调用返回的函数；被测服务的写入就停在等锁阶段。 */
export async function occupyWriteLock(writer: Pick<DataWriter, 'run'>) {
  let entered = () => {};
  let finish = () => {};
  const inside = new Promise<void>((resolve) => (entered = resolve));
  const done = new Promise<void>((resolve) => (finish = resolve));
  const held = writer.run(async () => {
    entered();
    await done;
  });
  await inside;
  return async () => {
    finish();
    await held;
  };
}
