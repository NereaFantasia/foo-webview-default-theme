import {
  createDarkTheme,
  createLightTheme,
  FluentProvider,
  makeStyles,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { createContext, useMemo, type ReactNode } from 'react';
import { AccentContext } from '../theme/accentContext.ts';
import { accentRampAtom, globalAccentToneAtom } from '../theme/accentState.ts';
import { rampFrom } from '../theme/brandRamp.ts';
import { colorSchemeAtom } from '../theme/colorScheme.ts';
import type { CoverProfile } from '../theme/coverPalette.ts';
import { ROLE_VALUES, roleProperties } from '../theme/roles.ts';
import { useCoverProfile } from './useCoverProfile.ts';

export const CoverVisualContext = createContext<{ url: string; profile: CoverProfile | null }>({
  url: '',
  profile: null,
});
const useStyles = makeStyles({
  root: {
    backgroundColor: 'transparent',
    ...roleProperties({
      'bg-selected': ROLE_VALUES['bg-selected'],
      'text-on-accent': ROLE_VALUES['text-on-accent'],
      accent: ROLE_VALUES.accent,
      'accent-strong': ROLE_VALUES['accent-strong'],
      playing: ROLE_VALUES.playing,
      'playing-fill': ROLE_VALUES['playing-fill'],
      // 页内弹出的菜单与浮层挂在这一层的类名下，里面的分隔线也要取得到
      line: ROLE_VALUES.line,
      'line-subtle': ROLE_VALUES['line-subtle'],
    }),
  },
});

/**
 * 页内封面优先，灰图与失败继承全局；Portal 只继承颜色，不继承布局。取到封面色之前一直是全局色。
 * `reuse` 见 `useCoverProfile`。
 */
export function CoverTheme({
  url,
  reuse = false,
  children,
}: {
  readonly url: string;
  readonly reuse?: boolean;
  readonly children: ReactNode;
}) {
  const profile = useCoverProfile(url, { reuse });
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const globalRamp = useAtomValueRawSync(accentRampAtom);
  const globalTone = useAtomValueRawSync(globalAccentToneAtom);
  const classes = useStyles();
  const ramp = useMemo(
    () => (profile?.accent ? rampFrom(profile.accent) : globalRamp),
    [profile, globalRamp],
  );
  const theme = useMemo(
    () => (scheme === 'dark' ? createDarkTheme(ramp) : createLightTheme(ramp)),
    [ramp, scheme],
  );
  const visual = useMemo(() => ({ url, profile }), [url, profile]);
  return (
    <FluentProvider theme={theme} className={classes.root} style={{ display: 'contents' }}>
      <AccentContext value={profile?.accent ?? globalTone}>
        <CoverVisualContext value={visual}>{children}</CoverVisualContext>
      </AccentContext>
    </FluentProvider>
  );
}
