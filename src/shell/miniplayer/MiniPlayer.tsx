import {
  Live16Regular,
  Live24Regular,
  MoreHorizontal20Regular,
  MusicNote224Regular,
  PanelTopContract20Regular,
  PanelTopExpand20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CoverTheme } from '../../covers/CoverTheme.tsx';
import { MINI_PLAYER_SCALE, miniWindowAtom, miniWindowKey } from '../../host/miniWindow.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { currentTrackAtom } from '../../playback/playback.ts';
import { BackgroundImageLayers } from '../../theme/background/BackgroundImageLayers.tsx';
import { backgroundCoverAtom } from '../../theme/background/windowBackground.ts';
import { colorSchemeAtom } from '../../theme/colorScheme.ts';
import { NowPlayingRating } from '../player/now-playing/NowPlayingRating.tsx';
import { displayTitle } from '../player/now-playing/nowPlaying.ts';
import { SeekBar } from '../player/SeekBar.tsx';
import { fadeIn, fadeOut, foldMenu, riseIn, unfoldMenu } from './menuMotion.ts';
import { Captions, Key, Transport, useKeyStyles } from './MiniKeys.tsx';
import { MiniPlayerMenu } from './MiniPlayerMenu.tsx';
import { MiniVolume } from './MiniVolume.tsx';
import { ScrollingTitle } from './ScrollingTitle.tsx';
import styles from './MiniPlayer.module.css';

/** 按在这些元素上是在操作它们，不拖窗口。 */
const INTERACTIVE = 'button, input, a, [role="slider"], [data-mini-menu]';

function partsOf(root: HTMLElement | null): HTMLElement[] {
  return root ? [...root.querySelectorAll<HTMLElement>('[data-mini-part]')] : [];
}

/** 换形态时一起淡出淡入的部分：内容与模糊背景，只留下底色。 */
function viewOf(root: HTMLElement | null): HTMLElement[] {
  const backdrop = root?.querySelector<HTMLElement>('[data-mini-backdrop]');
  return backdrop ? [backdrop, ...partsOf(root)] : partsOf(root);
}

/**
 * 迷你播放器：主窗口缩小后整窗换成它，三种版式。紧凑态封面在左，右边依次是标题、副标题与评分、播放控制与
 * 工具，进度通栏在底；封面态封面在上，其余依次排在下面；紧凑态打开更多菜单时，菜单占上部，下面留一条
 * 当前曲目与播放控制。封面态的菜单换下封面。版式按缩放前的尺寸排，整体缩放的倍数与窗口尺寸同出一处。
 *
 * 背景是当前封面加高饱和、压暗与大半径模糊，往下渐隐到中性底，底部的播放控制落在中性底上。按在空白处、
 * 封面或文字上拖动窗口。
 *
 * 菜单打开时窗口先变高、版式当帧换好，菜单内容从上方滑下，底下那条当前曲目上移入场；收起时菜单滑回、
 * 那条当前曲目淡出，播完才缩回窗口，紧凑态的内容再淡入。紧凑与封面两种形态互换时，内容与背景先淡出，
 * 淡出播完那一刻改窗口尺寸，换好版式再淡入：窗口尺寸由宿主一步改好，不能逐帧动，跳变藏在只剩底色的那一刻。
 */
