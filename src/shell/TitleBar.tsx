import { Toolbar, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useLayoutEffect, useRef } from 'react';
import { VideoEntryContext } from '../nav/videoEntry.ts';
import { translateAtom } from '../i18n/locale.ts';
import { NavButtons } from './NavButtons.tsx';
import { SidebarKey } from '../nav/sidebar/SidebarKey.tsx';
import { sidebarViewAtom } from '../nav/sidebar/sidebarView.ts';
import { MainMenuButton } from './MainMenuButton.tsx';
import { CapsuleVolume } from './player/volume/CapsuleVolume.tsx';
import { NowPlayingLcd } from './player/now-playing/NowPlayingLcd.tsx';
import { PlaybackControls } from './player/PlaybackControls.tsx';
import { playerBarStyleAtom, playerShellOf } from '../theme/playerBarStyle.ts';
import { handOffPlayerFocus } from './player/playerFocus.ts';
import { hasCurrentTrackAtom } from '../playback/playerAtoms.ts';
import { CaptionButtons } from './CaptionButtons.tsx';
import { HostStatus } from './HostStatus.tsx';
import { InfoCenterButton } from './info-center/InfoCenterButton.tsx';
import { LyricsKey, QueueKey } from './right-card/RightCardKeys.tsx';
import styles from './TitleBar.module.css';
import { useService } from '../kit/useService.ts';
import { windowShellKey } from '../host/windowShell.ts';

// 主菜单与导航键共用 40 × 32 的尺寸，彼此隔 2；480px 以下宽 28、不留间隙。
// Fluent 的中号图标键是 32 见方，宽高要另设；工具栏内统一图标尺寸，不影响共用按钮在其他位置的图标。
const useStyles = makeStyles({
  toolbar: {
    padding: '0',
    '& svg': { width: '20px', height: '20px' },
  },
  navTools: {
    gap: tokens.spacingHorizontalXXS,
    '@media (max-width: 480px)': { gap: '0' },
  },
  navTool: {
    minWidth: '40px',
    width: '40px',
    height: '32px',
    '@media (max-width: 480px)': { minWidth: '28px', width: '28px' },
  },
});

/**
 * 标题栏，按播放栏的形态三种排法（`playerShellOf`）。播放栏放在标题栏、
 * 且窗口是宽窗（与侧边栏同一条线，≥ 1008）时高 64，左起 ⋯、播放控制组与音量键（同胶囊里那一枚，浮层朝下开），
 * 正中是正在播放条（在窗口居中），右端窗口三键。音量不做悬停展开的面板：展开的那一截落在标题栏的拖动区上，指针移过去就被窗口当成标题栏。
 * 没有当前曲目时正在播放条不出，那一块仍是拖动区；控制组与音量键留着，高度不变。
 * 播放栏在底部或是胶囊时高 48，左段是 ⋯、后退、前进与侧边栏键，窗口三键左边是歌词与队列两个右侧卡的入口
 * （内容卡里没有导航行，入口放在这里），组内的键挨着，组离三键 16；窗口窄于 641 时歌词键收掉。播放栏在标题栏
 * 而窗口窄于 1008 时高 48，只有 ⋯ 与窗口三键，导航键与入口在内容卡的导航行里。键以外的地方是拖动区，宿主版本
 * 不满足时拖动区里出一行提示。不铺底，与侧边栏同在窗口材质上。渲染后把实测高度交给窗口壳，宿主据此认标题栏。
 */
export function TitleBar() {
  const videoEntry = useContext(VideoEntryContext);
  const t = useAtomValueRawSync(translateAtom);
  const { tier } = useAtomValueRawSync(sidebarViewAtom);
  const wide = tier === 'wide';
  const shell = playerShellOf(useAtomValueRawSync(playerBarStyleAtom), wide);
  const withPlayer = shell.inTitlebar;
  const hasTrack = useAtomValueRawSync(hasCurrentTrackAtom);
  const navTools = !shell.navRow;
  const windowShell = useService(windowShellKey);
  const classes = useStyles();
  const header = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const element = header.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[entries.length - 1]?.borderBoxSize[0]?.blockSize ?? 0;
      if (height > 0) windowShell.setTitlebarHeight(height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [windowShell]);

  return (
    <header ref={header} className={styles.root} data-player={withPlayer || undefined}>
      <div className={styles.start}>
        <div className={styles.tools}>
          <Toolbar
            aria-label={t('titlebar.tools')}
            className={mergeClasses(classes.toolbar, navTools && classes.navTools)}
          >
            <MainMenuButton className={classes.navTool} />
            {navTools && (
              <>
                <NavButtons className={classes.navTool} round={false} />
                <SidebarKey className={classes.navTool} round={false} />
              </>
            )}
          </Toolbar>
        </div>
        {withPlayer && (
          <div className={styles.player}>
            {videoEntry}
            <PlaybackControls />
            {/* 窄到换成胶囊时这一枚随标题栏的播放部分一起卸下，焦点要跟走。 */}
            <span ref={handOffPlayerFocus} className={styles.volume}>
              <CapsuleVolume below />
            </span>
          </div>
        )}
      </div>
      {withPlayer ? (
        <div className={styles.center}>{hasTrack && <NowPlayingLcd />}</div>
      ) : (
        <div className={styles.status}>
          <HostStatus />
        </div>
      )}
      <div className={styles.end}>
        {withPlayer && (
          <div className={styles.status}>
            <HostStatus />
          </div>
        )}
        {navTools && (
          <div className={styles.entries}>
            <Toolbar
              aria-label={t('rightCard.region')}
              className={mergeClasses(classes.toolbar, classes.navTools)}
            >
              {tier !== 'hidden' && <LyricsKey className={classes.navTool} />}
              <QueueKey className={classes.navTool} />
            </Toolbar>
          </div>
        )}
        <InfoCenterButton />
        <CaptionButtons />
      </div>
    </header>
  );
}
