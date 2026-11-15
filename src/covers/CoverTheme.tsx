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

export interface CoverVisual {
  readonly url: string;
  readonly profile: CoverProfile | null;
  /** 页里的视频：光晕取它的画面，播放时跟着取样，主题色仍取自 `url` 的静图 */
  readonly video: HTMLVideoElement | null;
}

export const CoverVisualContext = createContext<CoverVisual>({
  url: '',
  profile: null,
  video: null,
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
 * 封面颜色优先采用页内提取结果，封面就绪前、提取失败或为灰图时沿用全局强调色；Portal 仅继承主题颜色而不继承布局结构
 * `reuse` 参见 `useCoverProfile`；传入 `video` 视频元素时，光晕层随播放实时对视频画面取样，主题色仍取自 `url`
 */
export function CoverTheme({
  url,
  reuse = false,
  video = null,
  children,
}: {
  readonly url: string;
  readonly reuse?: boolean;
  readonly video?: HTMLVideoElement | null;
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
  const visual = useMemo(() => ({ url, profile, video }), [url, profile, video]);
  return (
    <FluentProvider theme={theme} className={classes.root} style={{ display: 'contents' }}>
      <AccentContext value={profile?.accent ?? globalTone}>
        <CoverVisualContext value={visual}>{children}</CoverVisualContext>
      </AccentContext>
    </FluentProvider>
  );
}
