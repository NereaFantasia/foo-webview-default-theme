import type { immersiveEn } from './immersiveEn.ts';

/** 正在播放全屏页的简体中文文案，并进中文包。 */
export const immersiveZhCN: Record<keyof typeof immersiveEn, string> = {
  'immersive.exit': '退出沉浸',
  'immersive.fullscreen': '全屏',
  'immersive.exitFullscreen': '退出全屏',
  'immersive.stereoUnavailable': '没有立体声波形',
  'immersive.lyricsPlain': '纯文本 · {n} 行',
  'immersive.noSpectrum': '无频谱数据',
  'immersive.waveformPending': '正在分析整轨波形…',
  'immersive.waveformUnavailable': '整轨波形不可用',
  'immersive.waveformMode': '波形显示方式',
  'immersive.waveformRms': '全频 RMS',
  'immersive.waveformWeighted': 'A 计权',
  'immersive.waveformMidHigh': '中高频',
  'immersive.waveformLayers': '三频叠加',
  'immersive.waveformLanes': '三频分道',
  'immersive.waveformBandsFailed': '分频数据不可用，按全频显示',
};