export function MiniPlayer() {
  const t = useAtomValueRawSync(translateAtom);
  const { form, menu, busy } = useAtomValueRawSync(miniWindowAtom);
  const mini = useService(miniWindowKey);
  const store = useStore();
  const track = useAtomValueRawSync(currentTrackAtom);
  const cover = useAtomValueRawSync(backgroundCoverAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const [failedCover, setFailedCover] = useState('');
  const [closing, setClosing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuFrame = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  // 紧凑态的菜单收起后更多键才重新挂上，收起动画与缩放完成前它还置灰；都好了再把焦点送回去。
  const refocusMore = useRef(false);
  const shownMenu = useRef(menu);
  const classes = useKeyStyles();
  const layout = form === 'cover' ? 'cover' : menu ? 'strip' : 'compact';
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (menu || busy || closing || !refocusMore.current) return;
    refocusMore.current = false;
    more.current?.focus({ preventScroll: true });
  }, [menu, busy, closing]);
  // 菜单开合换了版式之后，新到位的部分入场；初次挂载不播。
  useLayoutEffect(() => {
    if (shownMenu.current === menu) return;
    shownMenu.current = menu;
    const parts = partsOf(root.current);
    if (menu) {
      const frame = menuFrame.current;
      const content = frame?.firstElementChild;
      if (frame && content instanceof HTMLElement) unfoldMenu(frame, content, reduced);
      if (layout === 'strip') riseIn(parts, reduced);
    } else {
      fadeIn(
        layout === 'cover' ? parts.filter((part) => part.dataset['miniPart'] === 'cover') : parts,
        reduced,
      );
    }
  }, [menu, layout, reduced]);

  const url = track && cover.url !== failedCover ? cover.url : '';
  const live = track !== null && !(track.duration > 0);
  const subtitle = track
    ? [track.artist, track.album].filter(Boolean).join(' · ') || (live ? t('mini.radio') : '')
    : '';
  const closeMenu = () => {
    if (closing) return;
    const frame = menuFrame.current;
    const content = frame?.firstElementChild;
    const running: Animation[] = [];
    if (frame && content instanceof HTMLElement) running.push(foldMenu(frame, content, reduced));
    if (layout === 'strip') running.push(...fadeOut(partsOf(root.current), reduced));
    setClosing(true);
    void Promise.all(running.map((animation) => animation.finished.catch(() => undefined)))
      .then(() => {
        refocusMore.current = true;
        return mini.setMenu(false);
      })
      .then(() => {
        setClosing(false);
        // 缩放没成、菜单还开着：撤掉收起的动画，菜单回到原样。
        if (store.get(miniWindowAtom).menu) running.forEach((animation) => animation.cancel());
      });
  };
  const switchForm = () => {
    if (switching) return;
    setSwitching(true);
    const running = fadeOut(viewOf(root.current), reduced);
    void Promise.all(running.map((animation) => animation.finished.catch(() => undefined)))
      .then(() => mini.setForm(form === 'compact' ? 'cover' : 'compact'))
      .then(() => {
        setSwitching(false);
        // 换没换成都淡入：没换成时回到原来的样子。
        fadeIn(viewOf(root.current), reduced);
      });
  };
  const Placeholder = live ? Live24Regular : MusicNote224Regular;
  return (
    <CoverTheme url={url}>
      <div
        ref={root}
        className={styles.root}
        style={{ zoom: MINI_PLAYER_SCALE }}
        tabIndex={-1}
        data-mini-player={form}
        data-layout={layout}
        data-scheme={scheme}
        data-menu={menu || undefined}
        aria-label={t('player.miniPlayer')}
        aria-busy={busy}
        onPointerDown={(event) => {
          const target = event.target;
          if (event.button !== 0 || !(target instanceof Element) || target.closest(INTERACTIVE))
            return;
          mini.drag();
        }}
      >
        <div className={styles.backdrop} aria-hidden data-mini-backdrop>
          <div className={styles.blur}>
            <BackgroundImageLayers url={url} reduced={reduced} />
          </div>
        </div>
        <Captions />
        {menu && (
          <div ref={menuFrame} className={styles.menu} inert={closing}>
            <MiniPlayerMenu onClose={closeMenu} />
          </div>
        )}
        {layout === 'strip' && <div className={styles.divider} data-mini-part="divider" />}
        {(!menu || layout === 'strip') && (
          <div className={styles.cover} data-mini-cover data-mini-part="cover">
            {url ? (
              <img src={url} alt="" draggable={false} onError={() => setFailedCover(url)} />
            ) : (
              <Placeholder aria-hidden />
            )}
          </div>
        )}
        <div className={styles.meta} data-mini-part="meta">
          <ScrollingTitle
            primary
            className={styles.title}
            text={track ? displayTitle(track) : t('player.idle')}
          />
          <div className={styles.byline}>
            {subtitle && <ScrollingTitle className={styles.subtitle} text={subtitle} />}
            <div className={styles.rating}>
              <NowPlayingRating size="small" track={track} />
            </div>
          </div>
        </div>
        <div className={styles.controls} data-mini-part="controls">
          <Transport large={layout === 'cover'} />
          {layout !== 'strip' && (
            <div className={styles.tools}>
              <MiniVolume keyClassName={classes.key} />
              <Key
                label={form === 'compact' ? t('mini.expandCover') : t('mini.collapseCover')}
                icon={
                  form === 'compact' ? <PanelTopExpand20Regular /> : <PanelTopContract20Regular />
                }
                disabled={busy || switching}
                onClick={switchForm}
              />
              <Key
                ref={more}
                label={t('menu.more')}
                icon={<MoreHorizontal20Regular />}
                disabled={busy || closing || switching}
                expanded={menu}
                onClick={() => (menu ? closeMenu() : void mini.setMenu(true))}
              />
            </div>
          )}
        </div>
        <div className={styles.seek} data-mini-part="seek">
          {live ? (
            <div className={styles.live}>
              <Live16Regular aria-hidden />
              {t('mini.live')}
            </div>
          ) : (
            <SeekBar interactive thickness={3} thumb clock className={styles['seek-line']} />
          )}
        </div>
      </div>
    </CoverTheme>
  );
}
