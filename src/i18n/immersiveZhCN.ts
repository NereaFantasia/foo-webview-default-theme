import type { immersiveEn } from './immersiveEn.ts';

/** 沉浸式正在播放视图的简体中文文案，供主中文包合入 */
export const immersiveZhCN: Record<keyof typeof immersiveEn, string> = {
  'immersive.exit': '退出沉浸',
  'immersive.view': '视图',
  'immersive.pages': '页签',
  'immersive.page.history': '历史',
  'immersive.expandSidebar': '展开侧栏',
  'immersive.collapseSidebar': '收起侧栏',
  'immersive.coverflow': 'Coverflow',
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
