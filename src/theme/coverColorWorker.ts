import { profileFromPixels } from './coverPalette.ts';

addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!(event.data instanceof Uint8ClampedArray)) throw new Error('封面像素无效');
  const random = Math.random;
  let state = 42;
  // Celebi 内部使用随机初值；仅在独立 Worker 的同步分析期间固定，避免影响页面随机源。
  Math.random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  try {
    postMessage(profileFromPixels(event.data));
  } finally {
    Math.random = random;
  }
});
