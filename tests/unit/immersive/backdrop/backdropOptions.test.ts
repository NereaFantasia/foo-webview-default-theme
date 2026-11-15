// @vitest-environment jsdom
import { IsolationRenderer, TitaniumRenderer } from '@applemusic-like-lyrics/core';
import { describe, expect, it } from 'vitest';
import {
  NO_OPTIONS,
  NO_STORED_OPTIONS,
  backdropFlowSpeed,
  formatBackdropOptions,
  isolationValues,
  meshValues,
  parseBackdropOptions,
  resolveBackdropOptions,
  titaniumValues,
  withBackdropFlowSpeed,
  withBackdropOption,
  withoutBackdropOptions,
  type StoredBackdropOptions,
} from '../../../../src/immersive/backdrop/backdropOptions.ts';

function parsed(raw: string): StoredBackdropOptions {
  const value = parseBackdropOptions(raw);
  if (!value) throw new Error('应当解析得出');
  return value;
}

describe('缺省值与上游一致', () => {
  it('钛金属：缺省换算后与上游 defaultOptions 逐项相等', () => {
    expect(resolveBackdropOptions('titanium', NO_STORED_OPTIONS).patch).toEqual(
      TitaniumRenderer.defaultOptions,
    );
  });

  it('隔离：缺省与上游 defaultOptions 逐项相等', () => {
    expect(resolveBackdropOptions('isolation', NO_STORED_OPTIONS).patch).toEqual(
      IsolationRenderer.defaultOptions,
    );
  });

  it('流动速度缺省是原速；网格渐变与不画时没有选项可下发', () => {
    expect(resolveBackdropOptions('mesh', NO_STORED_OPTIONS)).toEqual({
      flowRate: 1,
      patch: {},
      audio: false,
      audioGain: 1,
      filter: '',
    });
    expect(resolveBackdropOptions(null, parsed('{"flowSpeed":150}'))).toBe(NO_OPTIONS);
    expect(backdropFlowSpeed(NO_STORED_OPTIONS)).toBe(100);
  });
});

describe('换算给上游', () => {
  it('界面单位换成上游的名字与单位，取色方式的拼写对上上游', () => {
    const stored = parsed(
      '{"flowSpeed":150,"titanium":{"grain":50,"crestShiftMs":3000,"palette":"octree","dithering":false}}',
    );
    expect(resolveBackdropOptions('titanium', stored)).toEqual({
      flowRate: 1.5,
      patch: {
        ...TitaniumRenderer.defaultOptions,
        grain: 0.5,
        crestShiftMs: 3000,
        paletteAlgorithm: 'octtree',
        dithering: false,
      },
      audio: false,
      audioGain: 1,
      filter: '',
    });
  });

  it('生效的是实际在跑的那个渲染器的项：别的渲染器的存档不串过去', () => {
    const stored = parsed(
      '{"titanium":{"grain":10},"isolation":{"lightWave":true,"palette":"kmeans"}}',
    );
    expect(resolveBackdropOptions('isolation', stored).patch).toEqual({
      lightWave: true,
      dithering: true,
      paletteAlgorithm: 'kmeans',
    });
    expect(resolveBackdropOptions('mesh', stored).patch).toEqual({});
  });
});

describe('存档的读与写', () => {
  it('认不出的键、不合法的值与越界值丢掉，别的项不受影响', () => {
    const stored = parsed(
      JSON.stringify({
        flowSpeed: 500,
        titanium: { grain: 101, sparkle: 80, palette: 'pixi', unknown: 1, crestShiftMs: 'x' },
        isolation: { lightWave: 'yes', dithering: false },
        mesh: { anything: 1 },
      }),
    );
    expect(stored).toEqual({
      titanium: { sparkle: 80 },
      isolation: { dithering: false },
      mesh: {},
      flow: {},
    });
  });

  it('坏 JSON 认不出，不是对象的当空存档', () => {
    expect(parseBackdropOptions('{broken')).toBeUndefined();
    expect(parsed('[]')).toEqual(NO_STORED_OPTIONS);
    expect(parsed('7')).toEqual(NO_STORED_OPTIONS);
  });

  it('写出时省掉空组与没改过的流动速度，读回等价', () => {
    expect(formatBackdropOptions(NO_STORED_OPTIONS)).toBe('{}');
    const stored: StoredBackdropOptions = {
      flowSpeed: 130,
      titanium: { grain: 50 },
      isolation: {},
      mesh: { audio: true },
      flow: {},
    };
    expect(formatBackdropOptions(stored)).toBe(
      '{"flowSpeed":130,"titanium":{"grain":50},"mesh":{"audio":true}}',
    );
    expect(parsed(formatBackdropOptions(stored))).toEqual(stored);
  });
});

