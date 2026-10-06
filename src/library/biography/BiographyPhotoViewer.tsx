import {
  Button,
  Portal,
  Tooltip,
  createPresenceComponent,
  makeStyles,
  tokens,
  useFocusFinders,
} from '@fluentui/react-components';
import {
  ChevronLeft24Regular,
  ChevronRight24Regular,
  Dismiss20Regular,
} from '@fluentui/react-icons';
import { useEffect, useId, useRef, type FocusEvent, type ReactNode } from 'react';
import { BACK_BUTTON, BACK_KEYS, FORWARD_BUTTON, FORWARD_KEYS } from '../../nav/navCommands.ts';
import { useCommand } from '../../nav/useCommand.ts';
import { CURVE, DURATION_MS } from '../../motion/timing.ts';
import type { BiographyTranslate } from './BiographyPanel.tsx';
import type { BiographyPhoto } from './biographyPhotos.ts';
import { BiographyPhotoImage } from './BiographyPhotoImage.tsx';
import { BiographyPhotoSource } from './online/BiographyPhotoSource.tsx';
import styles from './BiographyPhotoViewer.module.css';
import { useAtomValueRawSync } from 'jotai/react';
import { useExternalLinks } from '../../kit/external-link/ExternalLinkProvider.tsx';

const PhotoPresence = createPresenceComponent({
  enter: [
    {
      keyframes: [{ scale: '1.05' }, { scale: '1' }],
      duration: DURATION_MS.normal,
      easing: CURVE.decelerateMid.timing,
    },
    {
      keyframes: [{ opacity: 0 }, { opacity: 1 }],
      duration: DURATION_MS.faster,
      easing: CURVE.linear.timing,
    },
  ],
  exit: [
    {
      keyframes: [{ scale: '1' }, { scale: '1.05' }],
      duration: DURATION_MS.fast,
      easing: CURVE.decelerateMid.timing,
    },
    {
      keyframes: [{ opacity: 1 }, { opacity: 0 }],
      duration: DURATION_MS.faster,
      easing: CURVE.linear.timing,
      fill: 'forwards',
    },
  ],
});

const useStyles = makeStyles({
  tool: {
    color: tokens.colorNeutralForegroundStaticInverted,
    backgroundColor: tokens.colorNeutralBackgroundStatic,
    minWidth: '32px',
    flexShrink: 0,
    ':hover': {
      color: tokens.colorNeutralForegroundStaticInverted,
      backgroundColor: tokens.colorNeutralBackgroundStatic,
    },
  },
  arrow: {
    color: tokens.colorNeutralForegroundStaticInverted,
    backgroundColor: tokens.colorNeutralBackgroundStatic,
    borderRadius: tokens.borderRadiusCircular,
    minWidth: '40px',
    height: '40px',
    padding: 0,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackgroundStatic,
      color: tokens.colorNeutralForegroundStaticInverted,
    },
  },
});

