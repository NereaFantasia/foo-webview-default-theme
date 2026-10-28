import { mergeClasses, Button, Tooltip, makeStyles } from '@fluentui/react-components';
import {
  LockClosed12Filled,
  PictureInPicture20Regular,
  Pulse20Regular,
  Subtitles20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useRef } from 'react';
import { VideoEntryContext } from '../../nav/videoEntry.ts';
import { miniWindowAtom, miniWindowKey } from '../../host/miniWindow.ts';
import { windowShellAtom } from '../../host/windowShell.ts';
import { desktopLyricsKey } from '../../lyrics/desktop/desktopLyrics.ts';
import { DesktopLyricsMenu } from '../DesktopLyricsMenu.tsx';
import { useService } from '../../kit/useService.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { sidebarViewAtom } from '../../nav/sidebar/sidebarView.ts';
import { roleVar } from '../../theme/roles.ts';
import { CapsuleVolume } from './volume/CapsuleVolume.tsx';
import { NowPlayingMenu } from '../../playback/now-playing/NowPlayingMenu.tsx';
import { useNowPlayingMenu } from '../../playback/now-playing/useNowPlayingMenu.ts';
import { displayTitle } from '../../playback/now-playing/nowPlaying.ts';
import { NowPlayingEntry } from './now-playing/NowPlayingEntry.tsx';
import { NowPlayingRating } from '../../track/NowPlayingRating.tsx';
import { QualityButton } from '../../playback/now-playing/QualityButton.tsx';
import { OutputDeviceButton } from './volume/OutputDeviceButton.tsx';
import { currentTrackAtom } from '../../playback/playback.ts';
import { PlaybackControls } from './PlaybackControls.tsx';
import styles from './PlayerBar.module.css';
import {
  handOffPlayerFocus,
  MORE_SURFACE_ATTRIBUTES,
  PLAYER_KEY_ATTR,
  PLAYER_MENU_SCOPE,
  QUALITY_FOCUS,
  SEEK_FOCUS,
  VOLUME_SLIDER_FOCUS,
} from './playerFocus.ts';
import { SeekBar } from '../../playback/seek/SeekBar.tsx';
import { TrackByline } from '../../track/TrackByline.tsx';
import { TruncatedText } from '../../kit/TruncatedText.tsx';
import { useOpenNowPlaying } from './now-playing/useOpenNowPlaying.ts';
import { useTextSwap } from '../../playback/now-playing/useTextSwap.ts';
import { SeekLyricsPopover } from '../../lyrics/SeekLyrics.tsx';
import { useVolumeControl } from '../../playback/volume/useVolumeControl.ts';
import { VolumeSlider } from '../../playback/volume/VolumeSlider.tsx';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

// 键 36 见方、图标 20，与控制组的键一样大
const useStyles = makeStyles({
  key: {
    minWidth: '36px',
    width: '36px',
    height: '36px',
    padding: '0',
    color: roleVar('text-secondary'),
  },
  on: { color: roleVar('accent'), ':hover': { color: roleVar('accent') } },
});

/** 封面边长，CSS 像素 */
const COVER = 48;

/** 迷你播放器键：把主窗口缩成迷你播放器。宿主窗口没连上、或正在切换时置灰 */
function MiniKey() {
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const mini = useService(miniWindowKey);
  const { busy } = useAtomValueRawSync(miniWindowAtom);
  const { status } = useAtomValueRawSync(windowShellAtom);
  const classes = useStyles();
  return (
    <span ref={handOffPlayerFocus} className={styles.slot}>
      <Tooltip content={t('player.miniPlayer')} relationship="label">
        <Button
          appearance="subtle"
          className={mergeClasses(classes.key, viewControls.icon)}
          icon={<PictureInPicture20Regular />}
          disabled={busy || status !== 'connected'}
          onClick={() => void mini.enter()}
          {...{ [PLAYER_KEY_ATTR]: 'mini' }}
        />
      </Tooltip>
    </span>
  );
}

/**
 * 桌面歌词键：左键开关，右键出桌面歌词菜单。开着时用选中底，锁定时图标右下角加锁的角标
 * 宿主窗口没连上时置灰
 */
function DesktopLyricsKey() {
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const service = useService(desktopLyricsKey);
  const { status: lyrics } = useAtomValueRawSync(service.state);
  const { locked } = useAtomValueRawSync(service.pref);
  const { status } = useAtomValueRawSync(windowShellAtom);
  const classes = useStyles();
  const open = lyrics !== 'closed';
  return (
    <span ref={handOffPlayerFocus} className={styles.slot}>
      <DesktopLyricsMenu openOnContext>
        <Tooltip content={t('desktopLyrics.title')} relationship="label">
          <Button
            appearance="subtle"
            className={mergeClasses(classes.key, viewControls.icon, open && classes.on)}
            icon={
              <span className={styles['lyrics-icon']}>
                <Subtitles20Regular />
                {open && locked && <LockClosed12Filled className={styles['lyrics-lock']} />}
              </span>
            }
            aria-pressed={open}
            disabled={status !== 'connected'}
            onClick={service.toggle}
            {...{ [PLAYER_KEY_ATTR]: 'desktopLyrics' }}
          />
        </Tooltip>
      </DesktopLyricsMenu>
    </span>
  );
}

