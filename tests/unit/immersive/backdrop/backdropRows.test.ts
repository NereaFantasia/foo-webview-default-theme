import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  NO_STORED_OPTIONS,
  parseBackdropOptions,
  type StoredBackdropOptions,
} from '../../../../src/immersive/backdrop/backdropOptions.ts';
import {
  backdropRowsOf,
  rowText,
  writeBackdropRow,
  type RangeRow,
} from '../../../../src/immersive/backdrop/backdropRows.ts';
import { backdropOptionsAtom } from '../../../../src/immersive/backdrop/backdropState.ts';
import { BUILTIN_MESSAGES, createTranslate } from '../../../../src/i18n/translate.ts';

// 背景选项的行表：设置页的卡与设置编辑的卡都按它画，所选渲染器有哪几行、次序、读数、写到哪里

function parsed(raw: string): StoredBackdropOptions {
  const value = parseBackdropOptions(raw);
  if (!value) throw new Error('应当解析得出');
  return value;
}

const keysOf = (rows: readonly { readonly key: string }[]) => rows.map((row) => row.key);

describe('各渲染器的行', () => {
  it('钛金属：外观四项、运动三项、画质两项，没有调色', () => {
    expect(keysOf(backdropRowsOf('titanium', NO_STORED_OPTIONS))).toEqual([
      'grain',
      'sparkle',
      'sheen',
      'metalness',
      'flowSpeed',
      'crestShiftMs',
      'audio',
      'dithering',
      'palette',
    ]);
  });

  it('隔离：流动速度、光波、减轻色带、取色方式，末尾调色三行', () => {
    expect(keysOf(backdropRowsOf('isolation', NO_STORED_OPTIONS))).toEqual([
      'flowSpeed',
      'lightWave',
      'dithering',
      'palette',
      'hue',
      'saturation',
      'brightness',
    ]);
  });

  it('网格渐变：律动强度只在随音乐律动开着时出现', () => {
    expect(keysOf(backdropRowsOf('mesh', NO_STORED_OPTIONS))).toEqual([
      'flowSpeed',
      'audio',
      'hue',
      'saturation',
      'brightness',
    ]);
    expect(keysOf(backdropRowsOf('mesh', parsed('{"mesh":{"audio":true}}')))).toEqual([
      'flowSpeed',
      'audio',
      'audioStrength',
      'hue',
      'saturation',
      'brightness',
    ]);
  });

  it('流动色场：只有流动速度与调色，没有随音乐律动；网格渐变的律动开着也不串过来', () => {
    const rows = backdropRowsOf('flow', parsed('{"mesh":{"audio":true},"flow":{"hue":30}}'));
    expect(keysOf(rows)).toEqual(['flowSpeed', 'hue', 'saturation', 'brightness']);
    expect(rows.find((row) => row.key === 'hue')).toMatchObject({ target: 'flow', value: 30 });
  });
});

describe('读数', () => {
  const t = createTranslate(BUILTIN_MESSAGES['zh-CN'], {});
  const rangeOf = (raw: string, key: string): RangeRow => {
    const row = backdropRowsOf('titanium', parsed(raw))
      .concat(backdropRowsOf('mesh', parsed(raw)))
      .find((candidate) => candidate.key === key);
    if (row?.kind !== 'range') throw new Error(`没有 ${key} 这一行`);
    return row;
  };

  it('百分数；纹路移动时长按秒取一位小数；色相带正负号与度', () => {
    expect(rowText(rangeOf('{}', 'grain'), t)).toBe('70%');
    expect(rowText(rangeOf('{"titanium":{"crestShiftMs":2500}}', 'crestShiftMs'), t)).toBe(
      '2.5 秒',
    );
    expect(rowText(rangeOf('{"mesh":{"hue":30}}', 'hue'), t)).toBe('+30°');
    expect(rowText(rangeOf('{"mesh":{"hue":-45}}', 'hue'), t)).toBe('−45°');
    expect(rowText(rangeOf('{}', 'hue'), t)).toBe('0°');
  });
});

describe('写一行', () => {
  it('流动速度写顶层；渲染器自己的项写进它那一组', () => {
    const store = createStore();
    const [flowSpeed] = backdropRowsOf('flow', NO_STORED_OPTIONS);
    writeBackdropRow(store, flowSpeed!, 150);
    expect(store.get(backdropOptionsAtom).flowSpeed).toBe(150);
    const hue = backdropRowsOf('flow', NO_STORED_OPTIONS).find((row) => row.key === 'hue')!;
    writeBackdropRow(store, hue, 60);
    expect(store.get(backdropOptionsAtom).flow).toEqual({ hue: 60 });
    expect(store.get(backdropOptionsAtom).mesh).toEqual({});
  });
});
