import { MusicNote2Regular } from '@fluentui/react-icons';
import type { Track } from 'foo-webview-sdk';
import { useState } from 'react';
import { AnimatedCoverImage } from '../../covers/AnimatedCoverImage.tsx';
import { FadeImage } from '../../kit/FadeImage.tsx';
import { useQueueCover } from '../../playback/queue/useQueueCover.ts';
import { trackOrigin } from '../../host/trackOrigin.ts';

export function TrackInfoArtwork({
  track,
  expanded,
}: {
  readonly track: Track;
  readonly expanded: boolean;
}) {
  // 普通网络流不向宿主要图；在线曲目经取图接口拿上游封面
  const url = useQueueCover(trackOrigin(track.path) === 'stream' ? '' : track.handle, expanded);
  const [failed, setFailed] = useState<string | null>(null);
  return url && failed !== url ? (
    <>
      <FadeImage src={url} alt="" draggable={false} onError={() => setFailed(url)} />
      {/* 缩略尺寸不播动图：只有展开的大封面才叠 */}
      {expanded && <AnimatedCoverImage track={track} layout="stack" fit="contain" />}
    </>
  ) : (
    <MusicNote2Regular />
  );
}
