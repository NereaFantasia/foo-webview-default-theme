import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useEffect, useRef } from 'react';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { colorSchemeAtom } from '../../theme/colorScheme.ts';
import { coverRampAtom as accentRampAtom } from '../../theme/accentState.ts';
import { useViewServices } from '../page/viewServices.ts';
import { canvasRatio } from '../paper/stageScale.ts';
import { perfOverlayEnabledAtom, reportTerrain } from '../perf/perfOverlay.ts';
import { ALPHA_FAR, ALPHA_NEAR, HORIZON_RATIO } from './terrain.ts';
import { domTerrainBackends } from './domTerrainBackends.ts';
import type { TerrainPaintSettings } from './terrainPainter.ts';
import { mountTerrain, type TerrainMount } from './terrainMount.ts';
import styles from './TerrainCanvas.module.css';

/** 线色取的 token；山脊图只描边，没有底色。 */
const LINE_TOKEN = '--colorNeutralForeground1';
/** 还没量到帧距时按 60 fps 订阅的名义帧距算滑动。 */
const NOMINAL_INTERVAL_MS = 1000 / 60;

/** 挂载时的起点；透明度、滑动、线色、帧距与尺寸随后由各 effect 按当前值改写。 */
const BASE_SETTINGS: TerrainPaintSettings = {
  width: 0,
  height: 0,
  pixelRatio: 1,
  lineColor: '',
  horizonRatio: HORIZON_RATIO,
  alphaNear: ALPHA_NEAR,
  alphaFar: ALPHA_FAR,
  curve: true,
  frameInterval: NOMINAL_INTERVAL_MS,
  glide: true,
  frozen: false,
};

const lineColorOf = (element: Element): string =>
  getComputedStyle(element).getPropertyValue(LINE_TOKEN).trim();

export interface TerrainCanvasProps {
  /** 加在铺满父元素的那一层上，改它的位置与尺寸。 */
  readonly className?: string;
  /** 最近一行与最远一行的线透明度，缺省取 `terrain.ts` 的 `ALPHA_NEAR`、`ALPHA_FAR`。 */
  readonly alphaNear?: number;
  readonly alphaFar?: number;
}

/**
 * 山脊图：铺满父元素，canvas 按 CSS 尺寸 × 设备像素比开物理像素，线宽是 1 物理像素。数据是山脊图自己的缓冲
 * （`terrainHistory.ts`），每推一行重画；两帧之间按频谱的实测帧距滑动，帧停了滑完即止（`terrainPainter.ts`）。
 * 播放暂停时缓冲不推行，山脊停在暂停那一刻。页面的服务没起来时不画，canvas 也不建。
 *
 * 在哪条路上画、出错怎么退见 `terrainMount.ts`；canvas 由 `domTerrainBackends.ts` 在这一层里建，出错时整块换掉，
 * 不经 React 渲染：转给 Worker 的 canvas 不能再转，严格模式下挂第二次、服务重起时都用新的一块。
 *
 * 颜色：canvas 读不到 CSS 变量，线色按 token 名 `getComputedStyle` 现读成字符串，在挂载、封面 ramp 变、深浅档变、
 * 尺寸变时各读一次，不进帧循环。减弱动效下不滑，只在帧到时重画。
 */
export function TerrainCanvas({
  className,
  alphaNear = ALPHA_NEAR,
  alphaFar = ALPHA_FAR,
}: TerrainCanvasProps) {
  const store = useStore();
  const { terrain, spectrum } = useViewServices();
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const metered = useAtomValueRawSync(perfOverlayEnabledAtom);
  const ramp = useAtomValueRawSync(accentRampAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const box = useRef<HTMLDivElement>(null);
  const mount = useRef<TerrainMount | null>(null);

  // 这一个要最先：下面几个在挂载时按声明顺序跑，都往它这里写当前值，最后一个才起画师。
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const target = mountTerrain(domTerrainBackends(element, styles.canvas), BASE_SETTINGS);
    mount.current = target;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      // 颜色也可能随断点变，换尺寸时一并重读。
      target.update({
        width: rect.width,
        height: rect.height,
        pixelRatio: canvasRatio(1),
        lineColor: lineColorOf(element),
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      target.dispose();
      if (mount.current === target) mount.current = null;
    };
  }, []);

  useEffect(() => {
    const element = box.current;
    if (element) mount.current?.update({ lineColor: lineColorOf(element) });
  }, [ramp, scheme]);

  useEffect(() => {
    mount.current?.update({ alphaNear, alphaFar });
  }, [alphaNear, alphaFar]);

  useEffect(() => {
    mount.current?.update({ glide: !reduced });
  }, [reduced]);

  useEffect(() => {
    mount.current?.meter(
      metered ? (thread, surface, stats) => reportTerrain(store, thread, surface, stats) : null,
    );
  }, [store, metered]);

  useEffect(() => {
    const target = mount.current;
    if (!target) return;
    let interval = spectrum?.interval() ?? NOMINAL_INTERVAL_MS;
    target.update({ frameInterval: interval });
    target.setHistory(terrain?.history ?? null);
    if (!terrain) return;
    return terrain.subscribe(() => {
      const next = spectrum?.interval() ?? NOMINAL_INTERVAL_MS;
      if (next !== interval) {
        interval = next;
        target.update({ frameInterval: next });
      }
      target.frameArrived();
    });
  }, [terrain, spectrum]);

  return (
    <div
      ref={box}
      className={className ? `${styles.terrain} ${className}` : styles.terrain}
      data-terrain
      aria-hidden
    />
  );
}
