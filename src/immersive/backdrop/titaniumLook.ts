import { BackgroundRender, TitaniumRenderer } from '@applemusic-like-lyrics/core';
import type { BackdropRenderer } from './backdropRegistry.ts';

/** 钛金属背景的构图：颗粒位置、主题色落到四个角的顺序、锋线姿态 */
export interface TitaniumLook {
  /** 这组构图属于哪张封面 */
  readonly cover: string;
  readonly seed: readonly number[];
  readonly grainOffset: readonly number[];
  readonly paletteOrder: readonly number[];
  readonly crest: readonly number[];
}

/** 退场时记下的构图；渲染器随视图销毁重建，不记就每次进来都换一副 */
export interface LookMemory {
  look: TitaniumLook | null;
}

const sessionMemory: LookMemory = { look: null };

/** 上游渲染器里决定构图的成员：类型声明标了私有，运行时可读写 */
interface LookFields {
  readonly seed: Float32Array;
  readonly grainOffset: Float32Array;
  readonly paletteOrder: Uint8Array;
  readonly crestMotion: Float32Array;
  readonly crestFrom: Float32Array;
  readonly crestTo: Float32Array;
  crestShiftElapsed: number;
  rollPaletteOrder: () => void;
  rollCrestTarget: () => void;
}

/** 上游换版后这些成员对不上就返回假，背景照上游原样随机，不影响使用 */
function isLookFields(value: unknown): value is LookFields {
  if (typeof value !== 'object' || value === null) return false;
  const get = (key: string): unknown => Reflect.get(value, key);
  return (
    get('seed') instanceof Float32Array &&
    get('grainOffset') instanceof Float32Array &&
    get('paletteOrder') instanceof Uint8Array &&
    get('crestMotion') instanceof Float32Array &&
    get('crestFrom') instanceof Float32Array &&
    get('crestTo') instanceof Float32Array &&
    typeof get('crestShiftElapsed') === 'number' &&
    typeof get('rollPaletteOrder') === 'function' &&
    typeof get('rollCrestTarget') === 'function'
  );
}

/** TitaniumHost 扩展接口契约：提供底层渲染器实例访问能力 */
export interface TitaniumHost extends BackdropRenderer {
  getRenderer(): unknown;
}

/**
 * 钛金属背景渲染构图状态持久化封装
 *
 * 维持进出沉浸视图期间的构图连续性：颗粒分布在退出时记录并在重新进入时还原；
 * 色序与锋线姿态在同一张封面复用时保持几何直接就位，颜色执行常规淡入过渡；
 * 封面切换后交由底层渲染器重新随机生成姿态
 */
export function createTitaniumBackdrop(
  make: () => TitaniumHost = () => BackgroundRender.new(TitaniumRenderer),
  memory: LookMemory = sessionMemory,
): BackdropRenderer {
  const host = make();
  const fields = host.getRenderer();
  if (!isLookFields(fields)) return host;
  let restore = memory.look;
  if (restore) {
    fields.seed.set(restore.seed);
    fields.grainOffset.set(restore.grainOffset);
  }
  // 正在换的封面要放回的构图；上游在换封面的后半段（图加载完之后）才调这两个掷骰子的方法
  let pending: TitaniumLook | null = null;
  const rollPalette = fields.rollPaletteOrder.bind(fields);
  const rollCrest = fields.rollCrestTarget.bind(fields);
  fields.rollPaletteOrder = () => {
    if (!pending) {
      rollPalette();
      return;
    }
    fields.paletteOrder.set(pending.paletteOrder);
    // 色序是这次换封面里最后掷的一项
    pending = null;
  };
  fields.rollCrestTarget = () => {
    if (!pending) {
      rollCrest();
      return;
    }
    for (const pose of [fields.crestMotion, fields.crestFrom, fields.crestTo]) {
      pose.set(pending.crest);
    }
    fields.crestShiftElapsed = Number.POSITIVE_INFINITY;
  };
  let requested = '';
  let settled = '';
  return {
    getElement: () => host.getElement(),
    setAlbum(source) {
      requested = source;
      if (source !== '') {
        pending = restore?.cover === source ? restore : null;
        restore = null;
      }
      return host.setAlbum(source).then(() => {
        if (requested === source) settled = source;
      });
    },
    setRenderScale: (scale) => host.setRenderScale(scale),
    setLowFreqVolume: (volume) => host.setLowFreqVolume(volume),
    setFPS: (fps) => host.setFPS(fps),
    setStaticMode: (enable) => host.setStaticMode(enable),
    setHasLyric: (has) => host.setHasLyric(has),
    dispose() {
      if (settled !== '') {
        memory.look = {
          cover: settled,
          seed: [...fields.seed],
          grainOffset: [...fields.grainOffset],
          paletteOrder: [...fields.paletteOrder],
          crest: [...fields.crestTo],
        };
      }
      host.dispose();
    },
  };
}