export function BiographyPhotoViewer({
  open,
  artist,
  photos,
  index,
  top,
  t,
  onSelect,
  onClose,
  commandPrefix = 'biography',
  actions,
}: {
  readonly open: boolean;
  readonly artist: string;
  readonly photos: readonly BiographyPhoto[];
  readonly index: number;
  readonly top: number;
  readonly t: BiographyTranslate;
  readonly onSelect: (index: number) => void;
  readonly onClose: () => void;
  readonly commandPrefix?: string;
  readonly actions?: ReactNode;
}) {
  const classes = useStyles();
  const external = useAtomValueRawSync(useExternalLinks().prompt);
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const { findFirstFocusable, findLastFocusable } = useFocusFinders();
  const photo = photos[index];
  const choose = (next: number) => onSelect(Math.max(0, Math.min(photos.length - 1, next)));
  useCommand({
    id: `${commandPrefix}.photo-close`,
    layer: 'overlay',
    keys: [{ key: 'Escape' }, ...BACK_KEYS],
    buttons: [BACK_BUTTON],
    enabled: () => open && !external,
    run: onClose,
  });
  useCommand({
    id: `${commandPrefix}.photo-forward`,
    layer: 'overlay',
    keys: FORWARD_KEYS,
    buttons: [FORWARD_BUTTON],
    enabled: () => open && !external,
    run: () => {},
  });
  useCommand({
    id: `${commandPrefix}.photo-previous`,
    layer: 'overlay',
    keys: [{ key: 'ArrowLeft' }],
    enabled: () => open && !external,
    run: () => choose(index - 1),
  });
  useCommand({
    id: `${commandPrefix}.photo-next`,
    layer: 'overlay',
    keys: [{ key: 'ArrowRight' }],
    enabled: () => open && !external,
    run: () => choose(index + 1),
  });
  useCommand({
    id: `${commandPrefix}.photo-first`,
    layer: 'overlay',
    keys: [{ key: 'Home' }],
    enabled: () => open && !external,
    run: () => choose(0),
  });
  useCommand({
    id: `${commandPrefix}.photo-last`,
    layer: 'overlay',
    keys: [{ key: 'End' }],
    enabled: () => open && !external,
    run: () => choose(photos.length - 1),
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    stage.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, [open]);
  useEffect(() => {
    if (open)
      root.current
        ?.querySelector('[aria-current="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [open, index]);
  const guard = (first: boolean) => (event: FocusEvent<HTMLSpanElement>) => {
    const from = event.relatedTarget;
    const inside = from instanceof Node && !!root.current?.contains(from);
    const target =
      first === inside ? findLastFocusable(root.current) : findFirstFocusable(root.current);
    (target ?? stage.current)?.focus();
  };
  return (
    <Portal>
      <PhotoPresence visible={open} unmountOnExit>
        <div
          className={styles.viewer}
          style={{ top }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          inert={!open}
          data-biography-viewer
        >
          <span className={styles.guard} tabIndex={0} aria-hidden onFocus={guard(true)} />
          <div className={styles.content} ref={root}>
            <header className={styles.header}>
              <h2 id={titleId}>{artist}</h2>
              <span role="status">
                {t('biography.photo')} {index + 1} / {photos.length}
              </span>
              <span className={styles.space} />
              {actions}
              <Tooltip content={t('biography.closePhotos')} relationship="label">
                <Button
                  className={classes.tool}
                  icon={<Dismiss20Regular />}
                  aria-label={t('biography.closePhotos')}
                  onClick={onClose}
                />
              </Tooltip>
            </header>
            <div
              className={styles.stage}
              ref={stage}
              tabIndex={0}
              aria-label={`${artist} ${index + 1} / ${photos.length}`}
            >
              {photos.length > 1 && (
                <Tooltip content={t('biography.previousPhoto')} relationship="label">
                  <Button
                    className={classes.arrow}
                    icon={<ChevronLeft24Regular />}
                    aria-label={t('biography.previousPhoto')}
                    disabled={index === 0}
                    onClick={() => choose(index - 1)}
                  />
                </Tooltip>
              )}
              <div className={styles.image}>
                <BiographyPhotoImage
                  url={photo?.url}
                  label={artist}
                  missing={t('biography.photoFailed')}
                />
              </div>
              {photos.length > 1 && (
                <Tooltip content={t('biography.nextPhoto')} relationship="label">
                  <Button
                    className={classes.arrow}
                    icon={<ChevronRight24Regular />}
                    aria-label={t('biography.nextPhoto')}
                    disabled={index === photos.length - 1}
                    onClick={() => choose(index + 1)}
                  />
                </Tooltip>
              )}
            </div>
            <footer className={styles.footer}>
              <div>
                {photo?.sourceUrl ? (
                  <BiographyPhotoSource key={photo.sourceUrl} url={photo.sourceUrl} t={t} />
                ) : (
                  <>
                    {t('biography.localPhoto')} · {photo?.album}
                  </>
                )}
              </div>
              {photos.length > 1 && (
                <div className={styles.thumbnails}>
                  {photos.map((item, at) => (
                    <button
                      key={item.key}
                      aria-label={`${t('biography.photo')} ${at + 1} / ${photos.length}`}
                      aria-current={index === at}
                      onClick={() => choose(at)}
                      title={item.album}
                    >
                      <BiographyPhotoImage
                        url={item.url}
                        label=""
                        missing={t('biography.photoFailed')}
                      />
                    </button>
                  ))}
                </div>
              )}
            </footer>
          </div>
          <span className={styles.guard} tabIndex={0} aria-hidden onFocus={guard(false)} />
        </div>
      </PhotoPresence>
    </Portal>
  );
}
