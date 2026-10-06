import { expect, test } from 'vitest';
import type { CoverSource } from '../../../../src/immersive/wash/coverSource.ts';
import {
  offer,
  retire,
  reveal,
  type WashLayer,
} from '../../../../src/immersive/wash/washLayers.ts';

const cover = (token: number): CoverSource => ({
  token,
  image: { width: 1, height: 1, data: new Uint8ClampedArray(4), colorSpace: 'srgb' },
});
const states = (layers: readonly WashLayer[]) =>
  layers.map((layer) => `${layer.key}:${layer.state}`);

test('第一张封面：先挂成待显层，画出第一帧才显出来', () => {
  const pending = offer([], cover(1), 'flow');
  expect(states(pending)).toStrictEqual(['flow-1:pending']);
  expect(states(reveal(pending, 'flow-1'))).toStrictEqual(['flow-1:shown']);
});

test('换一张封面：新层显出来时旧层留在底下被盖住，淡入走完才撤', () => {
  const shown = reveal(offer([], cover(1), 'flow'), 'flow-1');
  const next = offer(shown, cover(2), 'flow');
  expect(states(next)).toStrictEqual(['flow-1:shown', 'flow-2:pending']);
  const crossing = reveal(next, 'flow-2');
  expect(states(crossing)).toStrictEqual(['flow-1:covered', 'flow-2:shown']);
  expect(states(retire(crossing, 'flow-1'))).toStrictEqual(['flow-2:shown']);
  expect(states(retire(crossing, 'flow-2'))).toStrictEqual(states(crossing));
});

test('还没显出来就被更新的源图顶替：待显层直接撤掉；同一张源图重复给不重挂', () => {
  const shown = reveal(offer([], cover(1), 'flow'), 'flow-1');
  const second = offer(shown, cover(2), 'flow');
  const third = offer(second, cover(3), 'flow');
  expect(states(third)).toStrictEqual(['flow-1:shown', 'flow-3:pending']);
  expect(states(offer(third, cover(3), 'flow'))).toStrictEqual(states(third));
  expect(states(offer(shown, cover(1), 'flow'))).toStrictEqual(states(shown));
  expect(states(reveal(third, 'flow-2'))).toStrictEqual(states(third));
});

test('没有封面可换：显着的层淡出，待显层撤掉；淡出走完撤掉', () => {
  const shown = reveal(offer([], cover(1), 'flow'), 'flow-1');
  const leaving = offer(offer(shown, cover(2), 'flow'), null, 'flow');
  expect(states(leaving)).toStrictEqual(['flow-1:leaving']);
  expect(retire(leaving, 'flow-1')).toStrictEqual([]);
});

test('流动档退到静态档：同一张源图换一档，也是先待显、画好再盖上去', () => {
  const shown = reveal(offer([], cover(4), 'flow'), 'flow-4');
  const fallback = offer(shown, cover(4), 'static');
  expect(states(fallback)).toStrictEqual(['flow-4:shown', 'static-4:pending']);
  expect(states(reveal(fallback, 'static-4'))).toStrictEqual(['flow-4:covered', 'static-4:shown']);
});
