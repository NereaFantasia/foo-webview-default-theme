import type { BackdropChoice } from '../theme/backdrop.ts';
import type { BackgroundSource } from '../theme/background/windowBackground.ts';

/**
 * 窗口背景选项分类；映射底层的背景来源（`source`）与材质首选项（`choice`）
 *
 * 主题纯色对应无原生材质（`choice === 'none'`），系统材质对应具体材质档位
 */
export const BACKGROUND_TILES = ['theme', 'material', 'cover', 'palette', 'image'] as const;
export type BackgroundTile = (typeof BACKGROUND_TILES)[number];

/** 可选的原生材质档位；`none` 归入主题纯色选项，不在该列表中 */
export const MATERIAL_CHOICES = [
  'inherit',
  'mica',
  'mica-alt',
  'acrylic',
] as const satisfies readonly BackdropChoice[];

/**
 * 解析当前生效的背景选项
 *
 * 当原生材质发生回退时，无论材质偏好设置为何值，均回落为主题纯色
 */
export function selectedTile(
  source: BackgroundSource,
  choice: BackdropChoice,
  fellBack: boolean,
): BackgroundTile {
  if (source !== 'material') return source;
  return fellBack || choice === 'none' ? 'theme' : 'material';
}

export interface TileAction {
  readonly source: BackgroundSource;
  /** 待更新的材质档位；保持当前材质时缺省 */
  readonly choice?: BackdropChoice;
}

/**
 * 计算选中指定背景选项时的写入动作
 *
 * 封面、色场与图片模式仅切换背景来源并保留原材质配置；从主题色切回系统材质时恢复为跟随首选项
 */
export function tileAction(tile: BackgroundTile, choice: BackdropChoice): TileAction {
  switch (tile) {
    case 'theme':
      return { source: 'material', choice: 'none' };
    case 'material':
      return choice === 'none' ? { source: 'material', choice: 'inherit' } : { source: 'material' };
    default:
      return { source: tile };
  }
}
