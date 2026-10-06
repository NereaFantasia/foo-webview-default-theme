import { Button, Tooltip } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { playbackKey } from '../../playback/playbackContract.ts';
import { playbackMutedAtom } from '../../playback/playerAtoms.ts';
import { VOLUME_ICONS_LARGE } from '../player/playerIcons.ts';
import { useVolumeControl } from '../player/volume/useVolumeControl.ts';
import { useVolumePreview } from '../player/volume/useVolumePreview.ts';

/**
 * 音量键：点一下切换静音；悬停提示写音量数值（0–100），滚轮直接调音量，提示跟着预览调到的值
 * （`useVolumePreview`）。迷你窗口里不另开滑条。
 */
export function MiniVolume({ keyClassName }: { readonly keyClassName: string }) {
  const t = useAtomValueRawSync(translateAtom);
  const control = useVolumeControl();
  const muted = useAtomValueRawSync(playbackMutedAtom);
  const playback = useService(playbackKey);
  const { preview, show } = useVolumePreview();
  const [tip, setTip] = useState(false);
  const Icon = VOLUME_ICONS_LARGE[control.level];
  return (
    <Tooltip
      content={String(preview ?? Math.round(control.position))}
      relationship="inaccessible"
      visible={tip || preview !== null}
      onVisibleChange={(_, data) => setTip(data.visible)}
    >
      <Button
        appearance="subtle"
        className={keyClassName}
        icon={<Icon />}
        aria-label={muted ? t('player.unmute') : t('player.mute')}
        aria-pressed={muted}
        disabled={!control.connected}
        onClick={() => void playback.toggleMute()}
        onWheel={(event) => {
          const next = control.wheel(event);
          if (next !== null) show(next);
        }}
      />
    </Tooltip>
  );
}
