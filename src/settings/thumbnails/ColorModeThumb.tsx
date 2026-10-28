import {
  createDarkTheme,
  createLightTheme,
  FluentProvider,
  makeStyles,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useMemo, type ReactNode } from 'react';
import { accentRampAtom } from '../../theme/accentState.ts';
import type { ColorMode } from '../../theme/colorScheme.ts';
import { ROLE_VALUES, roleProperties } from '../../theme/roles.ts';
import type { ColorScheme } from '../../theme/themes.ts';
import styles from './ColorModeThumb.module.css';
import { MiniWindow } from './MiniWindow.tsx';

// 嵌套的主题 Provider 需显式声明语义变量，避免内部 `--line`、`--bg-pane` 错误继承外层作用域值
const useScopeStyles = makeStyles({
  scope: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'transparent',
    ...roleProperties(ROLE_VALUES),
  },
});

/** 缩略图色彩方案作用域，固定深浅配色并沿用全局当前强调色色阶 */
function SchemeScope({ scheme, children }: { scheme: ColorScheme; children: ReactNode }) {
  const ramp = useAtomValueRawSync(accentRampAtom);
  const classes = useScopeStyles();
  const theme = useMemo(
    () => (scheme === 'dark' ? createDarkTheme(ramp) : createLightTheme(ramp)),
    [scheme, ramp],
  );
  return (
    <FluentProvider theme={theme} className={classes.scope}>
      {children}
    </FluentProvider>
  );
}

/** 颜色模式预览缩略图，呈现浅色、深色或对半切分的系统跟随模式 */
export function ColorModeThumb({ mode }: { readonly mode: ColorMode }) {
  if (mode !== 'system') {
    return (
      <SchemeScope scheme={mode}>
        <MiniWindow bar="bottom" />
      </SchemeScope>
    );
  }
  return (
    <>
      <SchemeScope scheme="light">
        <MiniWindow bar="bottom" />
      </SchemeScope>
      <span className={styles.rightHalf}>
        <SchemeScope scheme="dark">
          <MiniWindow bar="bottom" />
        </SchemeScope>
      </span>
    </>
  );
}
