import { fb } from 'foo-webview-sdk/bridge';
import { createKugouSource } from '../../src/lyrics/online/kugou.ts';
import { createLrclibSource } from '../../src/lyrics/online/lrclib.ts';
import { createLrcmuxSource } from '../../src/lyrics/online/lrcmux.ts';
import { createNeteaseSource } from '../../src/lyrics/online/netease.ts';
import { createTtmlDbSource } from '../../src/lyrics/online/ttmlDb.ts';

/** 浏览器中的真实 SDK 调用交给页面宿主应答，解析器保留真实 DOMParser 与解压能力。 */
export const lyricsProbeSources = [
  createLrclibSource(fb),
  createNeteaseSource(fb),
  createKugouSource(fb),
  createTtmlDbSource(fb),
  createLrcmuxSource(fb),
];
