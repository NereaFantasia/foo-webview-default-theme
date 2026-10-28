// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  createTitaniumBackdrop,
  type LookMemory,
  type TitaniumHost,
} from '../../../../src/immersive/backdrop/titaniumLook.ts';

/** 每掷一次给一个不同的数，两个实例的随机序列不会撞上 */
function dice() {
  let n = 0;
  return () => (n++ * 0.37 + 0.11) % 1;
}

/**
 * 按上游钛金属渲染器的节奏写的替身：建时掷颗粒与色序，换封面时（图加载完之后）先掷锋线姿态、再掷色序；
 * 姿态是在当前基础上加一段随机转角
 */
function fakeTitanium(random: () => number) {
  const fields = {
    seed: new Float32Array(3),
    grainOffset: new Float32Array(2),
    paletteOrder: new Uint8Array(4),
    crestMotion: new Float32Array(3),
    crestFrom: new Float32Array(3),
    crestTo: new Float32Array(3),
    crestShiftElapsed: 0,
    rollPaletteOrder() {
      for (let i = 0; i < this.paletteOrder.length; i++) this.paletteOrder[i] = random() * 200;
    },
    rollCrestTarget() {
      this.crestFrom.set(this.crestMotion);
      for (let i = 0; i < 3; i++) this.crestTo[i] = (this.crestMotion[i] ?? 0) + random() * 6;
      this.crestShiftElapsed = 0;
    },
  };
  for (let i = 0; i < 3; i++) fields.seed[i] = random();
  for (let i = 0; i < 2; i++) fields.grainOffset[i] = random();
  fields.rollPaletteOrder();
  const calls: string[] = [];
  let finish: (() => void) | null = null;
  const host: TitaniumHost = {
    getRenderer: () => fields,
    getElement: () => document.createElement('canvas'),
    async setAlbum(source) {
      calls.push(`album:${source}`);
      await new Promise<void>((resolve) => (finish = resolve));
      if (source === '') return;
      fields.rollCrestTarget();
      fields.rollPaletteOrder();
      // 上游每次换封面后姿态走到位
      fields.crestMotion.set(fields.crestTo);
    },
    setRenderScale: () => undefined,
    setLowFreqVolume: () => undefined,
    setFPS: () => undefined,
    setStaticMode: () => undefined,
    setHasLyric: () => undefined,
    dispose: () => void calls.push('dispose'),
  };
  /** 让在路上的那次换封面走完 */
  const settle = async () => {
    finish?.();
    finish = null;
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { fields, host, calls, settle };
}

function session() {
  const random = dice();
  const memory: LookMemory = { look: null };
  const open = () => {
    const fake = fakeTitanium(random);
    const backdrop = createTitaniumBackdrop(() => fake.host, memory);
    return { ...fake, backdrop };
  };
  return { memory, open };
}

describe('createTitaniumBackdrop', () => {
  it('进退场之间同一张封面：颗粒、色序与锋线姿态都放回，姿态直接到位', async () => {
    const { memory, open } = session();
    const first = open();
    void first.backdrop.setAlbum('cover-a');
    await first.settle();
    const seen = {
      seed: [...first.fields.seed],
      grain: [...first.fields.grainOffset],
      order: [...first.fields.paletteOrder],
      crest: [...first.fields.crestTo],
    };
    first.backdrop.dispose();
    expect(memory.look?.cover).toBe('cover-a');

    const second = open();
    expect([...second.fields.seed], '颗粒位置建好就是上次的').toStrictEqual(seen.seed);
    expect([...second.fields.grainOffset]).toStrictEqual(seen.grain);
    void second.backdrop.setAlbum('cover-a');
    await second.settle();
    expect([...second.fields.paletteOrder]).toStrictEqual(seen.order);
    expect([...second.fields.crestTo]).toStrictEqual(seen.crest);
    expect([...second.fields.crestMotion]).toStrictEqual(seen.crest);
    expect(second.fields.crestShiftElapsed, '不再从零点慢慢挪过去').toBe(Number.POSITIVE_INFINITY);
  });

  it('视图里换过曲再退场：记的是退场时那张封面的构图', async () => {
    const { memory, open } = session();
    const first = open();
    void first.backdrop.setAlbum('cover-a');
    await first.settle();
    void first.backdrop.setAlbum('cover-b');
    await first.settle();
    const seen = { order: [...first.fields.paletteOrder], crest: [...first.fields.crestTo] };
    first.backdrop.dispose();
    expect(memory.look?.cover).toBe('cover-b');

    const second = open();
    void second.backdrop.setAlbum('cover-b');
    await second.settle();
    expect([...second.fields.paletteOrder]).toStrictEqual(seen.order);
    expect([...second.fields.crestTo]).toStrictEqual(seen.crest);
  });

  it('进退场之间换过曲：只沿用颗粒位置，色序与姿态照上游重掷', async () => {
    const { open } = session();
    const first = open();
    void first.backdrop.setAlbum('cover-a');
    await first.settle();
    const seen = { seed: [...first.fields.seed], crest: [...first.fields.crestTo] };
    first.backdrop.dispose();

    const second = open();
    void second.backdrop.setAlbum('cover-c');
    await second.settle();
    expect([...second.fields.seed]).toStrictEqual(seen.seed);
    expect([...second.fields.crestTo]).not.toStrictEqual(seen.crest);
    expect(second.fields.crestShiftElapsed).toBe(0);
  });

  it('只放回这个实例的第一次换封面：之后换了再换回来，照上游重掷', async () => {
    const { open } = session();
    const first = open();
    void first.backdrop.setAlbum('cover-a');
    await first.settle();
    const seen = [...first.fields.crestTo];
    first.backdrop.dispose();

    const second = open();
    void second.backdrop.setAlbum('cover-a');
    await second.settle();
    void second.backdrop.setAlbum('cover-b');
    await second.settle();
    void second.backdrop.setAlbum('cover-a');
    await second.settle();
    expect([...second.fields.crestTo]).not.toStrictEqual(seen);
    expect(second.fields.crestShiftElapsed).toBe(0);
  });

  it('封面先是空的、随后才到同一张：照样放回；空封面不记', async () => {
    const { memory, open } = session();
    const first = open();
    void first.backdrop.setAlbum('');
    await first.settle();
    first.backdrop.dispose();
    expect(memory.look, '没有换成过封面就不记').toBeNull();

    const again = open();
    void again.backdrop.setAlbum('cover-a');
    await again.settle();
    const seen = [...again.fields.crestTo];
    again.backdrop.dispose();

    const third = open();
    void third.backdrop.setAlbum('');
    await third.settle();
    void third.backdrop.setAlbum('cover-a');
    await third.settle();
    expect([...third.fields.crestTo]).toStrictEqual(seen);
  });

  it('封面还在加载就退场：不覆盖原来记的', async () => {
    const { memory, open } = session();
    const first = open();
    void first.backdrop.setAlbum('cover-a');
    await first.settle();
    first.backdrop.dispose();
    const kept = memory.look;

    const second = open();
    void second.backdrop.setAlbum('cover-b');
    second.backdrop.dispose();
    expect(memory.look).toBe(kept);
  });

  it('上游的成员对不上时原样返回，不包也不记', () => {
    const memory: LookMemory = { look: null };
    const canvas = document.createElement('canvas');
    const host: TitaniumHost = {
      getRenderer: () => ({}),
      getElement: () => canvas,
      setAlbum: () => Promise.resolve(),
      setRenderScale: () => undefined,
      setLowFreqVolume: () => undefined,
      setFPS: () => undefined,
      setStaticMode: () => undefined,
      setHasLyric: () => undefined,
      dispose: () => undefined,
    };
    expect(createTitaniumBackdrop(() => host, memory)).toBe(host);
  });
});
