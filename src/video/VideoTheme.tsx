import {
  createDarkTheme,
  FluentProvider,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useMemo, type ReactNode } from 'react';
import { reducedMotionAtom } from '../motion/reducedMotion.ts';
import { MOTION_VARIABLES, REDUCED_MOTION_VARIABLES } from '../motion/timing.ts';
import { accentRampAtom } from '../theme/accentState.ts';
import { fontChoiceAtom } from '../theme/fontChoice.ts';
import { fontStack } from '../theme/fontStack.ts';
import { ROLE_VALUES, roleProperties } from '../theme/roles.ts';

// 这一层的 className 会被抄到里面弹出的提示、菜单的挂载节点上，只放浮层里也该生效的：
// 字体、透明底、深浅、语义变量与动效变量，不放版式。语义变量要在本层重新声明：外层声明的
// `--accent: var(--colorBrandForeground1)` 在外层就算成了外层的品牌色，往下继承的是算好的值
const useStyles = makeStyles({
  root: {
    backgroundColor: 'transparent',
    colorScheme: 'dark',
    fontFamily: tokens.fontFamilyBase,
    ...roleProperties(ROLE_VALUES),
    ...MOTION_VARIABLES,
  },
  reduced: REDUCED_MOTION_VARIABLES,
});

/**
 * 画面与它的控件、菜单固定深色，看视频不随整窗深浅；品牌色与字体仍跟全局走，
 * 强调色取封面、Windows 或自定义色，字体跟字体设置，不落回固定青绿与缺省字体
 */
export function VideoTheme({ children }: { readonly children: ReactNode }) {
  const ramp = useAtomValueRawSync(accentRampAtom);
  const font = useAtomValueRawSync(fontChoiceAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const classes = useStyles();
  const theme = useMemo(() => {
    const next = createDarkTheme(ramp);
    next.fontFamilyBase = fontStack(font);
    return next;
  }, [ramp, font]);
  return (
    <FluentProvider
      theme={theme}
      className={mergeClasses(classes.root, reduced && classes.reduced)}
    >
      {children}
    </FluentProvider>
  );
}
