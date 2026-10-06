import {
  createDarkTheme,
  createLightTheme,
  FluentProvider,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useMemo, type ReactNode } from 'react';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { MOTION_VARIABLES, REDUCED_MOTION_VARIABLES } from '../../motion/timing.ts';
import { colorSchemeAtom } from '../../theme/colorScheme.ts';
import { ROLE_VALUES, roleProperties } from '../../theme/roles.ts';
import { coverRampAtom as accentRampAtom } from '../../theme/accentState.ts';

// 这一层的 className 也会被抄到它里面弹出的提示、菜单的挂载节点上，所以只放浮层里也该生效的：
// 字体、透明底、深浅、语义变量与动效变量，不放版式。语义变量要在这一层重新声明：外层声明的
// `--accent: var(--colorBrandForeground1)` 在外层就算成了青绿，往下继承的是算好的值。
const useStyles = makeStyles({
  root: {
    backgroundColor: 'transparent',
    fontFamily: `'Segoe UI Variable', ${tokens.fontFamilyBase}, 'Microsoft YaHei UI', sans-serif`,
    ...roleProperties(ROLE_VALUES),
    ...MOTION_VARIABLES,
  },
  light: { colorScheme: 'light' },
  dark: { colorScheme: 'dark' },
  reducedMotion: REDUCED_MOTION_VARIABLES,
});

/**
 * 沉浸内容独立跟随正在播放的封面，深浅跟整窗走；关闭全局跟随不影响这一层。
 * 语义变量在本层重声明，菜单与图形都消费本层颜色，取不到强调色时回到青绿。
 */
export function ImmersiveTheme({ children }: { readonly children: ReactNode }) {
  const ramp = useAtomValueRawSync(accentRampAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const styles = useStyles();
  const theme = useMemo(
    () => (scheme === 'dark' ? createDarkTheme(ramp) : createLightTheme(ramp)),
    [ramp, scheme],
  );
  const className = mergeClasses(
    styles.root,
    scheme === 'dark' ? styles.dark : styles.light,
    reduced && styles.reducedMotion,
  );
  return (
    <FluentProvider theme={theme} className={className}>
      {children}
    </FluentProvider>
  );
}
