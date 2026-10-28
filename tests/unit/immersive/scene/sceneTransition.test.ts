import { describe, expect, it, vi } from 'vitest';
import { CURVE, DURATION_MS } from '../../../../src/motion/timing.ts';
import {
  createSceneTransition,
  GLIDE_MS,
  GLIDE_SPEED,
  TRANSITION_ATTRIBUTE,
  type TransitionDocument,
} from '../../../../src/immersive/scene/sceneTransition.ts';

interface Deferred {
  readonly ready: Promise<unknown>;
  readonly finished: Promise<unknown>;
  /** 浏览器调更新回调：过渡里新状态是在这一步提交的 */
  runCallback(): void;
  finish(): Promise<void>;
  rejectReady(): void;
}

function fakeDocument(visibility: DocumentVisibilityState = 'visible', supported = true) {
  const dataset: DOMStringMap = {};
  const style = new Map<string, string>();
  const transitions: Deferred[] = [];
  const doc: TransitionDocument = {
    visibilityState: visibility,
    documentElement: {
      dataset,
      style: { setProperty: (name, value) => void style.set(name, value ?? '') },
    },
    ...(supported && {
      startViewTransition(update: () => void) {
        let resolveFinished: () => void = () => {};
        let rejectReady: () => void = () => {};
        const ready = new Promise<unknown>((_resolve, reject) => {
          rejectReady = () => reject(new Error('skipped'));
        });
        const finished = new Promise<unknown>((resolve) => {
          resolveFinished = () => resolve(undefined);
        });
        const entry: Deferred = {
          ready,
          finished,
          runCallback: update,
          finish: async () => {
            resolveFinished();
            await finished;
            await Promise.resolve();
          },
          rejectReady,
        };
        transitions.push(entry);
        return entry;
      },
    }),
  };
  return { doc, dataset, style, transitions };
}

function setup(
  options: { reduced?: boolean; visibility?: DocumentVisibilityState; supported?: boolean } = {},
) {
  const fake = fakeDocument(options.visibility, options.supported);
  const flush = vi.fn((update: () => void) => update());
  const run = createSceneTransition({
    document: fake.doc,
    flush,
    reduced: () => options.reduced ?? false,
  });
  return { ...fake, flush, run };
}

describe('场景动作的过渡', () => {
  it('更新放进过渡回调里同步提交，回调之前状态不动', () => {
    const { run, flush, transitions } = setup();
    const update = vi.fn();
    run(update);
    expect(transitions).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
    transitions[0]!.runCallback();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('过渡期间根上有标记与时长曲线变量，结束后摘掉', async () => {
    const { run, dataset, style, transitions } = setup();
    run(() => {});
    expect(TRANSITION_ATTRIBUTE in dataset).toBe(true);
    expect(style.get('--scene-glide-duration')).toBe('500ms');
    expect(style.get('--scene-fade-duration')).toBe('166ms');
    expect(style.get('--scene-exit-duration')).toBe('334ms');
    // 已在场元素的移动与缩放走点到点
    expect(style.get('--scene-glide-easing')).toBe(CURVE.pointToPoint.timing);
    await transitions[0]!.finish();
    expect(TRANSITION_ATTRIBUTE in dataset).toBe(false);
  });

  it('放慢到原来速度的五成：时长是 Windows 11 的时长除以速度，侧栏卸载按同一个数', () => {
    expect(GLIDE_SPEED).toBe(0.5);
    expect(GLIDE_MS).toBe(Math.round(DURATION_MS.normal / GLIDE_SPEED));
  });

  it('连续触发时标记留到最后一个过渡结束', async () => {
    const { run, dataset, transitions } = setup();
    run(() => {});
    run(() => {});
    expect(transitions).toHaveLength(2);
    await transitions[0]!.finish();
    expect(TRANSITION_ATTRIBUTE in dataset).toBe(true);
    await transitions[1]!.finish();
    expect(TRANSITION_ATTRIBUTE in dataset).toBe(false);
  });

  it('过渡被跳过（重名等）时不抛未处理的拒绝，标记照样摘掉', async () => {
    const { run, dataset, transitions } = setup();
    run(() => {});
    transitions[0]!.rejectReady();
    await Promise.resolve();
    await transitions[0]!.finish();
    expect(TRANSITION_ATTRIBUTE in dataset).toBe(false);
  });

  it.each([
    ['减弱动效', { reduced: true }],
    ['窗口看不见', { visibility: 'hidden' as const }],
    ['没有这套接口', { supported: false }],
  ])('%s时直接改，不起过渡也不留标记', (_name, options) => {
    const { run, dataset, transitions, flush } = setup(options);
    const update = vi.fn();
    run(update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(transitions).toHaveLength(0);
    expect(flush).not.toHaveBeenCalled();
    expect(TRANSITION_ATTRIBUTE in dataset).toBe(false);
  });

  it('没有文档时直接改', () => {
    const run = createSceneTransition({
      document: null,
      flush: (fn) => fn(),
      reduced: () => false,
    });
    const update = vi.fn();
    run(update);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
