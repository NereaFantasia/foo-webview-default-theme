import { FluentProvider, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { createDarkTheme, createLightTheme } from '@fluentui/react-components';
import { localeAtom } from '../i18n/locale.ts';
import { reducedMotionAtom } from '../motion/reducedMotion.ts';
import { MOTION_VARIABLES, REDUCED_MOTION_VARIABLES } from '../motion/timing.ts';
import { materialAtom } from './backdrop.ts';
import { colorSchemeAtom } from './colorScheme.ts';
import { ACRYLIC_ROLES, ROLE_VALUES, roleProperties } from './roles.ts';
import { accentRampAtom } from './accentState.ts';
import { backgroundParametersAtom, backgroundSourceAtom } from './background/windowBackground.ts';
import { WindowBackground } from './background/WindowBackground.tsx';

// 改 Fluent 组件自身的样式要用 makeStyles：它和组件内部的原子类合并时后者让位，
// CSS Modules 的类与之同优先级，谁生效取决于样式表的插入顺序。
//
// FluentProvider 的 className 会原样抄到 Menu、Tooltip 这些浮层的挂载节点上，所以这里只放浮层里也该生效的：
// 字体、透明底、深浅、语义变量与动效变量。高度、内边距这类版式不能放：挂载节点是贴在 body 上、
// z-index 很高的绝对定位层，带上 `height: 100%` 就会盖住整个窗口、吞掉点击。
const useStyles = makeStyles({
  root: {
    // FluentProvider 缺省铺 colorNeutralBackground1；窗口底下是宿主提供的 Mica，这一层要透明。
    backgroundColor: 'transparent',
    fontFamily: `'Segoe UI Variable', ${tokens.fontFamilyBase}, 'Microsoft YaHei UI', sans-serif`,
    ...roleProperties(ROLE_VALUES),
    ...MOTION_VARIABLES,
    // 滚动条只留拖拽手柄：轨道、两端箭头与拐角都透明或去掉。手柄离轨道两边各让 2px 透明边，
    // 看起来是 6px 的圆条，命中区仍是整条 10px。浮层的挂载节点也带这个类，菜单里的滚动条同样生效。
    '& ::-webkit-scrollbar': { width: '10px', height: '10px', backgroundColor: 'transparent' },
    '& ::-webkit-scrollbar-track, & ::-webkit-scrollbar-corner': { backgroundColor: 'transparent' },
    '& ::-webkit-scrollbar-button': { display: 'none' },
    '& ::-webkit-scrollbar-thumb': {
      backgroundColor: tokens.colorNeutralStroke1,
      backgroundClip: 'content-box',
      border: '2px solid transparent',
      borderRadius: tokens.borderRadiusCircular,
    },
    '& ::-webkit-scrollbar-thumb:hover, & ::-webkit-scrollbar-thumb:active': {
      backgroundColor: tokens.colorNeutralStrokeAccessible,
    },
  },
  // 表单控件这类由浏览器自绘的部分跟着深浅走。
  light: { colorScheme: 'light' },
  dark: { colorScheme: 'dark' },
  reducedMotion: REDUCED_MOTION_VARIABLES,
  acrylicLight: roleProperties(ACRYLIC_ROLES.light),
  acrylicDark: roleProperties(ACRYLIC_ROLES.dark),
  drawn: roleProperties({
    'bg-app': 'transparent',
    'bg-pane': tokens.colorNeutralBackgroundAlpha2,
  }),
});

export interface ThemeRootProps {
  children?: ReactNode;
}

/**
 * 主题根：按系统深浅选档，挂上语义变量与动效变量，并按宿主实际用的材质调底色浓度。
 * 页面语言跟着界面语言走：读屏按它选发音，中日韩文字按它选字形。
 */
export function ThemeRoot({ children }: ThemeRootProps) {
  const ramp = useAtomValueRawSync(accentRampAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const acrylic = useAtomValueRawSync(materialAtom) === 'acrylic';
  const drawn = useAtomValueRawSync(backgroundSourceAtom) !== 'material';
  const { content } = useAtomValueRawSync(backgroundParametersAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const styles = useStyles();
  const theme = useMemo(() => {
    const next = scheme === 'dark' ? createDarkTheme(ramp) : createLightTheme(ramp);
    if (drawn)
      next.colorNeutralBackgroundAlpha2 = `color-mix(in srgb, ${next.colorNeutralBackground2} ${content}%, transparent)`;
    return next;
  }, [scheme, ramp, drawn, content]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const className = mergeClasses(
    styles.root,
    scheme === 'dark' ? styles.dark : styles.light,
    reduced && styles.reducedMotion,
    acrylic && (scheme === 'dark' ? styles.acrylicDark : styles.acrylicLight),
    drawn && styles.drawn,
  );
  return (
    <FluentProvider theme={theme} className={className} style={{ isolation: 'isolate' }}>
      <WindowBackground />
      {children}
    </FluentProvider>
  );
}
