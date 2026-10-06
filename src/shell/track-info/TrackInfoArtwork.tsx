import { MusicNote2Regular } from '@fluentui/react-icons';
import type { Track } from 'foo-webview-sdk';
import { useState } from 'react';
import { useQueueCover } from '../right-card/queue/useQueueCover.ts';
import { infoMediaKind } from './trackInfoModel.ts';

export function TrackInfoArtwork({
  track,
  expanded,
}: {
  readonly track: Track;
  readonly expanded: boolean;
}) {
  const url = useQueueCover(infoMediaKind(track) === 'stream' ? '' : track.handle, expanded);
  const [failed, setFailed] = useState<string | null>(null);
  return url && failed !== url ? (
    <img src={url} alt="" draggable={false} onError={() => setFailed(url)} />
  ) : (
    <MusicNote2Regular />
  );
}
