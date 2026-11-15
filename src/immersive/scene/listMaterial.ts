import { tokens } from '@fluentui/react-components';
import { useMediaQuery } from '../../kit/useMediaQuery.ts';
import { capsuleTint } from '../../theme/capsuleMaterial.ts';
import { useSceneFrame } from './sceneContext.ts';

const BACKGROUND = 'var(--colorNeutralBackground1)';
const FOREGROUND = 'var(--colorNeutralForeground1)';
const ACCENT = 'var(--accent)';

// 微软 WinUI 3 的 AcrylicBrush 实现里的常量：高斯模糊 30、饱和度 1.25、噪点不透明度 0.02（普通叠加）
const ACRYLIC_BLUR_FILTER = 'blur(30px) saturate(1.25)';
const ACRYLIC_NOISE_OPACITY = 0.02;

// 点光源偏左投射：行卡垂直间距仅 2px，向下投射会污染下方半透明卡片，故阴影主要向右延展并加负扩展收紧上下边缘；
// 多层递增位移与模糊半径并叠合极淡环境层，使阴影浓度平滑衰减，避免单层高浓度阴影产生硬边；
// 色值取 Fluent 阴影色按比例减淡，右侧阴影显示空间由队列滚动容器预留（见 CardColumn 样式）
const SHADOW_AMBIENT = tokens.colorNeutralShadowAmbient;
const SHADOW_KEY = tokens.colorNeutralShadowKey;
const SHADOW_FLOAT = `var(--scene-shadow, ${tokens.colorNeutralShadowKeyDarker})`;
const CARD_SHADOW = [
  `0 0 2px ${capsuleTint(SHADOW_AMBIENT, 50)}`,
  `2px 0 4px ${capsuleTint(SHADOW_KEY, 30)}`,
  `6px 1px 12px ${capsuleTint(SHADOW_KEY, 32)}`,
  `10px 2px 22px -2px ${capsuleTint(SHADOW_KEY, 36)}`,
].join(', ');
const COLUMN_SHADOW = [
  `0 0 2px ${capsuleTint(SHADOW_AMBIENT, 50)}`,
  `3px 0 8px ${capsuleTint(SHADOW_FLOAT, 20)}`,
  `8px 1px 18px ${capsuleTint(SHADOW_FLOAT, 22)}`,
  `14px 2px 32px -4px ${capsuleTint(SHADOW_FLOAT, 24)}`,
].join(', ');

/** 一组列表底：缺省、悬停、选中、选中又悬停，已播的行，噪点的不透明度与背后的模糊 */
export interface ListMaterial {
  readonly fill: string;
  readonly hover: string;
  readonly selected: string;
  readonly selectedHover: string;
  /** 已播的行（队列页「前面的曲目」）的底，比缺省底更深 */
  readonly playedFill: string;
  /** 已播的行里内容的不透明度与去色程度（0 到 1，去色 1 是全灰），悬停、选中时回到原样 */
  readonly playedContent: number;
  readonly playedGray: number;
  readonly grain: number;
  /** 行卡与节头卡的外阴影 */
  readonly shadow: string;
  /** 浮起的面板、工具条与列头药丸的外阴影 */
  readonly columnShadow: string;
  /** 背后的模糊滤镜，`none` 是不模糊；由列外壳的磨砂层使用 */
  readonly blur: string;
}

function mix(color: string, percent: number, base: string): string {
  return `color-mix(in srgb, ${color} ${percent}%, ${base})`;
}

/**
 * 以中性底色着色的一组底：缺省底是 `tint`% 的深灰，悬停在缺省底上加前景色 10%，选中加封面强调色 30%，选中又悬停两者都加，
 * 持续状态与悬停同时出现时仍分得开；已播的行底更深（`tint` 加 22 个百分点），内容降到 55%、去掉三成颜色（封面暗淡而不全灰）
 */
function tinted(tint: number, grain: number, blur: string): ListMaterial {
  const fill = capsuleTint(BACKGROUND, tint);
  const hover = mix(FOREGROUND, 10, fill);
  return {
    fill,
    hover,
    selected: mix(ACCENT, 30, fill),
    selectedHover: mix(ACCENT, 30, hover),
    playedFill: capsuleTint(BACKGROUND, Math.min(tint + 22, 97)),
    playedContent: 0.55,
    playedGray: 0.35,
    grain,
    shadow: CARD_SHADOW,
    columnShadow: COLUMN_SHADOW,
    blur,
  };
}

/**
 * 队列与历史页行卡、节头卡共用的亚克力质感，参数取 WinUI 3 AcrylicBrush：背后高斯模糊 30、饱和度 1.25，
 * 深灰着色，噪点为普通叠加纹理（灰度均值 128、标准差约 53、不透明），不透明度 0.02；
 * 以半透明深灰近似亮度混合，缺省 40% 与工具条（45%）同族；队列行卡、节头卡与历史页行各自对底层模糊，参数集中于此维护
 */
const AIRY = tinted(40, ACRYLIC_NOISE_OPACITY, ACRYLIC_BLUR_FILTER);

/** 降级与减弱透明度时的底：近实底（94%），不画噪点、不模糊 */
const PLAIN = tinted(94, 0, 'none');

const REDUCED_TRANSPARENCY = '(prefers-reduced-transparency: reduce)';

/** 当前该用的列表底：帧率守门判定背景扛不住（`frame.degraded`）或系统要求减弱透明度时换成不带噪点、不模糊的一档 */
export function useListMaterial(): ListMaterial {
  const degraded = useSceneFrame().degraded;
  const reduced = useMediaQuery(REDUCED_TRANSPARENCY);
  return degraded || reduced ? PLAIN : AIRY;
}

/**
 * 把一组列表底写成列外壳上的变量，名字就是队列行、节头与列表样式读的那一组（变量清单见 `scene/cardVariables.ts`），
 * 列外壳以下的页面直接继承，不再改名转写
 */
export function listMaterialVariables(material: ListMaterial): Record<`--${string}`, string> {
  return {
    '--queue-card-bg': material.fill,
    '--queue-card-hover': material.hover,
    '--queue-card-selected': material.selected,
    '--queue-card-selected-hover': material.selectedHover,
    '--queue-card-grain': String(material.grain),
    '--queue-card-blur': material.blur,
    '--queue-card-shadow': material.shadow,
    '--queue-played-bg': material.playedFill,
    '--queue-played-content': String(material.playedContent),
    '--queue-played-gray': String(material.playedGray),
    '--column-shadow': material.columnShadow,
  };
}
