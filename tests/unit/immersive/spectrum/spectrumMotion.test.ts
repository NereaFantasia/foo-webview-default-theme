import { describe, expect, it } from 'vitest';
import {
  attackFor,
  PEAK_FALL_PER_S,
  releaseFor,
  SPECTRUM_BARS,
} from '../../../../src/immersive/spectrum/spectrumBars.ts';
import {
  createSpectrumMotion,
  SETTLE_MS,
  type SpectrumInput,
} from '../../../../src/immersive/spectrum/spectrumMotion.ts';

const HALF = new Float32Array(SPECTRUM_BARS).fill(0.5);
const FULL = new Float32Array(SPECTRUM_BARS).fill(1);
const LIVE: SpectrumInput = { live: true, playing: true, interval: 1000 / 60, latest: HALF };
const QUIET: SpectrumInput = { ...LIVE, live: false };

/** 1000 ms 时来一帧、1016 ms 时画一步：柱与峰值点都在 0.5。 */
function playing() {
  const motion = createSpectrumMotion();
  motion.touch(1000);
  motion.frameArrived(1000);
  const more = motion.step(1016, LIVE, true);
  return { motion, more };
}

describe('createSpectrumMotion', () => {
  it('帧新鲜时柱直接跟到最新一帧、峰值点跟上，帧还在来就接着画', () => {
    const { motion, more } = playing();
    expect(more).toStrictEqual(true);
    expect(motion.levels[0]).toStrictEqual(0.5);
    expect(motion.peaks[SPECTRUM_BARS - 1]).toStrictEqual(0.5);
  });

  it('不在出帧时柱按经过的时间回落', () => {
    const { motion } = playing();
    motion.step(1050, QUIET, true);
    expect(motion.levels[0]).toStrictEqual(Math.fround(0.5 * releaseFor(34)));
  });

  it('帧停了超过 SETTLE_MS 柱落到底；峰值点停够了再落，都落到底后答不用再画', () => {
    const { motion } = playing();
    expect(motion.step(1000 + SETTLE_MS + 1, LIVE, true)).toStrictEqual(true);
    expect(motion.levels[0]).toStrictEqual(0);
    expect(motion.peaks[0]).toStrictEqual(0.5);
    expect(motion.step(5000, LIVE, true)).toStrictEqual(false);
    expect(motion.peaks[0]).toStrictEqual(0);
  });

  it('断点之后的时长里起音按时间追向目标，过了时长照常瞬到', () => {
    const motion = createSpectrumMotion();
    motion.touch(1000);
    motion.frameArrived(1000);
    motion.soften(1000, 250);
    motion.step(1016, LIVE, true);
    expect(motion.levels[0]).toStrictEqual(Math.fround(0.5 * attackFor(16, 250)));
    motion.frameArrived(1300);
    motion.step(1300, { ...LIVE, latest: FULL }, true);
    expect(motion.levels[0]).toStrictEqual(1);
  });

  it('断点让峰值点不再停留、从这一刻起就落', () => {
    const { motion } = playing();
    motion.soften(1100, 250);
    motion.step(1100, QUIET, true);
    expect(motion.peaks[0]).toStrictEqual(Math.fround(0.5 - (PEAK_FALL_PER_S * 84) / 1000));
  });

  it('暂停时画面上有柱就定格；恢复后按暂停的时长后挪，帧不算停、峰值点照停', () => {
    const { motion } = playing();
    motion.pause(1020, true);
    expect(motion.holding()).toStrictEqual(true);
    motion.frameArrived(1500);
    expect(motion.step(3000, { ...LIVE, playing: false }, true)).toStrictEqual(false);
    expect(motion.levels[0]).toStrictEqual(0.5);
    motion.resume(5020);
    expect(motion.holding()).toStrictEqual(false);
    expect(motion.step(5032, QUIET, true)).toStrictEqual(true);
    expect(motion.peaks[0]).toStrictEqual(0.5);
    motion.step(5040, LIVE, true);
    expect(motion.levels[0]).toStrictEqual(0.5);
  });

  it('画面上没有东西、或减弱动效时暂停不定格；撤掉订阅就解除定格', () => {
    const blank = createSpectrumMotion();
    blank.pause(0, true);
    expect(blank.holding()).toStrictEqual(false);

    const { motion } = playing();
    motion.pause(1020, false);
    expect(motion.holding()).toStrictEqual(false);
    motion.pause(1020, true);
    motion.release();
    expect(motion.holding()).toStrictEqual(false);
  });

  it('减弱动效下柱直接跟随、不走峰值点，一步之后不再排', () => {
    const motion = createSpectrumMotion();
    motion.touch(1000);
    motion.frameArrived(1000);
    expect(motion.step(1016, LIVE, false)).toStrictEqual(false);
    expect(motion.levels[0]).toStrictEqual(0.5);
    expect(motion.peaks[0]).toStrictEqual(0);
    motion.step(1032, { ...LIVE, playing: false }, false);
    expect(motion.levels[0]).toStrictEqual(0);
  });
});