/** 最右边的沉浸键：与封面一样进沉浸视图，没连上宿主时置灰 */
function ImmersiveKey() {
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const open = useOpenNowPlaying();
  const classes = useStyles();
  return (
    <span ref={handOffPlayerFocus} className={styles.slot}>
      <Tooltip content={t('player.immersive')} relationship="label">
        <Button
          appearance="subtle"
          className={mergeClasses(classes.key, viewControls.icon)}
          icon={<Pulse20Regular />}
          disabled={!open}
          onClick={open ?? undefined}
          {...{ [PLAYER_KEY_ATTR]: 'immersive' }}
        />
      </Tooltip>
    </span>
  );
}

/**
 * 底部通栏：横在窗口最下面、侧边栏与内容卡之下，与标题栏一样直接放在窗口材质上。上一行是播到的时间、
 * 进度线与总长；下一行左边是封面、曲名（后面跟着星级，没评分也常驻；在线曲目是音质标记）与艺人、专辑（`TrackByline`），正中是播放控制组（在窗口居中），
 * 右边是输出设备、音量与桌面歌词、迷你播放器、沉浸键。输出设备键点开设备列表，封面与沉浸键进沉浸视图，
 * 迷你键把主窗口缩成迷你播放器。右侧卡的入口（歌词、队列）在标题栏，不在这一条上
 *
 * 按窗口宽度收键：641–1007 去掉桌面歌词、迷你与沉浸键、输出设备键，音量滑条收进音量键，点开是朝上的音量浮层；
 * ≤ 640 再去掉播放顺序，控制组挪到右边，曲名后面也不放星与音质标记（音质从右键菜单换）。卸下的键里有焦点时，焦点跟到同名的件上，
 * 没有就落在播放键上。没有当前曲目时整条不出（主窗按它装卸），卸下时焦点在里面就交给标题栏的 ⋯。过长的
 * 文字截断，右缘渐隐，悬停出全文。换曲时曲名与下面一行先退后进（`useTextSwap`），封面推入（`NowPlayingCover`）
 */
export function PlayerBar() {
  const videoEntry = useContext(VideoEntryContext);
  const t = useAtomValueRawSync(translateAtom);
  const live = useAtomValueRawSync(currentTrackAtom);
  const { tier } = useAtomValueRawSync(sidebarViewAtom);
  const { sender, scale } = useVolumeControl();
  const text = useRef<HTMLDivElement>(null);
  const track = useTextSwap(live, [text], true);
  const menu = useNowPlayingMenu(track, PLAYER_MENU_SCOPE);
  const wide = tier === 'wide';
  return (
    <section
      ref={handOffPlayerFocus}
      className={styles.root}
      aria-label={t('player.bar')}
      data-player-bar
      data-tier={tier}
    >
      <div className={styles.progress}>
        <SeekBar
          interactive
          thickness={4}
          thumb
          clock
          {...SEEK_FOCUS}
          preview={(target) => <SeekLyricsPopover target={target} />}
        />
      </div>
      <div className={styles.main}>
        <div
          className={styles.now}
          role="group"
          aria-label={t('player.nowPlaying')}
          {...menu.trigger}
        >
          <NowPlayingEntry size={COVER} shape="bar" />
          <div ref={text} className={styles.text}>
            <div className={styles.titleRow}>
              <TruncatedText
                className={styles.title}
                data-idle={!track || undefined}
                text={track ? displayTitle(track) : t('player.idle')}
              />
              {tier !== 'hidden' && <NowPlayingRating size="small" track={track} />}
              {tier !== 'hidden' && <QualityButton track={track} {...QUALITY_FOCUS} />}
            </div>
            <TrackByline className={styles.byline} track={track} />
          </div>
        </div>
        <div className={styles.controls}>
          <PlaybackControls compact={tier === 'hidden'} prominent />
        </div>
        <div ref={handOffPlayerFocus} className={styles.tail}>
          {wide && (
            <span ref={handOffPlayerFocus} className={styles.slot}>
              <OutputDeviceButton />
            </span>
          )}
          {wide ? (
            <div ref={handOffPlayerFocus} className={styles.volume}>
              <VolumeSlider
                sender={sender}
                scale={scale}
                variant="bar"
                keyAttributes={VOLUME_SLIDER_FOCUS}
              />
            </div>
          ) : (
            <span ref={handOffPlayerFocus} className={styles.slot}>
              <CapsuleVolume roomy />
            </span>
          )}
          {videoEntry}
          {wide && (
            <>
              <DesktopLyricsKey />
              <MiniKey />
              <ImmersiveKey />
            </>
          )}
        </div>
      </div>
      <NowPlayingMenu
        at={menu.at}
        surfaceAttributes={MORE_SURFACE_ATTRIBUTES}
        onClose={menu.close}
      />
    </section>
  );
}