describe('改一项', () => {
  it('改成缺省就不再进存档，值没变答回原对象', () => {
    const changed = withBackdropOption(NO_STORED_OPTIONS, 'titanium', 'grain', 50);
    expect(changed.titanium).toEqual({ grain: 50 });
    const back = withBackdropOption(changed, 'titanium', 'grain', 70);
    expect(back.titanium).toEqual({});
    expect(withBackdropOption(changed, 'titanium', 'grain', 50)).toBe(changed);
    expect(withBackdropOption(NO_STORED_OPTIONS, 'titanium', 'grain', 70)).toBe(NO_STORED_OPTIONS);
  });

  it('键没声明或值不合法时原样答回，不污染存档', () => {
    expect(withBackdropOption(NO_STORED_OPTIONS, 'titanium', 'lightWave', true)).toBe(
      NO_STORED_OPTIONS,
    );
    expect(withBackdropOption(NO_STORED_OPTIONS, 'titanium', 'grain', 101)).toBe(NO_STORED_OPTIONS);
    expect(withBackdropOption(NO_STORED_OPTIONS, 'isolation', 'palette', 'pixi')).toBe(
      NO_STORED_OPTIONS,
    );
  });

  it('两个渲染器的项各记各的', () => {
    const stored = withBackdropOption(
      withBackdropOption(NO_STORED_OPTIONS, 'titanium', 'dithering', false),
      'isolation',
      'dithering',
      false,
    );
    expect(titaniumValues(stored).dithering).toBe(false);
    expect(isolationValues(stored).dithering).toBe(false);
    expect(
      titaniumValues(withBackdropOption(stored, 'titanium', 'dithering', true)).dithering,
    ).toBe(true);
    expect(
      isolationValues(withBackdropOption(stored, 'titanium', 'dithering', true)).dithering,
    ).toBe(false);
  });

  it('流动速度：取整、夹不进范围的不收、回到 100 就不存', () => {
    const fast = withBackdropFlowSpeed(NO_STORED_OPTIONS, 129.6);
    expect(fast.flowSpeed).toBe(130);
    expect(withBackdropFlowSpeed(fast, 130)).toBe(fast);
    expect(withBackdropFlowSpeed(fast, 20)).toBe(fast);
    expect(withBackdropFlowSpeed(fast, Number.NaN)).toBe(fast);
    expect(withBackdropFlowSpeed(fast, 100)).toEqual(NO_STORED_OPTIONS);
    expect(withBackdropFlowSpeed(NO_STORED_OPTIONS, 100)).toBe(NO_STORED_OPTIONS);
  });
});

describe('恢复默认', () => {
  const stored: StoredBackdropOptions = {
    flowSpeed: 150,
    titanium: { grain: 10 },
    isolation: { lightWave: true },
    mesh: { audio: true },
    flow: {},
  };

  it('只清所选渲染器的项，连同共用的流动速度；别的渲染器的项留着', () => {
    expect(withoutBackdropOptions(stored, 'titanium')).toEqual({
      titanium: {},
      isolation: { lightWave: true },
      mesh: { audio: true },
      flow: {},
    });
    expect(withoutBackdropOptions(stored, 'isolation')).toEqual({
      titanium: { grain: 10 },
      isolation: {},
      mesh: { audio: true },
      flow: {},
    });
  });

  it('网格渐变的随音乐律动一并恢复，别的渲染器的项不动', () => {
    expect(withoutBackdropOptions(stored, 'mesh')).toEqual({
      titanium: { grain: 10 },
      isolation: { lightWave: true },
      mesh: {},
      flow: {},
    });
  });

  it('本来就是缺省时答回原对象', () => {
    expect(withoutBackdropOptions(NO_STORED_OPTIONS, 'titanium')).toBe(NO_STORED_OPTIONS);
  });
});

