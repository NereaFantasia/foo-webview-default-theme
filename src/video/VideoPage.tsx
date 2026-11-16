import { Portal } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { choiceCodec, defineLocalPref } from '../kit/localPref.ts';
import { useWidthTier } from '../kit/useWidthTier.ts';
import { historyAtom } from '../nav/navHistory.ts';
import { PageEntryContext } from '../nav/usePageSnapshot.ts';
import { playerBarStyleAtom, playerShellOf } from '../theme/playerBarStyle.ts';
import { VideoContext, type VideoBindings } from './videoContext.ts';
import { startVideoFullscreen, type VideoFullscreen } from './videoFullscreen.ts';
import { VideoControls, VIDEO_FITS, type VideoFit } from './VideoControls.tsx';
import { NAV_ROW_TIERS, PLAIN_TIERS, VideoHeading, type HeadingTier } from './VideoHeading.tsx';
import { VideoStage } from './VideoStage.tsx';
import { VideoTheme } from './VideoTheme.tsx';
import { useVideoGestures } from './useVideoGestures.ts';
import { useVideoIdle } from './useVideoIdle.ts';
import { useVideoKeys } from './useVideoKeys.ts';
import type { VideoElementStatus } from './useVideoElement.ts';
import styles from './VideoPage.module.css';

/** 画面填充方式；存储不可用时保留本次选择 */
const fitPref = defineLocalPref<VideoFit>({
  key: 'default-theme.video.fit.v1',
  fallback: 'contain',
  ...choiceCodec(VIDEO_FITS),
});

function Page({ bindings }: { readonly bindings: VideoBindings }) {
  const entry = useContext(PageEntryContext);
  const history = useAtomValueRawSync(historyAtom);
  const active = history.entry === entry;
  const state = useAtomValueRawSync(bindings.service.state);
  const playback = useAtomValueRawSync(bindings.playback);
  const t = useAtomValueRawSync(translateAtom);
  const navRow = playerShellOf(useAtomValueRawSync(playerBarStyleAtom), true).navRow;
  const [measure, tier] = useWidthTier<HeadingTier, HTMLElement>(
    navRow ? NAV_ROW_TIERS : PLAIN_TIERS,
  );
  const root = useRef<HTMLElement | null>(null);
  // 根节点既要给键盘与空闲判断用，也要量宽度给页头条分档
  const attach = useCallback(
    (element: HTMLElement | null) => {
      root.current = element;
      const stop = measure(element);
      return () => {
        if (typeof stop === 'function') stop();
        root.current = null;
      };
    },
    [measure],
  );
  const fullscreen = useRef<VideoFullscreen | null>(null);
  const alive = useRef(false);
  const [fit, setFit] = useState(() => fitPref.read());
  const [fullscreenFailed, setFullscreenFailed] = useState(false);
  const [revealFailed, setRevealFailed] = useState(false);
  const [mediaStatus, setMediaStatus] = useState<VideoElementStatus>('loading');
  const available =
    state.status === 'ready' && mediaStatus !== 'failed' && mediaStatus !== 'unsupported';
  const { visible, touch, pointer, key } = useVideoIdle(
    root,
    available && playback.playing && mediaStatus === 'ready',
  );
  const { expand } = bindings;
  useEffect(() => {
    if (!active) return;
    alive.current = true;
    const shell = startVideoFullscreen();
    fullscreen.current = shell;
    return () => {
      alive.current = false;
      fullscreen.current = null;
      shell.dispose();
      expand(false);
    };
  }, [active, expand]);
  useEffect(() => {
    if (active) root.current?.focus({ preventScroll: true });
  }, [active, bindings.expanded]);

  async function collapse(): Promise<void> {
    const shell = fullscreen.current;
    const ok = await shell?.leave();
    if (!alive.current || fullscreen.current !== shell) return;
    setFullscreenFailed(ok === false);
    if (ok !== false) expand(false);
  }
  function toggleWindow(): void {
    touch();
    if (bindings.expanded) void collapse();
    else if (available) expand(true);
  }
  async function reveal(): Promise<void> {
    touch();
    const ok = await bindings.reveal();
    if (alive.current) setRevealFailed(!ok);
  }
  async function toggleFullscreen(): Promise<void> {
    touch();
    const shell = fullscreen.current;
    const owned = shell?.owned;
    const ok = await shell?.toggle();
    if (!alive.current || fullscreen.current !== shell) return;
    setFullscreenFailed(!ok);
    if (ok) expand(Boolean(shell?.owned) || !owned);
  }
  useVideoKeys({
    active,
    available,
    root,
    bindings,
    playback,
    touch,
    collapse,
    toggleWindow,
    toggleFullscreen,
  });
  const gestures = useVideoGestures({
    enabled: available,
    toggle: () => {
      touch();
      bindings.toggle();
    },
    fullscreen: () => void toggleFullscreen(),
    stepVolume: bindings.stepVolume,
    touch,
  });

  const title = playback.title || t('place.video');
  // 内嵌时页头条属于外壳，跟整窗的深浅与背景走；只有画面区与它的控件固定深色
  // 全窗口盖住整个窗口，没有外壳可跟，标题条与窗口三键放进深色的画面区里随控件隐藏
  const content = (
    <section
      ref={attach}
      tabIndex={-1}
      aria-label={t('place.video')}
      className={styles.page}
      data-expanded={bindings.expanded || undefined}
      onPointerMove={pointer}
      onPointerDown={pointer}
      onFocusCapture={touch}
      onKeyDown={key}
    >
      {!bindings.expanded && (
        <VideoHeading
          title={title}
          tier={tier}
          canReveal={!!playback.file}
          onBrowse={() => {
            touch();
            bindings.browse();
          }}
          onReveal={() => void reveal()}
        />
      )}
      <div className={styles.body}>
        <div className={styles.stage} data-controls={visible || undefined}>
          <div className={styles.surface} {...gestures}>
            <VideoStage
              bindings={bindings}
              active={active}
              fit={fit}
              dark={bindings.expanded}
              onStatus={setMediaStatus}
            />
          </div>
          {bindings.expanded && (
            <VideoTheme>
              <div className={styles.overlay} inert={!visible}>
                <span className={styles.overlayTitle}>{title}</span>
                {bindings.captions}
              </div>
            </VideoTheme>
          )}
          <VideoTheme>
            <div className={styles.controls} inert={!visible}>
              {fullscreenFailed && (
                <div className={styles.toast} role="status">
                  {t('video.fullscreenFailed')}
                </div>
              )}
              {revealFailed && (
                <div className={styles.toast} role="status">
                  {t('video.revealFailed')}
                </div>
              )}
              <VideoControls
                bindings={bindings}
                available={available}
                fit={fit}
                onFit={(value) => {
                  setFit(value);
                  fitPref.write(value);
                }}
                onExpand={toggleWindow}
                onFullscreen={() => void toggleFullscreen()}
              />
            </div>
          </VideoTheme>
        </div>
      </div>
    </section>
  );
  return bindings.expanded && active ? <Portal>{content}</Portal> : content;
}

export function VideoPage() {
  const bindings = useContext(VideoContext);
  return bindings ? <Page bindings={bindings} /> : null;
}
