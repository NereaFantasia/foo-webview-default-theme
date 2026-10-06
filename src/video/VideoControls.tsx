import {
  Button,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItemRadio,
  MenuItem,
  MenuDivider,
  Tooltip,
} from '@fluentui/react-components';
import {
  ArrowExpand20Regular,
  ArrowMinimize20Regular,
  FullScreenMaximize20Regular,
  Next20Regular,
  Previous20Regular,
  Play20Filled,
  Pause20Filled,
  Rewind20Regular,
  FastForward20Regular,
  ResizeVideo20Regular,
  MoreHorizontal20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { ReactElement } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { MENU_SURFACE_MOTION } from '../motion/MenuMotion.tsx';
import type { VideoBindings } from './videoContext.ts';
import styles from './VideoControls.module.css';

export type VideoFit = 'contain' | 'cover' | 'fill' | 'original';
export const VIDEO_FITS: readonly VideoFit[] = ['contain', 'cover', 'fill', 'original'];

function Key({
  label,
  icon,
  onClick,
  disabled = false,
  className,
}: {
  readonly label: string;
  readonly icon: ReactElement;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  return (
    <span className={className}>
      <Tooltip content={label} relationship="label">
        <Button
          icon={icon}
          aria-label={label}
          appearance="subtle"
          onClick={onClick}
          disabled={disabled}
        />
      </Tooltip>
    </span>
  );
}

export function VideoControls({
  bindings,
  available,
  fit,
  onFit,
  onExpand,
  onFullscreen,
}: {
  readonly bindings: VideoBindings;
  readonly available: boolean;
  readonly fit: VideoFit;
  readonly onFit: (fit: VideoFit) => void;
  readonly onExpand: () => void;
  readonly onFullscreen: () => void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const playback = useAtomValueRawSync(bindings.playback);
  const fitItems = VIDEO_FITS.map((value) => (
    <MenuItemRadio key={value} name="fit" value={value} onClick={() => onFit(value)}>
      {t(`video.${value}`)}
    </MenuItemRadio>
  ));
  return (
    <div className={styles.root} data-video-controls>
      <div className={styles.seek}>{bindings.seekBar}</div>
      <div className={styles.row}>
        <span className={styles.secondary}>
          <Menu checkedValues={{ fit: [fit] }} surfaceMotion={MENU_SURFACE_MOTION}>
            <MenuTrigger disableButtonEnhancement>
              <Tooltip content={t('video.fit')} relationship="label">
                <Button
                  appearance="subtle"
                  icon={<ResizeVideo20Regular />}
                  aria-label={t('video.fit')}
                  disabled={!available}
                />
              </Tooltip>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>{fitItems}</MenuList>
            </MenuPopover>
          </Menu>
        </span>
        <div className={styles.transport}>
          <Key
            className={styles.secondary}
            label={t('player.previous')}
            icon={<Previous20Regular />}
            onClick={bindings.previous}
            disabled={!playback.connected}
          />
          <Key
            className={styles.secondary}
            label={t('video.back')}
            icon={<Rewind20Regular />}
            onClick={() => bindings.seek(Math.max(0, playback.position - 5))}
            disabled={!playback.canSeek}
          />
          <Key
            className={styles.play}
            label={t(playback.playing ? 'player.pause' : 'player.play')}
            icon={playback.playing ? <Pause20Filled /> : <Play20Filled />}
            onClick={bindings.toggle}
            disabled={!playback.connected}
          />
          <Key
            className={styles.secondary}
            label={t('video.forward')}
            icon={<FastForward20Regular />}
            onClick={() => bindings.seek(Math.min(playback.duration, playback.position + 5))}
            disabled={!playback.canSeek}
          />
          <Key
            className={styles.secondary}
            label={t('player.next')}
            icon={<Next20Regular />}
            onClick={bindings.next}
            disabled={!playback.connected}
          />
        </div>
        <div className={styles.tools}>
          <div className={styles.volume}>{bindings.volume}</div>
          <Key
            className={styles.window}
            label={t(bindings.expanded ? 'video.collapse' : 'video.expand')}
            icon={bindings.expanded ? <ArrowMinimize20Regular /> : <ArrowExpand20Regular />}
            onClick={onExpand}
            disabled={!available && !bindings.expanded}
          />
          <Key
            className={styles.secondary}
            label={t('video.fullscreen')}
            icon={<FullScreenMaximize20Regular />}
            onClick={onFullscreen}
            disabled={!available}
          />
          <span className={styles.more}>
            <Menu surfaceMotion={MENU_SURFACE_MOTION}>
              <MenuTrigger disableButtonEnhancement>
                <Tooltip content={t('video.more')} relationship="label">
                  <Button
                    appearance="subtle"
                    icon={<MoreHorizontal20Regular />}
                    aria-label={t('video.more')}
                  />
                </Tooltip>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem
                    icon={<Previous20Regular />}
                    onClick={bindings.previous}
                    disabled={!playback.connected}
                  >
                    {t('player.previous')}
                  </MenuItem>
                  <MenuItem
                    icon={<Next20Regular />}
                    onClick={bindings.next}
                    disabled={!playback.connected}
                  >
                    {t('player.next')}
                  </MenuItem>
                  <MenuItem
                    icon={<Rewind20Regular />}
                    onClick={() => bindings.seek(Math.max(0, playback.position - 5))}
                    disabled={!playback.canSeek}
                  >
                    {t('video.back')}
                  </MenuItem>
                  <MenuItem
                    icon={<FastForward20Regular />}
                    onClick={() =>
                      bindings.seek(Math.min(playback.duration, playback.position + 5))
                    }
                    disabled={!playback.canSeek}
                  >
                    {t('video.forward')}
                  </MenuItem>
                  <MenuDivider />
                  <Menu checkedValues={{ fit: [fit] }} surfaceMotion={MENU_SURFACE_MOTION}>
                    <MenuTrigger disableButtonEnhancement>
                      <MenuItem icon={<ResizeVideo20Regular />} disabled={!available}>
                        {t('video.fit')}
                      </MenuItem>
                    </MenuTrigger>
                    <MenuPopover>
                      <MenuList>{fitItems}</MenuList>
                    </MenuPopover>
                  </Menu>
                  <MenuItem
                    icon={<FullScreenMaximize20Regular />}
                    onClick={onFullscreen}
                    disabled={!available}
                  >
                    {t('video.fullscreen')}
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          </span>
        </div>
      </div>
    </div>
  );
}
