import { makeStyles, tokens } from '@fluentui/react-components';
import {
  CAPSULE_BLUR,
  CAPSULE_FILTER,
  CAPSULE_GRAIN,
  capsuleTint,
} from '../../theme/capsuleMaterial.ts';
import { useSceneFrame } from './sceneContext.ts';

// 浮于内容上层的半透明条栏与面板复用胶囊材质规范（theme/capsuleMaterial.ts），对齐模糊、饱和度、着色与颗粒度；
// 面板内容含文本与候选卡，着色浓度提升至 60%；性能降级或减弱透明度时回退至 94% 不透明度纯色且不叠加噪点
export const ACRYLIC_FILTER = CAPSULE_FILTER;
/** 纯高斯模糊滤镜（供侧栏列等无需色调调节的区域使用） */
export const ACRYLIC_BLUR = CAPSULE_BLUR;
export const ACRYLIC_PANEL_TINT = capsuleTint(tokens.colorNeutralBackground1, 60);
export const ACRYLIC_SOLID_FILL = capsuleTint(tokens.colorNeutralBackground1, 94);
/** 条栏与控制按键着色基准（中性底色 45% 不透明度） */
export const ACRYLIC_BAR_TINT = capsuleTint(tokens.colorNeutralBackground1);

// 条栏阴影与封面组件规范对齐，优先复用宿主注入的 --scene-shadow 变量
export const ACRYLIC_SHADOW = `0 8px 24px var(--scene-shadow, ${tokens.colorNeutralShadowKeyDarker})`;

// 噪点纹理置于背景着色层之上、内容层之下（借助 isolate 与 -1 相对层级）
export const ACRYLIC_GRAIN = {
  content: '""',
  position: 'absolute',
  inset: 0,
  zIndex: -1,
  borderRadius: 'inherit',
  backgroundImage: "url('/cover-grain.png')",
  mixBlendMode: 'soft-light',
  opacity: CAPSULE_GRAIN,
  pointerEvents: 'none',
} as const;

const useBarStyles = makeStyles({
  bar: {
    backgroundColor: ACRYLIC_BAR_TINT,
    boxShadow: ACRYLIC_SHADOW,
    isolation: 'isolate',
    backdropFilter: ACRYLIC_FILTER,
    '::before': ACRYLIC_GRAIN,
    '@media (prefers-reduced-transparency: reduce)': {
      backgroundColor: ACRYLIC_SOLID_FILL,
      backdropFilter: 'none',
      '::before': { display: 'none' },
    },
  },
  barSolid: {
    backgroundColor: ACRYLIC_SOLID_FILL,
    boxShadow: ACRYLIC_SHADOW,
    backdropFilter: 'none',
  },
});

/** 条的表面：着色浅的 Acrylic；帧率守门判定背景扛不住（`frame.degraded`）后降成近实底 */
export function useBarSurface(): string {
  const classes = useBarStyles();
  return useSceneFrame().degraded ? classes.barSolid : classes.bar;
}
