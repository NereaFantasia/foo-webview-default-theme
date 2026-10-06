import { createMemoryConfigWriter } from '../../fixtures/dataWriter.ts';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  LYRICS_MOTION_PRESET_VALUES,
  parseLyricsMotion,
  startLyricsMotion,
} from '../../../src/lyrics/lyricsMotion.ts';
import type { ConfigValue } from '../../fixtures/hostAnswers.ts';
import { flush } from '../../fixtures/playingTrack.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const KEY = 'defaultTheme.lyrics.motion';
const { amll: AMLL, winui: WINUI } = LYRICS_MOTION_PRESET_VALUES;

async function setup(saved?: ConfigValue) {
  const host = installFakeHost({ config: saved === undefined ? {} : { [KEY]: saved } });
  const store = createStore();
  const service = startLyricsMotion(store, host.fb, createMemoryConfigWriter(host.fb));
  onTestFinished(() => service.dispose());
  await service.ready;
  return {
    host,
    service,
    pref: () => store.get(service.pref),
    motion: () => store.get(service.motion),
  };
}

describe('lyrics motion', () => {
  it('缺省是 AMLL 档；WinUI 3 档关弹簧、模糊与缩放，行移动走点到点曲线 500 ms', async () => {
    const env = await setup();
    expect(env.pref().preset).toBe('amll');
    expect(env.motion()).toStrictEqual(AMLL);
    expect(WINUI).toMatchObject({
      spring: false,
      blur: false,
      scale: false,
      transitionMs: 500,
      transitionCurve: [0.55, 0.55, 0, 1],
    });
  });

  it('选档落盘，读回后照旧；自定义档留着，切走再切回来不丢', async () => {
    const env = await setup();
    env.service.customize({ blur: false, transitionMs: 400 });
    env.service.choosePreset('winui');
    await flush();
    const again = await setup(env.host.config.get(KEY));
    expect(again.pref().preset).toBe('winui');
    expect(again.motion()).toStrictEqual(WINUI);
    again.service.choosePreset('custom');
    expect(again.motion()).toMatchObject({ blur: false, transitionMs: 400 });
  });

  it('在 WinUI 3 档上只调一项，其余仍是 WinUI 3 的值', async () => {
    const env = await setup();
    env.service.choosePreset('winui');
    env.service.customize({ hidePassedLines: true });
    expect(env.pref().preset).toBe('custom');
    expect(env.motion()).toStrictEqual({ ...WINUI, hidePassedLines: true });
  });

  it('存档逐项校验：坏项回到缺省，越界夹回区间', async () => {
    const env = await setup({
      preset: 'unknown',
      custom: {
        spring: 'yes',
        transitionMs: 99999,
        transitionCurve: [2, 0, -1, 1],
        alignPosition: -3,
        scaleSpring: { mass: 0, damping: 30, stiffness: 50 },
      },
    });
    expect(env.pref().preset).toBe('amll');
    expect(env.pref().custom).toStrictEqual({
      ...AMLL,
      transitionMs: 2000,
      transitionCurve: [1, 0, 0, 1],
      alignPosition: 0,
      scaleSpring: { mass: 0.1, damping: 30, stiffness: 50 },
    });
  });

  it('曲线不是四个数时整项回到缺省', () => {
    for (const curve of [[0, 1], 'ease', [0, 'a', 1, 1]])
      expect(parseLyricsMotion({ transitionCurve: curve }).transitionCurve).toStrictEqual(
        AMLL.transitionCurve,
      );
  });

  it('接近零的渐变宽度可用，零与负值不能传给 AMLL', () => {
    expect(parseLyricsMotion({ wordFadeWidth: 0.0001 }).wordFadeWidth).toBe(0.0001);
    expect(parseLyricsMotion({ wordFadeWidth: 0 }).wordFadeWidth).toBe(0.0001);
    expect(parseLyricsMotion({ wordFadeWidth: -1 }).wordFadeWidth).toBe(0.0001);
  });
});
