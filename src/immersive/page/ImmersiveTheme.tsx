import {
  createDarkTheme,
  createLightTheme,
  FluentProvider,
  makeStyles,
  mergeClasses,
  PortalMountNodeProvider,
  tokens,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useMemo, useState, type ReactNode } from 'react';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { MOTION_VARIABLES, REDUCED_MOTION_VARIABLES } from '../../motion/timing.ts';
import { colorSchemeAtom } from '../../theme/colorScheme.ts';
import { MenuBackgroundContext } from '../../theme/MenuSurface.tsx';
import { PanelBackgroundContext } from '../../theme/PopoverSurface.tsx';
import { ROLE_VALUES, roleProperties } from '../../theme/roles.ts';
import { coverRampAtom as accentRampAtom } from '../../theme/accentState.ts';
import { fontChoiceAtom } from '../../theme/fontChoice.ts';
import { fontStack } from '../../theme/fontStack.ts';
import styles from './ImmersiveTheme.module.css';

// 本层的 className 也会复制到它里面弹出的提示、菜单的挂载节点上，所以只放浮层里同样应当生效的内容：
// 字体、透明背景、配色方案、语义变量与动效变量，不放版式。语义变量要在本层重新声明：外层声明的
// `--accent: var(--colorBrandForeground1)` 在外层已算成青绿，向下继承的是算好的值
const useStyles = makeStyles({
  root: {
    backgroundColor: 'transparent',
    fontFamily: tokens.fontFamilyBase,
    ...roleProperties(ROLE_VALUES),
    ...MOTION_VARIABLES,
  },
  light: { colorScheme: 'light' },
  dark: { colorScheme: 'dark' },
  reducedMotion: REDUCED_MOTION_VARIABLES,
});

/**
 * 沉浸视图独立提取当前播放封面强调色，配色方案默认随主窗口切换，全局强调色跟随开关不影响本层。
 * 指定 `scheme` 时固定使用对应方案（新场景固定采用深色模式）。
 * 语义变量在本层重新派生声明，菜单与几何图形统一应用本层配色，未取到强调色时回退为默认青绿色。
 * 菜单与面板的实色底由主题根按整窗深浅算好，经上下文传下来。本层深浅与整窗不同时，这些底色是反色的，
 * 与本层的前景色搭配读不清，此时清除该上下文，浮层改用本层主题自己的表面
 */
export function ImmersiveTheme({
  scheme: fixed,
  children,
}: {
  readonly scheme?: 'light' | 'dark';
  readonly children: ReactNode;
}) {
  const ramp = useAtomValueRawSync(accentRampAtom);
  const followed = useAtomValueRawSync(colorSchemeAtom);
  const scheme = fixed ?? followed;
  const menuBackground = useContext(MenuBackgroundContext);
  const panelBackground = useContext(PanelBackgroundContext);
  const detached = scheme !== followed;
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const font = useAtomValueRawSync(fontChoiceAtom);
  const classes = useStyles();
  // 视图内弹出的菜单、面板与提示都挂在该节点下，视图过渡时才有固定的名称可挂（见样式文件）
  const [overlay, setOverlay] = useState<HTMLElement | null>(null);
  const theme = useMemo(() => {
    const next = scheme === 'dark' ? createDarkTheme(ramp) : createLightTheme(ramp);
    next.fontFamilyBase = fontStack(font);
    return next;
  }, [ramp, scheme, font]);
  const className = mergeClasses(
    classes.root,
    scheme === 'dark' ? classes.dark : classes.light,
    reduced && classes.reducedMotion,
  );
  return (
    <FluentProvider theme={theme} className={className}>
      <PanelBackgroundContext value={detached ? undefined : panelBackground}>
        <MenuBackgroundContext value={detached ? undefined : menuBackground}>
          <PortalMountNodeProvider value={overlay ?? undefined}>{children}</PortalMountNodeProvider>
          <div ref={setOverlay} className={styles.overlay} data-scene-overlay />
        </MenuBackgroundContext>
      </PanelBackgroundContext>
    </FluentProvider>
  );
}
