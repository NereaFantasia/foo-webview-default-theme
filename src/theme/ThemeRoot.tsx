import { FluentProvider, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useId, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { createDarkTheme, createLightTheme } from '@fluentui/react-components';
import { localeAtom } from '../i18n/locale.ts';
import { reducedMotionAtom } from '../motion/reducedMotion.ts';
import { MOTION_VARIABLES, REDUCED_MOTION_VARIABLES } from '../motion/timing.ts';
import { materialAtom, backdropSolidAtom } from './backdrop.ts';
import { colorSchemeAtom } from './colorScheme.ts';
import { ACRYLIC_ROLES, ROLE_VALUES, roleProperties } from './roles.ts';
import { accentRampAtom, globalAccentToneAtom } from './accentState.ts';
import {
  backgroundCoverAtom,
  backgroundParametersAtom,
  backgroundSourceAtom,
  backgroundTransportAtom,
} from './background/windowBackground.ts';
import { backgroundAppearanceAtom, tintedSurface } from './background/backgroundAppearance.ts';
import { WindowBackground } from './background/WindowBackground.tsx';
import { CAPSULE_FILTER, CAPSULE_GRAIN, capsuleTint } from './capsuleMaterial.ts';
import { capsuleBlurAtom } from './playerBarStyle.ts';
import { themeBackgroundTintAtom } from './background/themeBackground.ts';
import { SCROLLBAR_CSS_RULES, SCROLLBAR_STYLES } from './scrollbarStyles.ts';
import { useScrollbarActivity } from './useScrollbarActivity.ts';
import { MenuBackgroundContext } from './MenuSurface.tsx';
import { PanelBackgroundContext } from './PopoverSurface.tsx';
import { surfaceTintAtom } from './surfaceTint.ts';

// 改 Fluent 组件自身的样式要用 makeStyles：它和组件内部的原子类合并时后者让位，
// CSS Modules 的类与之同优先级，谁生效取决于样式表的插入顺序
//
// FluentProvider 的 className 会原样抄到 Menu、Tooltip 这些浮层的挂载节点上，所以这里只放浮层里也该生效的：
// 字体、透明底、深浅、语义变量与动效变量。高度、内边距这类版式不能放：挂载节点是贴在 body 上、
// z-index 很高的绝对定位层，带上 `height: 100%` 就会盖住整个窗口、吞掉点击
const useStyles = makeStyles({
  root: {
    // 背景由宿主材质或独立背景层绘制，覆盖 FluentProvider 的缺省底色后才能透出
    backgroundColor: 'transparent',
    fontFamily: `'Segoe UI Variable', ${tokens.fontFamilyBase}, 'Microsoft YaHei UI', sans-serif`,
    ...roleProperties(ROLE_VALUES),
    ...MOTION_VARIABLES,
    '--surface-stroke': tokens.colorNeutralStroke2,
    '--reading-stroke': tokens.colorNeutralStrokeAlpha,
    '--reading-edge-filter': 'none',
    '--reading-shadow': `${tokens.shadow4}, ${tokens.shadow8}`,
    '--surface-filter': 'none',
    '--capsule-filter': 'none',
    '--capsule-grain': '0',
    '--surface-grain': '0',
    '& *': SCROLLBAR_STYLES,
  },
  // 表单控件这类由浏览器自绘的部分跟着深浅走
  light: { colorScheme: 'light' },
  dark: { colorScheme: 'dark' },
  reducedMotion: REDUCED_MOTION_VARIABLES,
  acrylicLight: roleProperties(ACRYLIC_ROLES.light),
  acrylicDark: roleProperties(ACRYLIC_ROLES.dark),
  solid: roleProperties({
    'bg-app': 'transparent',
    'bg-pane': tokens.colorNeutralBackgroundAlpha2,
  }),
  drawn: {
    ...roleProperties({
      'bg-app': 'transparent',
      'bg-pane': tokens.colorNeutralBackgroundAlpha2,
      'bg-surface': tokens.colorNeutralBackground1,
      'text-muted': tokens.colorNeutralForeground3,
    }),
    '--surface-stroke': 'transparent',
  },
  drawnDark: roleProperties({
    'bg-surface': `color-mix(in srgb, ${tokens.colorNeutralForeground1} 3%, ${tokens.colorNeutralBackground1})`,
    'bg-panel-overlay': tokens.colorNeutralBackground3,
  }),
});

export interface ThemeRootProps {
  children?: ReactNode;
}

/**
 * 主题根：按系统深浅选档，挂上语义变量与动效变量，并按宿主实际用的材质调底色浓度
 * 页面语言跟着界面语言走：读屏按它选发音，中日韩文字按它选字形
 */
export function ThemeRoot({ children }: ThemeRootProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useScrollbarActivity(rootRef);
  const panelScope = `panel-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const ramp = useAtomValueRawSync(accentRampAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const material = useAtomValueRawSync(materialAtom);
  const acrylic = material === 'acrylic';
  const source = useAtomValueRawSync(backgroundSourceAtom);
  const drawn = source !== 'material';
  const solid = useAtomValueRawSync(backdropSolidAtom);
  const themed = solid && !drawn;
  const accentTone = useAtomValueRawSync(globalAccentToneAtom);
  const themeTint = useAtomValueRawSync(themeBackgroundTintAtom);
  const surfaceTint = useAtomValueRawSync(surfaceTintAtom);
  const { content } = useAtomValueRawSync(backgroundParametersAtom);
  const appearance = useAtomValueRawSync(backgroundAppearanceAtom);
  const capsuleBlur = useAtomValueRawSync(capsuleBlurAtom);
  const cover = useAtomValueRawSync(backgroundCoverAtom);
  const transport = useAtomValueRawSync(backgroundTransportAtom);
  const profile = transport === 'stopped' ? null : cover.profile;
  const tone = themed
    ? accentTone
    : (source === 'palette' || source === 'cover') && cover.url
      ? (profile?.dominant ?? null)
      : null;
  const tint = themed ? themeTint : appearance.tint;
  const saturation = themed ? 100 : appearance.saturation;
  const locale = useAtomValueRawSync(localeAtom).active;
  const styles = useStyles();
  const theme = useMemo(() => {
    const next = scheme === 'dark' ? createDarkTheme(ramp) : createLightTheme(ramp);
    if (drawn || themed) {
      const neutral =
        scheme === 'dark' ? next.colorNeutralBackground4 : next.colorNeutralBackground2;
      const surface = tintedSurface(neutral, tone, scheme, { tint, saturation });
      next.colorNeutralBackgroundAlpha2 = `color-mix(in srgb, ${surface} ${content}%, transparent)`;
    }
    return next;
  }, [scheme, ramp, drawn, themed, content, tone, tint, saturation]);
  const surfaceNeutral =
    (drawn || themed) && scheme === 'dark'
      ? theme.colorNeutralBackground3
      : theme.colorNeutralBackground1;
  const surfaceBackground = tintedSurface(surfaceNeutral, tone, scheme, { tint, saturation });
  const panelBackground = surfaceTint.panels ? surfaceBackground : surfaceNeutral;
  const menuBackground = surfaceTint.menus ? surfaceBackground : surfaceNeutral;
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const className = mergeClasses(
    panelScope,
    styles.root,
    scheme === 'dark' ? styles.dark : styles.light,
    reduced && styles.reducedMotion,
    acrylic && (scheme === 'dark' ? styles.acrylicDark : styles.acrylicLight),
    solid && !drawn && styles.solid,
    drawn && styles.drawn,
    drawn && scheme === 'dark' && styles.drawnDark,
  );
  const style: CSSProperties & Record<`--${string}`, string | number> = { isolation: 'isolate' };
  const surfaceFilter = appearance.surfaceBlur
    ? `blur(${appearance.surfaceBlur}px) saturate(1.1)`
    : 'none';
  if ((drawn || material === 'none') && capsuleBlur) {
    style['--bg-player-overlay'] = capsuleTint(theme.colorNeutralBackground1);
    style['--capsule-filter'] = CAPSULE_FILTER;
    style['--capsule-grain'] = CAPSULE_GRAIN;
  }
  if (drawn || themed) {
    style['--surface-filter'] = surfaceFilter;
    style['--surface-grain'] = appearance.grain / 100;
  }
  style['--reading-edge-filter'] =
    scheme === 'dark' ? 'blur(6px) saturate(1.25) brightness(1.35)' : 'blur(6px)';
  return (
    <FluentProvider ref={rootRef} theme={theme} className={className} style={style}>
      {/* Portal 复制类名而不复制行内变量；作用域规则让覆盖面板共享同一份不透明底色。 */}
      <style>{`.${panelScope}.${panelScope} { --bg-panel-overlay: ${panelBackground}; }\n${SCROLLBAR_CSS_RULES}`}</style>
      <WindowBackground
        solidColor={tintedSurface(tokens.colorNeutralBackground2, tone, scheme, {
          tint: themeTint,
          saturation: 100,
        })}
      />
      <PanelBackgroundContext value={panelBackground}>
        <MenuBackgroundContext value={menuBackground}>{children}</MenuBackgroundContext>
      </PanelBackgroundContext>
    </FluentProvider>
  );
}
