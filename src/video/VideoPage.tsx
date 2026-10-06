import { FluentProvider, Portal, makeStyles, mergeClasses } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useEffect, useRef, useState } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { choiceCodec, defineLocalPref } from '../kit/localPref.ts';
import { historyAtom } from '../nav/navHistory.ts';
import { PageEntryContext } from '../nav/usePageSnapshot.ts';
import { useCommand } from '../nav/useCommand.ts';
import { darkTheme } from '../theme/themes.ts';
import { ROLE_VALUES, roleProperties } from '../theme/roles.ts';
import { reducedMotionAtom } from '../motion/reducedMotion.ts';
import { MOTION_VARIABLES, REDUCED_MOTION_VARIABLES } from '../motion/timing.ts';
import { VideoContext, type VideoBindings } from './videoContext.ts';
import { startVideoFullscreen, type VideoFullscreen } from './videoFullscreen.ts';
import { VideoControls, VIDEO_FITS, type VideoFit } from './VideoControls.tsx';
import { VideoStage } from './VideoStage.tsx';
import { useVideoIdle } from './useVideoIdle.ts';
import type { VideoElementStatus } from './useVideoElement.ts';
import styles from './VideoPage.module.css';

const useStyles = makeStyles({
  theme: {
    backgroundColor: 'transparent',
    colorScheme: 'dark',
    ...roleProperties(ROLE_VALUES),
    ...MOTION_VARIABLES,
  },
  reduced: REDUCED_MOTION_VARIABLES,
});
/** 画面填充方式；存储不可用时保留本次选择。 */
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
  const classes = useStyles();
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const root = useRef<HTMLElement>(null);
  const fullscreen = useRef<VideoFullscreen | null>(null);
  const alive = useRef(false);
  const [fit, setFit] = useState(() => fitPref.read());
  const [fullscreenFailed, setFullscreenFailed] = useState(false);
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
  async function toggleFullscreen(): Promise<void> {
    touch();
    const shell = fullscreen.current;
    const owned = shell?.owned;
    const ok = await shell?.toggle();
    if (!alive.current || fullscreen.current !== shell) return;
    setFullscreenFailed(!ok);
    if (ok) expand(Boolean(shell?.owned) || !owned);
  }
  function placeKeys(): boolean {
    const focused = document.activeElement;
    return (
      active &&
      !!focused &&
      !!root.current?.contains(focused) &&
      !focused.closest('input,textarea,select,[role="slider"],[role="menu"],[role="dialog"]')
    );
  }
  useCommand({
    id: 'video.play',
    layer: 'place',
    keys: [{ key: ' ' }],
    enabled: () => active && playback.connected && document.activeElement === root.current,
    run: () => {
      touch();
      bindings.toggle();
    },
  });
  useCommand({
    id: 'video.volumeUp',
    layer: 'place',
    keys: [{ key: 'ArrowUp' }],
    enabled: () => placeKeys() && playback.connected,
    run: () => {
      touch();
      bindings.stepVolume(true);
    },
  });
  useCommand({
    id: 'video.volumeDown',
    layer: 'place',
    keys: [{ key: 'ArrowDown' }],
    enabled: () => placeKeys() && playback.connected,
    run: () => {
      touch();
      bindings.stepVolume(false);
    },
  });
  useCommand({
    id: 'video.escape',
    layer: 'overlay',
    keys: [{ key: 'Escape' }],
    enabled: () =>
      active &&
      !root.current?.querySelector('[aria-expanded="true"]') &&
      !document.activeElement?.closest('[role="menu"],[role="dialog"]'),
    run: () => {
      if (bindings.expanded) void collapse();
      else bindings.close();
    },
  });
  useCommand({
    id: 'video.window',
    layer: 'place',
    keys: [{ key: 'f' }],
    enabled: () => placeKeys() && available,
    run: toggleWindow,
  });
  useCommand({
    id: 'video.fullscreen',
    layer: 'place',
    keys: [{ key: 'F11' }],
    enabled: () => active,
    run: () => void toggleFullscreen(),
  });
  useCommand({
    id: 'video.back',
    layer: 'place',
    keys: [{ key: 'ArrowLeft' }],
    enabled: () => placeKeys() && playback.canSeek,
    run: () => {
      touch();
      bindings.seek(Math.max(0, playback.position - 5));
    },
  });
  useCommand({
    id: 'video.forward',
    layer: 'place',
    keys: [{ key: 'ArrowRight' }],
    enabled: () => placeKeys() && playback.canSeek,
    run: () => {
      touch();
      bindings.seek(Math.min(playback.duration, playback.position + 5));
    },
  });

  const content = (
    <FluentProvider
      theme={darkTheme}
      className={mergeClasses(classes.theme, reduced && classes.reduced)}
    >
      <section
        ref={root}
        tabIndex={-1}
        aria-label={t('place.video')}
        className={styles.stage}
        data-expanded={bindings.expanded || undefined}
        data-controls={visible || undefined}
        onPointerMove={pointer}
        onPointerDown={pointer}
        onFocusCapture={touch}
        onKeyDown={key}
      >
        <VideoStage bindings={bindings} active={active} fit={fit} onStatus={setMediaStatus} />
        <div className={styles.heading} inert={!visible}>
          <span>{playback.title || t('place.video')}</span>
          {bindings.expanded && bindings.captions}
        </div>
        <div className={styles.controls} inert={!visible}>
          {fullscreenFailed && <div role="status">{t('video.fullscreenFailed')}</div>}
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
      </section>
    </FluentProvider>
  );
  return bindings.expanded && active ? <Portal>{content}</Portal> : content;
}

export function VideoPage() {
  const bindings = useContext(VideoContext);
  return bindings ? <Page bindings={bindings} /> : null;
}
