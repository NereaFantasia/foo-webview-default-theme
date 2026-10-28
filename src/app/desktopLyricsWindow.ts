import { FluentProvider, makeStyles, mergeClasses } from '@fluentui/react-components';
import { PlaybackClock } from 'foo-webview-sdk/bridge';
import { Provider, useAtomValueRawSync } from 'jotai/react';
import { createStore } from 'jotai/vanilla';
import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopLyricsWindow } from '../lyrics/desktop/DesktopLyricsWindow.tsx';
import { startDesktopLyricsPopup } from '../lyrics/desktop/desktopLyricsPopup.ts';
import { reducedMotionAtom, watchReducedMotion } from '../motion/reducedMotion.ts';
import { MOTION_VARIABLES, REDUCED_MOTION_VARIABLES } from '../motion/timing.ts';
import { browserMatchMedia } from '../theme/mediaQuery.ts';
import { ROLE_VALUES, roleProperties } from '../theme/roles.ts';
import { darkTheme } from '../theme/themes.ts';
import '../styles/global.css';

const useStyles = makeStyles({
  // 弹窗是透明窗口，主题根不铺底；深色的遮罩与底板由页面自己画
  root: { backgroundColor: 'transparent', ...roleProperties(ROLE_VALUES), ...MOTION_VARIABLES },
  reduced: REDUCED_MOTION_VARIABLES,
});

function Root(props: Parameters<typeof DesktopLyricsWindow>[0]) {
  const classes = useStyles();
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  return createElement(
    FluentProvider,
    { theme: darkTheme, className: mergeClasses(classes.root, reduced && classes.reduced) },
    createElement(DesktopLyricsWindow, props),
  );
}

// 桌面歌词弹窗只装播放时钟、两窗联络与歌词播放器，不走主窗口的整套服务。动效只跟系统的减弱动效
const container = document.getElementById('root');
if (!container) throw new Error('desktop-lyrics.html 缺少 #root');
const store = createStore();
const stopMotion = watchReducedMotion(store, browserMatchMedia());
const clock = new PlaybackClock();
const popup = startDesktopLyricsPopup(store);
const root = createRoot(container);
root.render(
  createElement(
    StrictMode,
    null,
    createElement(Provider, { store }, createElement(Root, { popup, clock })),
  ),
);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    root.unmount();
    popup.dispose();
    clock.dispose();
    stopMotion();
  });
