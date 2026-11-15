// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createFlowBackdrop } from '../../../../src/immersive/backdrop/flowBackdrop.ts';
import type { FlowMotion } from '../../../../src/theme/background/flowMotion.ts';
import { defer, installImageData } from '../../../fixtures/coverArt.ts';
import { FRAME_MS, fakeFrames, flush } from '../../../fixtures/fakeFrames.ts';

// 沉浸视图的「流动色场」：窗口背景那套流动渲染器放进背景渲染器契约。渲染器、取像素与帧时钟都换成替身，
// 看的是：什么时候画、画几帧、换封面怎么过渡、静态与停用怎么收，不是 GPU 画出来什么

function pixels(seed: number): ImageData {
  return new ImageData(new Uint8ClampedArray([seed, seed, seed, 255]), 1, 1);
}

interface Drawn {
  readonly time: number;
  readonly mix: number;
}

function start(options: { load?: (url: string, signal: AbortSignal) => Promise<ImageData> } = {}) {
  installImageData();
  const frames = fakeFrames();
  const replaced: { image: ImageData | null; mix: number }[] = [];
  const drawn: Drawn[] = [];
  let disposed = 0;
  const backdrop = createFlowBackdrop({
    clock: frames.clock,
    createRenderer: () => ({
      replace: (image, _color, mix) => {
        replaced.push({ image, mix });
        return false;
      },
      draw: (motion: FlowMotion, mix) => {
        drawn.push({ time: motion.time, mix });
      },
      dispose: () => {
        disposed += 1;
      },
    }),
    load: options.load ?? (async (url) => pixels(url.length)),
  });
  const canvas = backdrop.getElement();
  return { backdrop, frames, replaced, drawn, canvas, disposed: () => disposed };
}

describe('createFlowBackdrop', () => {
  it('没封面时画布是透明的、不画；封面读到后上到渲染器、画布显出，下一拍开始画', async () => {
    const { backdrop, frames, replaced, drawn, canvas } = start();
    expect(canvas.style.opacity).toBe('0');
    expect(frames.pending()).toBe(0);
    await backdrop.setAlbum('fb2k://cover/a');
    expect(replaced).toHaveLength(1);
    expect(canvas.style.opacity).toBe('1');
    expect(drawn).toHaveLength(0);
    await frames.step();
    expect(drawn).toHaveLength(1);
  });

  it('同一张封面再下发一次：不再上传，也不再从头过渡', async () => {
    const { backdrop, replaced } = start({ load: async () => pixels(7) });
    await backdrop.setAlbum('fb2k://cover/a');
    await backdrop.setAlbum('fb2k://cover/a-again');
    expect(replaced).toHaveLength(1);
  });

  it('换了封面：上传新图，过渡的进度从 0 走到 1，走完不再变', async () => {
    const urls = ['fb2k://cover/a', 'fb2k://cover/bb'];
    const { backdrop, frames, drawn, replaced } = start();
    await backdrop.setAlbum(urls[0]!);
    for (let index = 0; index < 90; index += 1) await frames.step(FRAME_MS);
    await backdrop.setAlbum(urls[1]!);
    expect(replaced).toHaveLength(2);
    drawn.length = 0;
    for (let index = 0; index < 90; index += 1) await frames.step(FRAME_MS);
    const mixes = drawn.map((entry) => entry.mix);
    expect(mixes[0]).toBe(0);
    expect(mixes.at(-1)).toBe(1);
    for (let index = 1; index < mixes.length; index += 1)
      expect(mixes[index]!).toBeGreaterThanOrEqual(mixes[index - 1]!);
  });

  it('读不到封面（读取失败）：留着上一张，画布不淡出', async () => {
    let first = true;
    const { backdrop, replaced, canvas } = start({
      load: async () => {
        if (!first) throw new Error('读不到');
        first = false;
        return pixels(1);
      },
    });
    await backdrop.setAlbum('fb2k://cover/a');
    await backdrop.setAlbum('fb2k://cover/b');
    expect(replaced).toHaveLength(1);
    expect(canvas.style.opacity).toBe('1');
  });

  it('封面换成空：画布淡出、停画，露出场景的中性底', async () => {
    const { backdrop, frames, drawn, canvas } = start();
    await backdrop.setAlbum('fb2k://cover/a');
    await frames.step();
    await backdrop.setAlbum('');
    expect(canvas.style.opacity).toBe('0');
    const before = drawn.length;
    await frames.step();
    expect(drawn.length).toBe(before);
  });

  it('慢的读取被新的覆盖：先发的晚到时丢掉，不上传', async () => {
    const slow = defer<ImageData>();
    const { backdrop, replaced } = start({
      load: (url) => (url.endsWith('slow') ? slow.promise : Promise.resolve(pixels(9))),
    });
    const stale = backdrop.setAlbum('fb2k://cover/slow');
    await backdrop.setAlbum('fb2k://cover/fast');
    slow.resolve(pixels(3));
    await stale;
    await flush();
    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.image?.data[0]).toBe(9);
  });

  it('静态模式：画一帧就停，运动不再推进；解除后继续动', async () => {
    const { backdrop, frames, drawn } = start();
    await backdrop.setAlbum('fb2k://cover/a');
    backdrop.setStaticMode(true);
    await frames.step(FRAME_MS);
    const after = drawn.length;
    expect(after).toBe(1);
    expect(frames.pending()).toBe(0);
    backdrop.setStaticMode(false);
    for (let index = 0; index < 10; index += 1) await frames.step(FRAME_MS);
    expect(drawn.length).toBeGreaterThan(after + 5);
    expect(drawn.at(-1)!.time).toBeGreaterThan(drawn[after]!.time);
  });

  it('静态模式里换封面不做过渡：画出来就是新图', async () => {
    const { backdrop, frames, drawn } = start();
    await backdrop.setAlbum('fb2k://cover/a');
    backdrop.setStaticMode(true);
    await frames.step();
    await backdrop.setAlbum('fb2k://cover/bb');
    await frames.step();
    expect(drawn.at(-1)!.mix).toBe(1);
  });

  it('帧率上限：30 帧时 60 Hz 的屏每两拍才画一次', async () => {
    const { backdrop, frames, drawn } = start();
    await backdrop.setAlbum('fb2k://cover/a');
    backdrop.setFPS(30);
    for (let index = 0; index < 60; index += 1) await frames.step(FRAME_MS);
    expect(drawn.length).toBeGreaterThan(26);
    expect(drawn.length).toBeLessThan(34);
  });

  it('流速倍率：同样的时间里，倍率 2 比倍率 1 走得远', async () => {
    const run = async (rate: number) => {
      const { backdrop, frames, drawn } = start();
      backdrop.setFlowSpeed(rate);
      await backdrop.setAlbum('fb2k://cover/a');
      for (let index = 0; index < 60; index += 1) await frames.step(FRAME_MS);
      return drawn.at(-1)!.time;
    };
    expect(await run(2)).toBeGreaterThan(await run(1));
  });

  it('销毁：取消排着的帧、释放渲染器、取消在途的读取，之后不再画', async () => {
    const seen: AbortSignal[] = [];
    const { backdrop, frames, drawn, disposed } = start({
      load: (_url, signal) => {
        seen.push(signal);
        return new Promise<ImageData>(() => {});
      },
    });
    void backdrop.setAlbum('fb2k://cover/a');
    backdrop.dispose();
    expect(seen[0]?.aborted).toBe(true);
    expect(disposed()).toBe(1);
    await frames.step();
    expect(drawn).toHaveLength(0);
    backdrop.dispose();
    expect(disposed()).toBe(1);
  });
});