describe('随音乐律动', () => {
  it('缺省关；开关不进下发给上游的补丁', () => {
    expect(titaniumValues(NO_STORED_OPTIONS).audio).toBe(false);
    expect(meshValues(NO_STORED_OPTIONS).audio).toBe(false);
    const on = parsed('{"titanium":{"audio":true}}');
    expect(resolveBackdropOptions('titanium', on).audio).toBe(true);
    expect(resolveBackdropOptions('titanium', on).patch).toEqual(TitaniumRenderer.defaultOptions);
  });

  it('钛金属与网格渐变各存各的，网格渐变认不得钛金属的项', () => {
    const stored = parsed('{"titanium":{"audio":true}}');
    expect(resolveBackdropOptions('mesh', stored).audio).toBe(false);
    const mesh = withBackdropOption(NO_STORED_OPTIONS, 'mesh', 'audio', true);
    expect(mesh.mesh).toEqual({ audio: true });
    expect(resolveBackdropOptions('mesh', mesh)).toEqual({
      flowRate: 1,
      patch: {},
      audio: true,
      audioGain: 1,
      filter: '',
    });
    expect(resolveBackdropOptions('titanium', mesh).audio).toBe(false);
    expect(withBackdropOption(mesh, 'mesh', 'grain', 50)).toBe(mesh);
  });

  it('网格渐变的律动强度：缺省原样，百分数换成倍数，越界丢弃，回到缺省不进存档', () => {
    expect(meshValues(NO_STORED_OPTIONS).audioStrength).toBe(100);
    expect(resolveBackdropOptions('mesh', NO_STORED_OPTIONS).audioGain).toBe(1);
    const strong = withBackdropOption(NO_STORED_OPTIONS, 'mesh', 'audioStrength', 150);
    expect(strong.mesh).toEqual({ audioStrength: 150 });
    expect(resolveBackdropOptions('mesh', strong).audioGain).toBe(1.5);
    expect(withBackdropOption(strong, 'mesh', 'audioStrength', 250)).toBe(strong);
    expect(withBackdropOption(strong, 'mesh', 'audioStrength', 100)).toEqual(NO_STORED_OPTIONS);
    expect(parsed('{"mesh":{"audioStrength":-5}}').mesh).toEqual({});
  });

  it('律动强度只管网格渐变：钛金属与隔离的倍数恒为 1', () => {
    const stored = parsed('{"mesh":{"audioStrength":150}}');
    expect(resolveBackdropOptions('titanium', stored).audioGain).toBe(1);
    expect(resolveBackdropOptions('isolation', stored).audioGain).toBe(1);
    expect(withBackdropOption(NO_STORED_OPTIONS, 'titanium', 'audioStrength', 150)).toBe(
      NO_STORED_OPTIONS,
    );
  });

  it('隔离的低频音量是空实现：存档里写了也认不得，也不生效', () => {
    const stored = parsed('{"isolation":{"audio":true}}');
    expect(stored.isolation).toEqual({});
    expect(resolveBackdropOptions('isolation', stored).audio).toBe(false);
    expect(withBackdropOption(NO_STORED_OPTIONS, 'isolation', 'audio', true)).toBe(
      NO_STORED_OPTIONS,
    );
  });

  it('关回缺省就不再进存档', () => {
    const on = withBackdropOption(NO_STORED_OPTIONS, 'titanium', 'audio', true);
    expect(formatBackdropOptions(on)).toBe('{"titanium":{"audio":true}}');
    expect(withBackdropOption(on, 'titanium', 'audio', false)).toEqual(NO_STORED_OPTIONS);
  });
});

describe('调色', () => {
  it('恒等时没有 filter；只写改过的几项，次序是色相、饱和度、亮度', () => {
    expect(resolveBackdropOptions('mesh', NO_STORED_OPTIONS).filter).toBe('');
    const tinted = parsed('{"mesh":{"brightness":90,"hue":-30,"saturation":150}}');
    expect(resolveBackdropOptions('mesh', tinted).filter).toBe(
      'hue-rotate(-30deg) saturate(1.5) brightness(0.9)',
    );
    const isolation = withBackdropOption(NO_STORED_OPTIONS, 'isolation', 'saturation', 80);
    expect(resolveBackdropOptions('isolation', isolation).filter).toBe('saturate(0.8)');
  });

  it('各渲染器各存各的；钛金属没有调色，存档里写了也认不得', () => {
    const stored = parsed('{"mesh":{"hue":30},"titanium":{"hue":30}}');
    expect(stored.titanium).toEqual({});
    expect(resolveBackdropOptions('isolation', stored).filter).toBe('');
    expect(resolveBackdropOptions('titanium', stored).filter).toBe('');
    expect(withBackdropOption(NO_STORED_OPTIONS, 'titanium', 'hue', 30)).toBe(NO_STORED_OPTIONS);
  });

  it('越界丢弃，回到缺省不进存档', () => {
    const tinted = withBackdropOption(NO_STORED_OPTIONS, 'mesh', 'hue', 45);
    expect(tinted.mesh).toEqual({ hue: 45 });
    expect(withBackdropOption(tinted, 'mesh', 'hue', 200)).toBe(tinted);
    expect(withBackdropOption(tinted, 'mesh', 'hue', 0)).toEqual(NO_STORED_OPTIONS);
  });
});

describe('流动色场', () => {
  it('有自己的一组：只有调色，没有随音乐律动；网格渐变的律动不串过来', () => {
    const stored = parsed('{"mesh":{"audio":true,"audioStrength":150},"flow":{"hue":60}}');
    expect(stored.flow).toEqual({ hue: 60 });
    expect(resolveBackdropOptions('flow', stored)).toEqual({
      flowRate: 1,
      patch: {},
      audio: false,
      audioGain: 1,
      filter: 'hue-rotate(60deg)',
    });
    expect(withBackdropOption(stored, 'flow', 'audio', true)).toBe(stored);
  });

  it('写出与读回带着这一组；恢复默认只清它自己', () => {
    const stored: StoredBackdropOptions = {
      flowSpeed: 120,
      titanium: {},
      isolation: {},
      mesh: { hue: 10 },
      flow: { saturation: 50 },
    };
    expect(formatBackdropOptions(stored)).toBe(
      '{"flowSpeed":120,"mesh":{"hue":10},"flow":{"saturation":50}}',
    );
    expect(parsed(formatBackdropOptions(stored))).toEqual(stored);
    expect(withoutBackdropOptions(stored, 'flow')).toEqual({
      titanium: {},
      isolation: {},
      mesh: { hue: 10 },
      flow: {},
    });
  });
});
