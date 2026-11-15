import { MusicNote224Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { immersiveCoverAtom, immersiveCoverKey } from '../../covers/immersiveCover.ts';
import { usePresence } from '../../kit/usePresence.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { DURATION_MS, motionDuration } from '../../motion/timing.ts';
import { useLease } from '../lease/useLease.ts';
import { SCENE_COVER_LAYER } from '../scene/coverHolders.ts';
import { useCoverHolder } from '../scene/useCoverHolder.ts';
import styles from './BleedCover.module.css';
import { FEATHER_HOLD, featherMask, featherShapes } from './feather.ts';

/** 满幅封面的外观参数，单位与设置里写的一致：百分数、像素；`hold` 是羽化浓度的系数 */
export interface BleedLook {
  /** 羽化起点与宽度，盒宽的百分数 */
  readonly featherStart: number;
  readonly featherWidth: number;
  /** 羽化浓度，1 是纯五次平滑曲线，越大中段越不透明 */
  readonly hold: number;
  /** 模糊层的模糊半径，像素 */
  readonly blur: number;
  /** 底部压暗带的高度与浓度，百分数 */
  readonly scrimHeight: number;
  readonly scrimStrength: number;
  /** 封面缩放，百分数，100 是刚好铺满盒子 */
  readonly zoom: number;
  /** 取景的横纵位置，百分数 */
  readonly focusX: number;
  readonly focusY: number;
}

export const DEFAULT_BLEED_LOOK: BleedLook = {
  featherStart: 38,
  featherWidth: 42,
  hold: FEATHER_HOLD,
  blur: 7,
  scrimHeight: 26,
  scrimStrength: 50,
  zoom: 100,
  focusX: 42,
  focusY: 50,
};

export interface BleedCoverProps {
  /** 右缘羽化进背景；假时画成一块干净的矩形（封面居中、右边没有东西可融时用）。缺省真 */
  readonly feather?: boolean;
  readonly look?: BleedLook;
  /** 盒子的尺寸，CSS 像素；缩放不是 100% 时用它算图的显示尺寸，缺省不缩放 */
  readonly box?: { readonly width: number; readonly height: number };
  /**
   * 比共用封面更大的那一档图（按显示尺寸向宿主要的）：到了就换用它，没到或解不出来仍是共用的那张。
   * 共用封面只有 512 档，铺到大半个窗口会发软
   */
  readonly upgrade?: string | null;
  /**
   * 暂停滤镜：暂停时对封面整体施加去色、压暗、柔化滤镜，保持轮廓并呈现静止状态，不缩放。
   * 预设在暂停时启用；缺省假
   */
  readonly veil?: boolean;
}

type Variables = CSSProperties & Record<`--${string}`, string>;

/** 一张已经解码好的图，`fade` 为真时挂上来要从透明淡入 */
interface Layer {
  readonly id: number;
  readonly url: string;
  readonly fade: boolean;
  /** 解码后的原始像素尺寸 */
  readonly natural: { readonly width: number; readonly height: number };
}

/**
 * 叠放的封面图层最多保留数量：新图层置于旧图层之上，最新图层淡入播放完毕后再卸载底层图层（`settle`）。
 * 若淡入未完成即到达更新图层（如换曲后先收到共用封面再收到大图），保留底层图层以避免半透明图层透出背景导致过渡闪烁。
 * 超过该上限时按先进先出清理最早图层
 */
const KEPT_LAYERS = 4;

interface LayerReport {
  loaded(url: string): void;
  broken(url: string): void;
}

/**
 * 当前封面的叠层：新图在后台解码完才叠上来，旧图全程留着免得白闪；解码成败各回报一次。首张不淡入，
 * 进视图时已经显示着的图也不淡入，淡入的是换曲或换成更大的那一档
 */
function useCoverLayers(
  target: string | null,
  keep: boolean,
  initial: string | null,
  report: LayerReport,
) {
  // 挂载时共用的封面已经在手（别处解码过）就先放一层，进视图的第一帧不空着；更大的那一档还没解码，
  // 不能当首层：它读不出来就是一层空白。原始尺寸要等解码，先记 0
  const [layers, setLayers] = useState<readonly Layer[]>(() =>
    initial ? [{ id: 1, url: initial, fade: false, natural: { width: 0, height: 0 } }] : [],
  );
  const counter = useRef(1);
  const latest = useRef(report);
  useLayoutEffect(() => {
    latest.current = report;
  });
  // 确定无封面时清理图层。切歌过渡期间封面地址短暂为空且 `keep` 为真，此时保留上一张图以供新封面淡入叠加，
  // 避免半透明图层透出背景导致过渡闪烁
  if (target === null && !keep && layers.length > 0) setLayers([]);
  useEffect(() => {
    if (target === null) return;
    let cancelled = false;
    const image = new Image();
    image.src = target;
    image.decode().then(
      () => {
        if (cancelled) return;
        latest.current.loaded(target);
        const natural = { width: image.naturalWidth, height: image.naturalHeight };
        setLayers((current) => {
          const last = current.at(-1);
          if (last?.url === target) {
            return last.natural.width > 0
              ? current
              : [...current.slice(0, -1), { ...last, natural }];
          }
          counter.current += 1;
          const next = { id: counter.current, url: target, fade: current.length > 0, natural };
          return [...current.slice(1 - KEPT_LAYERS), next];
        });
      },
      () => {
        if (!cancelled) latest.current.broken(target);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [target]);
  /** 淡入播完：这一张之前的都不要了 */
  const settle = (id: number) =>
    setLayers((current) => {
      const index = current.findIndex((layer) => layer.id === id);
      return index > 0 ? current.slice(index) : current;
    });
  return [layers, settle] as const;
}

/**
 * 一张图在盒子里的显示尺寸：缩放 100% 时就是 `cover`；否则按 `cover` 的比例再乘缩放，
 * 需要图的原始像素尺寸，没有盒子尺寸时仍用 `cover`
 */
function sizeOf(layer: Layer, zoom: number, box: BleedCoverProps['box']): string {
  const { width, height } = layer.natural;
  if (zoom === 100 || !box || width <= 0 || height <= 0) return 'cover';
  const scale = Math.max(box.width / width, box.height / height) * (zoom / 100);
  return `${Math.round(width * scale)}px ${Math.round(height * scale)}px`;
}

function imageStyle(layer: Layer, look: BleedLook, box: BleedCoverProps['box']): Variables {
  return {
    '--bleed-image': `url(${JSON.stringify(layer.url)})`,
    '--bleed-size': sizeOf(layer, look.zoom, box),
  };
}

/**
 * 满幅封面：占满外框给的盒子，封面按 `cover` 取景铺满，右缘径向羽化进背景
 *
 * 三层同盒同取景：素层（无 mask，只在不羽化时显示）、模糊层（blur 加放大，尾段羽化更远）、清晰层（更早羽化完），
 * 中段露出纯模糊、尾段透出背景；底部一条压暗带托住上面的控制。几何见 `feather.ts`，外观参数见 `BleedLook`。
 * 暂停滤镜（`veil`）作用于封面根节点并与羽化带同步生效，详见样式。
 * 每一层是一个带遮罩的容器，里面按换曲的先后放着一张张图；遮罩不能放在每张图上（见 `images`）
 *
 * 层上不写 CSS 过渡：封面带着共享名字走视图过渡，新旧两份快照由浏览器交叉渐变，层自己再过渡会让新快照取到半透明。
 * 封面资源由 `immersiveCoverKey` 托管，与方形封面、背景共用一份（512 档）；更大的那一档由 `upgrade` 给，
 * 解不出来就退回共用的。没有封面时只留居中的音符，背景退回中性；加载中保持上一张或透明，不闪占位。
 * 通过 `useCoverHolder` 持有共享过渡名字，纯装饰。根节点上的 `data-cover-natural`（正在显示的那张图的原始像素）
 * 与 `data-cover-source`（`large` 是更大的那一档，`shared` 是共用的）给排查画质用
 */
export function BleedCover({
  feather = true,
  look = DEFAULT_BLEED_LOOK,
  box,
  upgrade = null,
  veil = false,
}: BleedCoverProps) {
  const cover = useAtomValueRawSync(immersiveCoverAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  // 暂停滤镜相位：退出阶段的 167 ms 保持退场状态以播放退场动画；进入视图时已暂停则直接展示，不播放动画
  const veiled = usePresence(veil, motionDuration(DURATION_MS.fast, reduced));
  const service = useLease(immersiveCoverKey);
  const holder = useCoverHolder(SCENE_COVER_LAYER);
  const shared = cover.status === 'loading' || cover.status === 'shown' ? cover.url : null;
  const [bad, setBad] = useState<string | null>(null);
  const large = upgrade !== null && upgrade !== bad ? upgrade : null;
  const target = shared === null ? null : (large ?? shared);
  // 共用封面的解码成败要回报给服务（它据此判定缺图）；更大的那一档读不出来只是退回共用的，不算缺图
  const token = useRef(cover.token);
  useLayoutEffect(() => {
    token.current = cover.token;
  });
  const waiting = cover.status === 'loading' && cover.url === null;
  const [layers, settle] = useCoverLayers(target, waiting, shared, {
    loaded: (url) => {
      if (url === shared || url === large) service?.markLoaded(token.current);
    },
    broken: (url) => {
      if (url === shared) service?.markFailed(token.current);
      else setBad(url);
    },
  });
  const variables = useMemo<Variables>(() => {
    const shapes = featherShapes(look.featherStart, look.featherWidth);
    return {
      '--bleed-mask-sharp': featherMask(shapes.sharp, look.hold),
      '--bleed-mask-blur': featherMask(shapes.blur, look.hold),
      '--bleed-blur': `${look.blur}px`,
      '--bleed-focus': `${look.focusX}% ${look.focusY}%`,
      '--bleed-scrim-height': `${look.scrimHeight}%`,
      '--bleed-scrim': `color-mix(in srgb, var(--colorNeutralBackground1) ${look.scrimStrength}%, transparent)`,
    };
  }, [look]);
  const top = layers.at(-1);
  // 三个容器各放一份相同的图层列表：遮罩与模糊缩放均声明在容器层并统一执行，图层在容器内部完成交叉渐变
  // 若单独为每张图层叠加遮罩，叠加处的半透明羽化带不透明度将异常升高，导致切歌淡入时边缘亮度突变；
  // 淡入完成事件仅由清晰层触发一次
  const images = (report: boolean) =>
    layers.map((layer) => (
      <div
        key={layer.id}
        className={styles.image}
        data-fade={layer.fade || undefined}
        style={imageStyle(layer, look, box)}
        onAnimationEnd={report ? () => settle(layer.id) : undefined}
      />
    ));
  return (
    <div
      ref={holder}
      className={styles.cover}
      data-scene-element="cover"
      data-edit-target="cover"
      data-feather={feather || undefined}
      data-veil={veiled.mounted ? veiled.phase : undefined}
      data-cover-natural={
        top && top.natural.width > 0 ? `${top.natural.width}x${top.natural.height}` : undefined
      }
      data-cover-source={top ? (top.url === large ? 'large' : 'shared') : undefined}
      style={variables}
      aria-hidden
    >
      <div className={styles.plain}>{images(false)}</div>
      <div className={styles.blur}>{images(false)}</div>
      <div className={styles.sharp}>{images(true)}</div>
      {layers.length > 0 && look.scrimStrength > 0 && look.scrimHeight > 0 && (
        <div className={styles.scrim} />
      )}
      {target === null && !waiting && (
        <div className={styles.placeholder}>
          <MusicNote224Regular className={styles.note} />
        </div>
      )}
    </div>
  );
}
