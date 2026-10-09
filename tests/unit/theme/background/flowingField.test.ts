import { atom, createStore } from 'jotai/vanilla';
import { expect, onTestFinished, test } from 'vitest';
import {
  startFlowingField,
  type FlowActivity,
} from '../../../../src/theme/background/flowingField.ts';
import type {
  FlowInput,
  FlowMemory,
  FlowSurface,
} from '../../../../src/theme/background/flowingSurface.ts';
import {
  chooseBackgroundSource,
  backgroundCoverAtom,
  backgroundTransportAtom,
} from '../../../../src/theme/background/windowBackground.ts';
import { defer, installImageData } from '../../../fixtures/coverArt.ts';
import { chooseColorMode } from '../../../../src/theme/colorScheme.ts';

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function setup(visible = true) {
  const store = createStore(),
    activity = atom<FlowActivity>({ visible, focused: true });
  const made: { input: FlowInput | null; ended: boolean; sleeping: boolean; memory: FlowMemory }[] =
    [];
  const service = startFlowingField({
    store,
    activity,
    create: async (_, memory) => {
      const record = { input: null as FlowInput | null, ended: false, sleeping: false, memory };
      made.push(record);
      return {
        update: (input) => {
          record.input = input;
          record.sleeping = false;
        },
        suspend: (scheme) => {
          record.sleeping = true;
          if (record.input && scheme) record.input = { ...record.input, scheme };
        },
        dispose: () => {
          record.ended = true;
        },
      };
    },
  });
  onTestFinished(() => service.dispose());
  const off = service.attach({ append: () => {} });
  return { store, activity, service, made, off };
}

test('非色场来源与初始隐藏不创建资源，恢复后只使用最新封面', async () => {
  const { store, activity, made, off } = setup(false);
  chooseBackgroundSource(store, 'palette', null);
  store.set(backgroundTransportAtom, 'playing');
  store.set(backgroundCoverAtom, { url: 'old', profile: null });
  await settle();
  expect(made).toHaveLength(0);
  store.set(backgroundCoverAtom, { url: 'current', profile: null });
  store.set(activity, { visible: true, focused: true });
  await settle();
  expect(made[0].input).toMatchObject({ url: 'current', running: true });
  chooseBackgroundSource(store, 'image', null);
  expect(made[0].sleeping).toBe(true);
  off();
  expect(made[0].ended).toBe(true);
});

test('暂停与失焦保留实例，停止交给绘制器退色；二十轮隐藏休眠并保留恢复状态', async () => {
  const { store, activity, made, service } = setup();
  chooseBackgroundSource(store, 'palette', null);
  store.set(backgroundTransportAtom, 'playing');
  store.set(backgroundCoverAtom, { url: 'cover', profile: null });
  await settle();
  const memory = made[0].memory;
  memory.motion.rotation = 2;
  store.set(backgroundTransportAtom, 'paused');
  store.set(activity, { visible: true, focused: false });
  expect(made[0].ended).toBe(false);
  expect(made[0].input).toMatchObject({
    url: 'cover',
    running: true,
    paused: true,
    focused: false,
  });
  for (let i = 0; i < 20; i++) {
    store.set(activity, { visible: false, focused: false });
    expect(made.at(-1)?.sleeping).toBe(true);
    store.set(activity, { visible: true, focused: true });
    await settle();
    expect(made.filter((entry) => !entry.ended)).toHaveLength(1);
    expect(made.at(-1)?.sleeping).toBe(false);
    expect(made.at(-1)?.memory).toBe(memory);
    expect(memory.motion.rotation).toBe(2);
  }
  store.set(backgroundTransportAtom, 'stopped');
  expect(made.at(-1)?.input?.url).toBe('');
  service.dispose();
  store.set(activity, { visible: true, focused: true });
  expect(made.every((entry) => entry.ended)).toBe(true);
});

test('隐藏会取消尚未完成的创建，迟到资源只释放、不发布', async () => {
  const store = createStore(),
    activity = atom<FlowActivity>({ visible: true, focused: true });
  const result = defer<FlowSurface>();
  let signal: AbortSignal | undefined;
  let published = false,
    ended = false;
  const service = startFlowingField({
    store,
    activity,
    create: async (_, __, input) => {
      signal = input;
      return result.promise;
    },
  });
  onTestFinished(() => service.dispose());
  chooseBackgroundSource(store, 'palette', null);
  service.attach({ append: () => {} });
  await settle();
  store.set(activity, { visible: false, focused: true });
  expect(signal?.aborted).toBe(true);
  result.resolve({
    update: () => {
      published = true;
    },
    suspend: () => {},
    dispose: () => {
      ended = true;
    },
  });
  await settle();
  expect(ended).toBe(true);
  expect(published).toBe(false);
});

test('加载失败不会在焦点变化和重新挂载时反复创建', async () => {
  const store = createStore(),
    activity = atom<FlowActivity>({ visible: true, focused: true });
  let attempts = 0;
  let presentations = 0;
  const ready = () => {
    presentations++;
  };
  const service = startFlowingField({
    store,
    activity,
    create: async () => {
      attempts++;
      throw new Error('加载失败');
    },
  });
  onTestFinished(() => service.dispose());
  chooseBackgroundSource(store, 'palette', null);
  const off = service.attach({ append: () => {} }, ready);
  await settle();
  expect(presentations).toBe(1);
  off();
  service.attach({ append: () => {} }, ready);
  store.set(activity, { visible: true, focused: false });
  await settle();
  expect(attempts).toBe(1);
  expect(presentations).toBe(2);
});

test('切回其他背景先休眠用于退场，容器撤销后清缓存；释放服务也清空缓存', async () => {
  installImageData();
  const { store, activity, made, service, off } = setup();
  chooseBackgroundSource(store, 'palette', null);
  await settle();
  const memory = made[0].memory;
  const pixels = new ImageData(new Uint8ClampedArray([50, 60, 70, 255]), 1, 1);
  memory.cover = { url: 'cover', pixels };
  memory.preview = { pixels, scheme: 'dark' };
  store.set(activity, { visible: false, focused: false });
  expect(memory.cover?.pixels).toBe(pixels);
  expect(memory.preview.pixels).toBe(pixels);
  chooseBackgroundSource(store, 'cover', null);
  expect(made[0].sleeping).toBe(true);
  expect(memory.preview.pixels).toBe(pixels);
  off();
  expect(memory.cover).toBeNull();
  expect(memory.preview).toBeNull();
  expect(made[0].ended).toBe(true);
  chooseBackgroundSource(store, 'palette', null);
  service.attach({ append: () => {} });
  store.set(activity, { visible: true, focused: true });
  await settle();
  memory.cover = { url: 'cover', pixels };
  memory.preview = { pixels, scheme: 'dark' };
  service.dispose();
  expect(memory.cover).toBeNull();
  expect(memory.preview).toBeNull();
});

test('深浅变化交给现有绘制实例，隐藏期间也传递主题以清理旧预览', async () => {
  const { store, activity, made } = setup();
  chooseBackgroundSource(store, 'palette', null);
  chooseColorMode(store, 'dark', null);
  await settle();
  expect(made[0].input?.scheme).toBe('dark');
  chooseColorMode(store, 'light', null);
  expect(made[0].input?.scheme).toBe('light');
  expect(made).toHaveLength(1);
  store.set(activity, { visible: false, focused: false });
  chooseColorMode(store, 'dark', null);
  expect(made[0].sleeping).toBe(true);
  expect(made[0].input?.scheme).toBe('dark');
});
